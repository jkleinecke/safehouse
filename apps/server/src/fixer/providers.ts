/**
 * Resolving which AI to talk to, at runtime (FR12.13, D12).
 *
 * ## The order, and why it is that way round
 *
 * A GM's saved choice beats the environment. That inverts the usual precedence
 * — env normally wins so an operator can override an app — but here the
 * "operator" and the "user" are the same person sitting at the same laptop,
 * and the one they touched most recently is the one they meant. Env stays as
 * the way to bring a server up already pointing somewhere, which is what makes
 * a docker-compose file useful and what every existing deployment does today.
 *
 * So: settings if a provider has been chosen, otherwise env, otherwise off.
 * Nothing here can throw — an unusable configuration resolves to `null` and
 * every AI surface disables itself and says so (NG7 / Principle 5).
 *
 * ## The key never comes back out
 *
 * `readAiSettings` is what a route hands to the GM's browser, and it reports
 * only whether a key is on file. `resolveLlmConfig` is what the server uses to
 * make a call, and it is the only path that reads the secret. Keeping those
 * two functions separate is the whole mechanism: there is no shape that
 * carries the key toward a response body.
 */
import {
  AiSettingsSchema,
  aiProviderInfo,
  aiSettingsReady,
  type AiSettings,
  type AiSettingsView,
} from '@safehouse/contracts';
import { llmConfigFromEnv, type LlmConfig } from './llm.js';

/**
 * Where the AI config lives inside `campaigns.settings`.
 *
 * Per campaign rather than per server because that is where settings already
 * live and a home table is one campaign — and because a GM running two tables
 * may legitimately want a local model for one and a hosted one for the other.
 */
export const AI_SETTINGS_KEY = 'ai';

/** The key's own slot, kept apart so no read path can reach it by accident. */
export const AI_KEY_SLOT = 'aiApiKey';

type Settings = Record<string, unknown>;

/** The stored settings, defaulted. Never throws on a malformed stored blob. */
export function parseAiSettings(settings: Settings | null | undefined): AiSettings {
  const raw = (settings ?? {})[AI_SETTINGS_KEY];
  const parsed = AiSettingsSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : AiSettingsSchema.parse({});
}

export function storedApiKey(settings: Settings | null | undefined): string {
  const raw = (settings ?? {})[AI_KEY_SLOT];
  return typeof raw === 'string' ? raw : '';
}

/**
 * What the GM's screen gets: the configuration, whether a key is on file, and
 * whether the whole thing would actually run.
 *
 * `ready` is separate from "configured" on purpose. A provider chosen with no
 * key is a half-finished setup, and the difference between that and a working
 * one is worth stating before a session rather than discovering during one.
 */
export function readAiSettings(settings: Settings | null | undefined): AiSettingsView {
  const ai = parseAiSettings(settings);
  const hasKey = storedApiKey(settings).length > 0;
  return { ...ai, hasKey, ready: aiSettingsReady(ai, hasKey) };
}

/**
 * The config a request actually uses, or `null` when there is nothing to call.
 *
 * Env is consulted only when no provider has been chosen — see the ordering
 * note at the top of the file.
 */
export function resolveLlmConfig(
  settings: Settings | null | undefined,
  env: Record<string, string | undefined> = process.env,
): LlmConfig | null {
  const ai = parseAiSettings(settings);

  if (ai.provider === 'off') {
    // An explicit "off" is a decision, not an absence — it must not fall
    // through to whatever the environment happens to be pointing at, or a GM
    // who switched the AI off would find it still running.
    const chosen = (settings ?? {})[AI_SETTINGS_KEY];
    return chosen === undefined ? llmConfigFromEnv(env) : null;
  }

  const info = aiProviderInfo(ai.provider);
  const apiKey = storedApiKey(settings);
  if (info.needsKey && apiKey.length === 0) return null;

  // A named provider owns its own host; only the escape hatch takes the GM's.
  const baseUrl = (ai.provider === 'openai-compatible' ? ai.baseUrl : info.baseUrl)
    .trim()
    .replace(/\/+$/, '');
  if (baseUrl.length === 0) return null;

  const primary = ai.primaryModel.trim() || info.defaults.primary;
  if (primary.length === 0) return null;
  const fast = ai.fastModel.trim() || primary;

  return {
    baseUrl,
    primary,
    fast,
    dialect: info.dialect,
    provider: ai.provider,
    effort: ai.reasoningEffort,
    ...(apiKey.length > 0 ? { apiKey } : {}),
  };
}

/**
 * Apply a write, returning the settings blob to store.
 *
 * Two rules the shape enforces rather than documents:
 *
 * An OMITTED key leaves the stored one alone, so a GM can change models
 * without re-typing a secret they cannot see. An EMPTY key is the explicit
 * "forget it" — the only way to clear one, and unambiguous because a blank
 * field and an absent field are different values on the wire.
 *
 * Changing PROVIDER clears the key. Credentials are not portable between
 * vendors, and silently keeping an Anthropic key on file while the GM switches
 * to OpenAI means the next failure is a 401 they have no way to explain.
 */
export function applyAiSettings(
  settings: Settings | null | undefined,
  write: Partial<AiSettings> & { apiKey?: string | undefined },
): Settings {
  const current = parseAiSettings(settings);
  const next = AiSettingsSchema.parse({ ...current, ...stripUndefined(write) });
  const base = { ...(settings ?? {}) };

  let key = storedApiKey(settings);
  if (next.provider !== current.provider) key = '';
  if (write.apiKey !== undefined) key = write.apiKey.trim();

  base[AI_SETTINGS_KEY] = next;
  if (key.length > 0) base[AI_KEY_SLOT] = key;
  else delete base[AI_KEY_SLOT];
  return base;
}

/** `{...a, ...b}` would let an explicit `undefined` erase a stored value. */
function stripUndefined<T extends object>(value: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    if (v !== undefined && k !== 'apiKey') out[k] = v;
  }
  return out as Partial<T>;
}
