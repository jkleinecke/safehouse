/**
 * Dress a token's figure from a description (the web's LookEditor).
 *
 * The figure on the isometric map is drawn from a handful of choices —
 * archetype, metatype, outfit, hair, eyes, what it carries, a chrome arm,
 * shoulder plates, and colours — so the model's whole job is to pick from
 * those lists (`TokenLookSchema`) what best fits the words. A small answer,
 * one turn, one repair if the JSON does not fit.
 *
 * Players reach this for their own runner, so errors go back through
 * `sanitizeAiError` at the route: the provider's words are the GM's.
 */
import { z } from 'zod';
import {
  FIGURE_ARCHETYPES,
  FIGURE_CYBERARMS,
  FIGURE_EYES,
  FIGURE_GEAR,
  FIGURE_HEADS,
  FIGURE_METATYPES,
  FIGURE_OUTFITS,
  TokenLookSchema,
  type TokenLook,
} from '@safehouse/contracts';
import { httpError } from '../services/auth.js';
import { LlmClient, constrainedEffort, type ChatMessage, type LlmConfig, type LlmUsage } from './llm.js';
import { cutOffError, repairJson, schemaMissError } from './repair.js';
import { usageMeter } from './usage.js';
import { parseModelJson } from './vision.js';

const LOOK_TIMEOUT_MS = 90_000;

const SYSTEM = `You dress figures for a Shadowrun (Sixth World, 2080) tabletop map.
A figure is drawn from a few fixed choices. Read the player's description and answer with ONE JSON object choosing, from the allowed values only, what best fits it.

Fields (all optional — leave out anything the description does not bear on, and it stays as it is):
- archetype: ${FIGURE_ARCHETYPES.join(', ')} (samurai = street samurai; security = corp/police in armour; face = talker/fixer; civilian = wage slave or bystander)
- metatype: ${FIGURE_METATYPES.join(', ')}
- outfit: ${FIGURE_OUTFITS.join(', ')} (duster = long coat; armor = armour jacket or full body armour)
- headStyle: ${FIGURE_HEADS.join(', ')}
- eyes: ${FIGURE_EYES.join(', ')} (shades = mirrorshades; visor = a lit band; cybereye = one glowing eye)
- gear: ${FIGURE_GEAR.join(', ')} (deck = cyberdeck; focus = a mage's glowing focus; remote = rigger control)
- cyberarm: ${FIGURE_CYBERARMS.join(', ')} (which arm is chrome)
- pads: true/false (armour plates on the shoulders)
- colors: an object of "#rrggbb" hex strings, any of: skin, hair, coat, under (shirt), legs, boots, neon (the glowing trim), chrome (cyberware)

Translate colour words to hex that reads well on a dark map: coats and clothes dark to mid tones, neon bright and saturated. Metatype skin runs natural: orks and trolls often grey-green or tan.
Answer with the JSON object only. No prose, no markdown fence.`;

export interface LookAsk {
  campaignId: string;
  description: string;
  /** What the token is now — its name, and the look it already has. */
  name: string;
  current: TokenLook | null;
  signal?: AbortSignal;
}

export interface LookResult {
  look: TokenLook;
  model: string;
  usage: LlmUsage;
  latencyMs: number;
}

/** Keep the parts of an answer that fit, drop the ones that do not. */
function salvage(raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null) return raw;
  const src = raw as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  const shape = TokenLookSchema.shape;
  for (const key of Object.keys(shape) as Array<keyof typeof shape>) {
    if (key === 'description' || !(key in src)) continue;
    let v = src[key];
    if (typeof v === 'string' && key !== 'colors') v = v.trim().toLowerCase();
    if (key === 'colors' && typeof v === 'object' && v !== null) {
      const colors: Record<string, string> = {};
      for (const [part, hex] of Object.entries(v as Record<string, unknown>)) {
        if (typeof hex !== 'string') continue;
        const h = hex.trim().startsWith('#') ? hex.trim() : `#${hex.trim()}`;
        if (/^#[0-9a-fA-F]{6}$/.test(h)) colors[part] = h.toLowerCase();
      }
      v = colors;
    }
    const one = (shape[key] as z.ZodType).safeParse(v);
    if (one.success) out[key] = one.data;
  }
  return out;
}

export async function describeLook(config: LlmConfig | null, ask: LookAsk): Promise<LookResult> {
  if (!config) {
    throw httpError(503, 'ai_disabled', 'the Fixer is switched off: set LLM_BASE_URL to point at an OpenAI-compatible server');
  }
  const client = new LlmClient(config);
  const model = config.fast || config.primary;
  const effort = constrainedEffort(config);
  const opts = { timeoutMs: LOOK_TIMEOUT_MS, ...(ask.signal ? { signal: ask.signal } : {}) };
  const { description: _prev, ...current } = ask.current ?? {};
  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM },
    {
      role: 'user',
      content: [
        `The token is called: ${ask.name}`,
        Object.keys(current).length > 0 ? `It looks like this now: ${JSON.stringify(current)}` : 'It has no look set yet.',
        '',
        `Description: ${ask.description}`,
      ].join('\n'),
    },
  ];
  const turn = await client.chat({ model, messages, temperature: 0.3, effort }, opts);
  if (turn.finishReason === 'length' && !/\}\s*$/.test(turn.content.trim())) throw cutOffError('the look', turn, effort);
  let usage = turn.usage;
  let latencyMs = turn.latencyMs;
  const parsed = parseModelJson(turn.content, 'the look');
  let checked = TokenLookSchema.safeParse(salvage(parsed));
  if (!checked.success || Object.keys(checked.data).length === 0) {
    const repaired = await repairJson(client, { model, effort }, opts, {
      messages,
      badContent: turn.content,
      issues: checked.success ? [] : checked.error.issues,
      what: 'the look',
      mustHave: 'archetype',
    });
    usage = {
      promptTokens: usage.promptTokens + repaired.turn.usage.promptTokens,
      completionTokens: usage.completionTokens + repaired.turn.usage.completionTokens,
      totalTokens: usage.totalTokens + repaired.turn.usage.totalTokens,
    };
    latencyMs += repaired.turn.latencyMs;
    checked = TokenLookSchema.safeParse(salvage(repaired.parsed));
    if (!checked.success) throw schemaMissError('look', checked.error.issues);
  }
  usageMeter.record(ask.campaignId, { model: turn.model, usage, latencyMs });
  // What the model changed, over what the token had.
  const look: TokenLook = {
    ...current,
    ...checked.data,
    colors: { ...(current.colors ?? {}), ...(checked.data.colors ?? {}) },
    description: ask.description,
  };
  return { look, model: turn.model, usage, latencyMs };
}
