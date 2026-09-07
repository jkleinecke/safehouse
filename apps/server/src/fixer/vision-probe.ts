/**
 * The map-vision capability flag (FR12.11).
 *
 * DESIGN.md is explicit: map vision *requires a vision-capable local model; the
 * feature hides otherwise*. So before anything sends a map anywhere, something
 * has to answer "does this box read images?" — once, cheaply, and in a form the
 * web app can switch on. That is this file; `fixer/vision.ts` is the lane that
 * uses it.
 *
 * The answer is probed once per (base URL, model), cached, and reported on
 * `GET /api/fixer/status`. Three ways, in order:
 *
 *   1. `LLM_VISION=on|off` — the GM's override, believed without asking.
 *   2. llama.cpp's `GET /props`, which states its own modalities. Definitive.
 *   3. A 2x2 PNG sent as a real image content part with `max_tokens: 1`. A
 *      refusal status means no vision; a 2xx means image content was accepted.
 *
 * Only *answers* are cached. A box that is merely unreachable leaves the
 * capability unknown and gets asked again next time, because "the LAN cable is
 * out" is not a statement about the model.
 *
 * The honest limit of step 3: a server that *silently ignores* an image part
 * and answers anyway reads as capable. Nothing on the wire distinguishes that
 * from a model that looked. It cannot corrupt anything — the answer is still a
 * bounded integer layout, still clamped to the grid, still only a draft — but
 * the GM would be reading a hallucinated map. That is what steps 1 and 2 are
 * for, and why `LLM_VISION=off` exists as the last word.
 *
 * Nothing here touches the internet: the only destination is `LLM_BASE_URL`.
 */
import { chatCompletionsUrl, serverRootUrl, type LlmConfig, type ModelSlot } from './llm.js';

/** A 2x2 PNG. Small enough to be free, real enough to be a genuine image part. */
export const PROBE_IMAGE_DATA_URI =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR4nGP4//8/AwQAWQAp5AX7XiD3SwAAAABJRU5ErkJggg==';

/**
 * Short on purpose: `GET /api/fixer/status` awaits this, and a box that has to
 * be waited on is a box the GM cannot use anyway. A live llama-server answers
 * `/props` in milliseconds and a dead one refuses the connection immediately;
 * this ceiling only bites on a box that is hung, which is worth knowing fast.
 */
const PROBE_TIMEOUT_MS = 10_000;

export type VisionVia = 'env' | 'props' | 'probe' | 'unconfigured' | 'unknown';

export interface VisionCapability {
  /** True only when we have positive evidence the model accepts images. */
  supported: boolean;
  /** How we found out — surfaced so "why is this hidden?" has an answer. */
  via: VisionVia;
  /** Null when there is no box to ask at all. */
  model: string | null;
  note: string;
  checkedAt: string;
}

const cache = new Map<string, VisionCapability>();

/** Forget every probed capability (tests, and a GM swapping models). */
export function resetVisionCache(): void {
  cache.clear();
}

function cacheKey(baseUrl: string, model: string): string {
  return `${baseUrl}|${model}`;
}

function modelFor(config: LlmConfig, slot: ModelSlot | undefined): string {
  return slot === 'fast' ? config.fast : config.primary;
}

function capability(
  supported: boolean,
  via: VisionVia,
  model: string | null,
  note: string,
): VisionCapability {
  return { supported, via, model, note, checkedAt: new Date().toISOString() };
}

const UNCONFIGURED = (): VisionCapability =>
  capability(
    false,
    'unconfigured',
    null,
    // Deliberately does NOT name an env var any more. Since the provider
    // became a runtime choice, the commonest reason to be here is a GM who
    // picked a hosted provider and has not given it a key — and sending them
    // to look at LLM_BASE_URL for that is a wild goose chase.
    'no AI is configured — pick one under Which AI on the Fixer page',
  );

/**
 * The answer we already have, with **no network at all**.
 *
 * The agent loop uses this rather than `visionCapability`: a chat turn must
 * never spend two extra round trips deciding whether to offer a tool, and it
 * must never fire an unrelated request at the box mid-conversation. The probe
 * belongs to `GET /api/fixer/status`, which the GM panel calls when it loads —
 * so by the time the GM is typing, the answer is cached and the tool is either
 * in the catalog or invisible. Unprobed reads as unsupported, which is the safe
 * direction: the feature hides (FR12.11) rather than half-appearing.
 */
export function cachedVisionCapability(
  config: LlmConfig | null,
  slot: ModelSlot = 'primary',
): VisionCapability {
  if (!config) return UNCONFIGURED();
  const model = modelFor(config, slot);
  return (
    cache.get(cacheKey(config.baseUrl, model)) ??
    capability(false, 'unknown', model, 'not probed yet — GET /api/fixer/status asks the box')
  );
}

/** `LLM_VISION` — the GM's override. `null` when unset or unreadable. */
export function visionEnvOverride(
  env: Record<string, string | undefined> = process.env,
): boolean | null {
  const raw = (env['LLM_VISION'] ?? '').trim().toLowerCase();
  if (raw.length === 0) return null;
  if (['1', 'on', 'true', 'yes'].includes(raw)) return true;
  if (['0', 'off', 'false', 'no'].includes(raw)) return false;
  return null;
}

/**
 * llama.cpp's `/props`. Recent builds report `modalities: { vision, audio }`;
 * older ones say nothing, which is `null` — indeterminate, not "no".
 */
export function readPropsVision(raw: unknown): boolean | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const rec = raw as Record<string, unknown>;
  const modalities = rec['modalities'];
  if (typeof modalities === 'object' && modalities !== null) {
    const vision = (modalities as Record<string, unknown>)['vision'];
    if (typeof vision === 'boolean') return vision;
  }
  // Some builds only advertise the projector path.
  const mmproj = rec['mmproj'] ?? rec['has_multimodal'] ?? rec['multimodal'];
  if (typeof mmproj === 'boolean') return mmproj;
  if (typeof mmproj === 'string' && mmproj.trim().length > 0) return true;
  return null;
}

/**
 * llama.cpp's `/props`, which lives at the SERVER ROOT and not under `/v1`.
 *
 * The documented base URL ends in `/v1`, so appending directly asked for
 * `/v1/props` and got a 404 from the one server that implements this — the
 * probe then reported "cannot tell" for a box that would happily have said.
 * A 404 is still a fine answer here (vLLM has no `/props` at all): unknown
 * degrades to the image probe, it never fails the caller.
 */
async function askProps(baseUrl: string): Promise<boolean | null> {
  try {
    const res = await fetch(`${serverRootUrl(baseUrl)}/props`, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    return readPropsVision(await res.json());
  } catch {
    return null;
  }
}

/** `true` accepted, `false` refused, `null` never reached the box. */
async function askImageProbe(config: LlmConfig, model: string): Promise<boolean | null> {
  try {
    const res = await fetch(chatCompletionsUrl(config.baseUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        stream: false,
        max_tokens: 1,
        temperature: 0,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'ok?' },
              { type: 'image_url', image_url: { url: PROBE_IMAGE_DATA_URI } },
            ],
          },
        ],
      }),
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    // A text-only server rejects the image part outright; that is the answer.
    return res.ok;
  } catch {
    return null;
  }
}

/**
 * Does the configured model accept image content? Probed once per
 * (base URL, model) and cached; pass `force` to re-ask after a model swap.
 * A null config (no `LLM_BASE_URL`) is `unconfigured`, not "unsupported" —
 * the whole Fixer is off in that state (NG7).
 */
export async function visionCapability(
  config: LlmConfig | null,
  opts: { slot?: ModelSlot; force?: boolean; env?: Record<string, string | undefined> } = {},
): Promise<VisionCapability> {
  if (!config) return UNCONFIGURED();
  const model = modelFor(config, opts.slot);
  const key = cacheKey(config.baseUrl, model);
  if (!opts.force) {
    const hit = cache.get(key);
    if (hit) return hit;
  }

  const override = visionEnvOverride(opts.env ?? process.env);
  if (override !== null) {
    return remember(
      key,
      capability(
        override,
        'env',
        model,
        `LLM_VISION says ${override ? 'on' : 'off'} — believed without probing`,
      ),
    );
  }

  const props = await askProps(config.baseUrl);
  if (props !== null) {
    return remember(
      key,
      capability(
        props,
        'props',
        model,
        props
          ? 'the inference box reports a vision modality'
          : 'the inference box reports no vision modality',
      ),
    );
  }

  const probe = await askImageProbe(config, model);
  if (probe === null) {
    // Unreachable is not an answer about the model — do not cache it.
    return capability(
      false,
      'unknown',
      model,
      `could not reach ${config.baseUrl} to ask whether it reads images`,
    );
  }
  return remember(
    key,
    capability(
      probe,
      'probe',
      model,
      probe
        ? 'the model accepted an image content part'
        : 'the model refused an image content part — map vision stays hidden',
    ),
  );
}

function remember(key: string, answer: VisionCapability): VisionCapability {
  cache.set(key, answer);
  return answer;
}
