/**
 * Map vision (FR12.11, lane 2) — the Fixer reads an uploaded battle map.
 *
 * The layout copilot (`fixer/geometry.ts`) turns a *description* into geometry.
 * This is the other half, and the one the GM actually has: they photographed or
 * scanned a map, it is already attached to the scene, and nobody wants to trace
 * forty walls by hand. The scene's map image goes to the local model as an
 * OpenAI-compatible `image_url` content part carrying a base64 data URI, under
 * the SAME bounded integer schema the layout copilot uses — so the model still
 * only ever emits rooms-as-rectangles and doors-as-offsets, and the server still
 * compiles those into walls, doors, zones and named fog regions on the scene's
 * own grid. The result is an `ai_generations` DRAFT, identical in kind to the
 * text lane, so one accept path serves both (Principle 8).
 *
 * **Capability flag.** DESIGN.md is explicit: map vision *requires a
 * vision-capable local model; the feature hides otherwise*. That gate lives
 * next door in `fixer/vision-probe.ts` and is checked here before a single byte
 * of map leaves the disk; `GET /api/fixer/status` publishes the same answer so
 * the button can be hidden rather than pressed and failed.
 *
 * Nothing here writes to a scene, and nothing here touches the internet: the
 * only destination is the configured `LLM_BASE_URL`.
 */
import { readFile, stat } from 'node:fs/promises';
import { z } from 'zod';
import type { Db } from '@safehouse/db';
import { httpError } from '../services/auth.js';
import { ScenesService, serializeScene } from '../services/scenes.js';
import { createDraft } from './drafts.js';
import {
  compileLayout,
  layoutJsonSchema,
  LayoutProposalSchema,
  type CompiledLayout,
  type LayoutProposal,
} from './geometry.js';
import { chatCompletionsUrl, type LlmConfig, type ModelSlot } from './llm.js';
import { activeSceneRow } from './state-core.js';
import { usageMeter } from './usage.js';
import { visionCapability } from './vision-probe.js';

/** Images the model is allowed to be shown, and the ceiling on their bytes. */
export const VISION_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const;
export const MAX_VISION_IMAGE_BYTES = 6 * 1024 * 1024;

const VISION_TIMEOUT_MS = 180_000;

/** The capability gate, re-exported so callers have one import site. */
export {
  PROBE_IMAGE_DATA_URI,
  cachedVisionCapability,
  readPropsVision,
  resetVisionCache,
  visionCapability,
  visionEnvOverride,
  type VisionCapability,
  type VisionVia,
} from './vision-probe.js';

// ---------------------------------------------------------------------------
// Reading a map
// ---------------------------------------------------------------------------

export interface MapImage {
  attachmentId: string;
  mime: string;
  bytes: number;
  dataUri: string;
}

/**
 * The map image behind a scene: the attachment named, else the scene's first
 * background map. Read straight off the file store — the model is handed bytes
 * we already hold, never a URL it would have to fetch.
 */
export async function loadMapImage(
  db: Db,
  campaignId: string,
  opts: { sceneId?: string; attachmentId?: string } = {},
): Promise<{ scene: ReturnType<typeof serializeScene>; image: MapImage }> {
  const service = new ScenesService(db);
  const row = opts.sceneId
    ? await service.sceneRow(opts.sceneId).catch(() => null)
    : ((await activeSceneRow(db, campaignId)) ?? null);
  if (!row || row.campaignId !== campaignId) {
    throw httpError(404, 'not_found', 'no scene to read a map for');
  }
  const scene = serializeScene(row);
  const attachmentId = opts.attachmentId ?? scene.mapAttachmentIds[0];
  if (!attachmentId) {
    throw httpError(
      409,
      'no_map_image',
      `scene "${scene.name}" has no map image attached — upload one first (FR9.2)`,
    );
  }
  const attachment = await service.attachment(attachmentId);
  if (!attachment || (attachment.campaignId && attachment.campaignId !== campaignId)) {
    throw httpError(404, 'not_found', 'unknown map attachment');
  }
  if (!(VISION_MIME_TYPES as readonly string[]).includes(attachment.mime)) {
    throw httpError(
      415,
      'unsupported_media_type',
      `map vision reads images (${VISION_MIME_TYPES.join(', ')}), not '${attachment.mime}'`,
    );
  }
  const path = service.attachmentPath(attachment);
  const info = await stat(path).catch(() => null);
  if (!info?.isFile()) throw httpError(404, 'not_found', 'the map file is missing from the store');
  if (info.size > MAX_VISION_IMAGE_BYTES) {
    throw httpError(
      413,
      'image_too_large',
      `that map is ${(info.size / 1_048_576).toFixed(1)} MB; the limit for inference is ${(
        MAX_VISION_IMAGE_BYTES / 1_048_576
      ).toFixed(0)} MB — downscale it first`,
    );
  }
  const buffer = await readFile(path);
  return {
    scene,
    image: {
      attachmentId: attachment.id,
      mime: attachment.mime,
      bytes: buffer.length,
      dataUri: `data:${attachment.mime};base64,${buffer.toString('base64')}`,
    },
  };
}

// ---------------------------------------------------------------------------
// The constrained ask
// ---------------------------------------------------------------------------

/**
 * The model's extra job on this lane: say what grid it *thinks* it is looking
 * at. We never apply it — the scene's grid is the GM's calibration (FR9.1) and
 * silently rewriting it would move every token on the map. It comes back as a
 * warning when it disagrees, which is the honest form of "proposes grid
 * alignment".
 */
export const MapVisionProposalSchema = LayoutProposalSchema.extend({
  gridCols: z
    .number()
    .int()
    .min(1)
    .max(999)
    .optional()
    .describe('How many grid squares wide the map image looks, if the grid is visible'),
  gridRows: z.number().int().min(1).max(999).optional(),
  gridConfidence: z.enum(['none', 'low', 'medium', 'high']).default('none'),
});
export type MapVisionProposal = z.infer<typeof MapVisionProposalSchema>;

export function mapVisionJsonSchema(): Record<string, unknown> {
  const json = z.toJSONSchema(MapVisionProposalSchema, { io: 'input' }) as Record<string, unknown>;
  delete json['$schema'];
  return json;
}

const SYSTEM_PROMPT = [
  'You are reading a tabletop battle map image for a Shadowrun 5th Edition game master.',
  'Answer with JSON only, matching the supplied schema. No prose, no markdown fence.',
  '',
  'Rules:',
  '1. Every room is an axis-aligned rectangle measured in WHOLE GRID SQUARES from the top-left of the image. Never metres, never pixels.',
  '2. Doors are an offset along one named room\'s wall, not free-standing lines. Do not describe walls at all — the server derives them from the room rectangles minus the door openings.',
  '3. Name rooms the way a GM would say them out loud ("lobby", "server room", "loading dock"). Those names become the fog regions the GM reveals during play, so they matter more than the geometry.',
  '4. If the map has a visible grid, report gridCols/gridRows and your confidence. If it does not, leave them out and set gridConfidence to "none".',
  '5. Prefer fewer, larger, correct rooms to many speculative ones. Say what you can see.',
].join('\n');

function userPrompt(scene: { name: string; grid: { cols: number; rows: number; unitM: number } }, hint: string): string {
  const lines = [
    `Scene: "${scene.name}".`,
    `The GM's grid for this scene is ${scene.grid.cols}x${scene.grid.rows} squares at ${scene.grid.unitM} m per square — lay the rooms out on that grid.`,
  ];
  if (hint.trim().length > 0) lines.push(`The GM adds: ${hint.trim()}`);
  lines.push('Read the map image and return the layout as JSON.');
  return lines.join('\n');
}

/** Tolerant JSON read: some servers still wrap constrained output in a fence. */
export function parseModelJson(raw: string): unknown {
  const trimmed = raw.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  const body = fenced?.[1] ?? trimmed;
  try {
    return JSON.parse(body);
  } catch {
    const start = body.indexOf('{');
    const end = body.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(body.slice(start, end + 1));
      } catch {
        /* fall through to the error below */
      }
    }
    throw httpError(502, 'ai_error', 'the model did not return JSON for the map layout');
  }
}

interface VisionCallResult {
  proposal: MapVisionProposal;
  model: string;
  usage: { promptTokens: number; completionTokens: number; totalTokens: number };
  latencyMs: number;
}

/**
 * One non-streaming, schema-constrained multimodal call. Non-streaming on
 * purpose: there is nothing to show the GM token by token here — the payoff is
 * a whole layout or none, and a single JSON body is one less way to be wrong.
 */
async function askModel(
  config: LlmConfig,
  model: string,
  image: MapImage,
  scene: { name: string; grid: { cols: number; rows: number; unitM: number } },
  hint: string,
): Promise<VisionCallResult> {
  const startedAt = Date.now();
  const body = {
    model,
    stream: false,
    temperature: 0,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          { type: 'text', text: userPrompt(scene, hint) },
          { type: 'image_url', image_url: { url: image.dataUri } },
        ],
      },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: { name: 'map_layout', schema: mapVisionJsonSchema(), strict: false },
    },
  };
  let res: Response;
  try {
    res = await fetch(chatCompletionsUrl(config.baseUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(VISION_TIMEOUT_MS),
    });
  } catch (err) {
    throw httpError(
      503,
      'ai_unreachable',
      `the inference box at ${config.baseUrl} did not answer`,
      err instanceof Error ? err.message : String(err),
    );
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw httpError(502, 'ai_error', `LLM responded ${res.status}`, text.slice(0, 500));
  }
  const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  const choice = Array.isArray(json?.['choices']) ? (json['choices'] as unknown[])[0] : null;
  const message =
    typeof choice === 'object' && choice !== null
      ? ((choice as Record<string, unknown>)['message'] as Record<string, unknown> | undefined)
      : undefined;
  const content = typeof message?.['content'] === 'string' ? (message['content'] as string) : '';
  if (content.trim().length === 0) {
    throw httpError(502, 'ai_error', 'the model returned no content for the map layout');
  }
  const parsed = MapVisionProposalSchema.safeParse(parseModelJson(content));
  if (!parsed.success) {
    throw httpError(
      502,
      'ai_error',
      'the model returned a layout that does not fit the geometry schema',
      parsed.error.issues.slice(0, 8),
    );
  }
  const usageRaw = (json?.['usage'] ?? {}) as Record<string, unknown>;
  const promptTokens = typeof usageRaw['prompt_tokens'] === 'number' ? usageRaw['prompt_tokens'] : 0;
  const completionTokens =
    typeof usageRaw['completion_tokens'] === 'number' ? usageRaw['completion_tokens'] : 0;
  return {
    proposal: parsed.data,
    model: typeof json?.['model'] === 'string' ? (json['model'] as string) : model,
    usage: {
      promptTokens,
      completionTokens,
      totalTokens:
        typeof usageRaw['total_tokens'] === 'number'
          ? usageRaw['total_tokens']
          : promptTokens + completionTokens,
    },
    latencyMs: Date.now() - startedAt,
  };
}

/** Grid disagreement is a warning, never an edit (see MapVisionProposalSchema). */
export function gridAlignmentWarnings(
  proposal: Pick<MapVisionProposal, 'gridCols' | 'gridRows' | 'gridConfidence'>,
  grid: { cols: number; rows: number },
): string[] {
  if (proposal.gridConfidence === 'none') return [];
  const cols = proposal.gridCols;
  const rows = proposal.gridRows;
  if (cols === undefined && rows === undefined) return [];
  if (cols === grid.cols && rows === grid.rows) return [];
  return [
    `grid alignment: the map reads as ${cols ?? '?'}x${rows ?? '?'} squares (confidence ` +
      `${proposal.gridConfidence}) but the scene grid is ${grid.cols}x${grid.rows} — recalibrate ` +
      'the scene grid before accepting, or the rooms will land off the image',
  ];
}

export interface MapVisionInput {
  campaignId: string;
  sceneId?: string;
  attachmentId?: string;
  /** GM steer: "the top floor only", "ignore the furniture". */
  hint?: string;
  mode?: 'merge' | 'replace';
  slot?: ModelSlot;
  /** Recorded on the draft as the prompt that produced it. */
  prompt?: string;
}

export interface MapVisionResult {
  generationId: string;
  status: 'draft';
  sceneId: string;
  attachmentId: string;
  title: string;
  model: string;
  rooms: CompiledLayout['rooms'];
  counts: { rooms: number; walls: number; doors: number; zones: number; fogRegions: number };
  warnings: string[];
  gridAlignment: {
    cols: number | null;
    rows: number | null;
    confidence: MapVisionProposal['gridConfidence'];
    matchesScene: boolean;
  };
  appliesTo: 'scenes.geometry';
  note: string;
}

/**
 * The whole lane: capability gate → image → constrained multimodal call →
 * `compileLayout` on the scene's grid → an `ai_generations` draft of kind
 * `geometry`, which the existing applier already knows how to put on a scene
 * (walls, doors, zones, and fog regions that arrive UNREVEALED).
 */
export async function proposeGeometryFromMap(
  db: Db,
  config: LlmConfig | null,
  input: MapVisionInput,
): Promise<MapVisionResult> {
  const capabilityAnswer = await visionCapability(config, {
    ...(input.slot !== undefined ? { slot: input.slot } : {}),
  });
  if (!config) {
    throw httpError(
      503,
      'ai_disabled',
      'the Fixer is switched off: set LLM_BASE_URL to point at an OpenAI-compatible server',
    );
  }
  if (!capabilityAnswer.supported) {
    throw httpError(
      501,
      'vision_unsupported',
      `this inference box cannot read images — ${capabilityAnswer.note}`,
      { via: capabilityAnswer.via, model: capabilityAnswer.model },
    );
  }

  const { scene, image } = await loadMapImage(db, input.campaignId, {
    ...(input.sceneId !== undefined ? { sceneId: input.sceneId } : {}),
    ...(input.attachmentId !== undefined ? { attachmentId: input.attachmentId } : {}),
  });
  const model = input.slot === 'fast' ? config.fast : config.primary;
  const answer = await askModel(config, model, image, scene, input.hint ?? '');
  usageMeter.record(input.campaignId, {
    model: answer.model,
    usage: answer.usage,
    latencyMs: answer.latencyMs,
  });

  const layout: LayoutProposal = {
    title: answer.proposal.title,
    rooms: answer.proposal.rooms,
    doors: answer.proposal.doors,
    notes: answer.proposal.notes,
  };
  const compiled = compileLayout(layout, scene.grid);
  const warnings = [
    ...gridAlignmentWarnings(answer.proposal, scene.grid),
    ...compiled.warnings,
  ];
  const matchesScene =
    answer.proposal.gridCols === scene.grid.cols && answer.proposal.gridRows === scene.grid.rows;

  const draft = await createDraft(db, {
    campaignId: input.campaignId,
    kind: 'geometry',
    prompt: input.prompt ?? `GM asked the Fixer to read the map on "${scene.name}"`,
    model: answer.model,
    usage: answer.usage,
    output: {
      source: 'map_vision',
      attachmentId: image.attachmentId,
      imageBytes: image.bytes,
      sceneId: scene.id,
      sceneName: scene.name,
      mode: input.mode ?? 'merge',
      title: compiled.title,
      unitM: compiled.unitM,
      grid: compiled.grid,
      gridAlignment: {
        cols: answer.proposal.gridCols ?? null,
        rows: answer.proposal.gridRows ?? null,
        confidence: answer.proposal.gridConfidence,
        matchesScene,
      },
      rooms: compiled.rooms,
      geometry: compiled.geometry,
      fogRegions: compiled.fogRegions,
      warnings,
      notes: compiled.notes,
    },
  });

  return {
    generationId: draft.id,
    status: 'draft',
    sceneId: scene.id,
    attachmentId: image.attachmentId,
    title: compiled.title,
    model: answer.model,
    rooms: compiled.rooms,
    counts: {
      rooms: compiled.rooms.length,
      walls: compiled.geometry.walls.length,
      doors: compiled.geometry.doors.length,
      zones: compiled.geometry.zones.length,
      fogRegions: compiled.fogRegions.length,
    },
    warnings,
    gridAlignment: {
      cols: answer.proposal.gridCols ?? null,
      rows: answer.proposal.gridRows ?? null,
      confidence: answer.proposal.gridConfidence,
      matchesScene,
    },
    appliesTo: 'scenes.geometry',
    note: 'Read from the map image and saved as a draft. Nothing is on the scene until the GM accepts; fog regions arrive unrevealed.',
  };
}

/** The layout schema this lane constrains to, for the GM panel and tests. */
export { layoutJsonSchema };
