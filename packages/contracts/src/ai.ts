/**
 * Which AI the table talks to, and how (FR12.13, D12).
 *
 * ## Why this is a catalogue rather than a free-text base URL
 *
 * The Fixer used to be one env var pointing at an OpenAI-compatible box on the
 * LAN. That is still a first-class choice — it is the private, offline one —
 * but a GM who wants to use Claude, GPT or Grok should not have to know that
 * xAI happens to serve an OpenAI-shaped API at a particular host, or which of
 * the three needs a different request body entirely. Naming the provider lets
 * the server fill in the base URL, the auth header and the wire dialect, and
 * lets the GM's screen say "Anthropic" instead of asking for a URL.
 *
 * `openai-compatible` remains for everything else: llama.cpp, vLLM, Ollama,
 * LM Studio, a router, or a provider nobody has heard of yet. It is the escape
 * hatch that keeps this from being a closed list.
 *
 * ## Two dialects, not four
 *
 * OpenAI, xAI and every local server speak the same Chat Completions shape, so
 * they share one transport and differ only in URL, key and model names.
 * Anthropic's Messages API is genuinely different — the system prompt is a
 * top-level field rather than a message, `max_tokens` is required, and content
 * comes back as typed blocks — so it gets its own transport. `dialect` is what
 * the server dispatches on; `provider` is what the GM chose.
 *
 * ## The key is never in here
 *
 * `AiSettings` is stored in the campaign's settings and read back by the GM's
 * browser. An API key is not: it is written through a separate field, held
 * server-side, and every read reports only whether one is set. A secret that
 * round-trips through a settings GET ends up in a query cache, a log line and
 * a screenshot.
 */
import { z } from 'zod';

/** The wire shape a provider actually speaks. */
export const AiDialectSchema = z.enum(['openai', 'anthropic']);
export type AiDialect = z.infer<typeof AiDialectSchema>;

export const AiProviderSchema = z.enum([
  /** No AI at all. The Fixer disables cleanly (NG7 / Principle 5). */
  'off',
  'anthropic',
  'openai',
  'xai',
  /** Anything else that speaks Chat Completions — local or hosted. */
  'openai-compatible',
]);
export type AiProvider = z.infer<typeof AiProviderSchema>;

/** What the server needs to know about each provider, and the GM's screen shows. */
export interface AiProviderInfo {
  id: AiProvider;
  /** How it is named to a person. */
  label: string;
  dialect: AiDialect;
  /**
   * Where it lives. Empty for `openai-compatible`, which is defined by the GM
   * typing one, and for `off`.
   */
  baseUrl: string;
  /** Does it need an API key? A box on the LAN generally does not. */
  needsKey: boolean;
  /** Sensible starting models, so the form is never empty. */
  defaults: { primary: string; fast: string };
  /** One line under the choice, in the GM's terms. */
  blurb: string;
}

/**
 * The catalogue. Model ids are starting points a GM can overwrite, not a
 * closed list — providers ship new models faster than a VTT gets updated, and
 * a fixed dropdown of models would be stale within a month.
 */
export const AI_PROVIDERS: readonly AiProviderInfo[] = [
  {
    id: 'off',
    label: 'Off',
    dialect: 'openai',
    baseUrl: '',
    needsKey: false,
    defaults: { primary: '', fast: '' },
    blurb: 'No AI. Every Fixer surface disables itself and says so.',
  },
  {
    id: 'anthropic',
    label: 'Anthropic (Claude)',
    dialect: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    needsKey: true,
    defaults: { primary: 'claude-opus-5', fast: 'claude-haiku-4-5' },
    blurb: 'Claude, over Anthropic’s own API.',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    dialect: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    needsKey: true,
    defaults: { primary: 'gpt-5', fast: 'gpt-5-mini' },
    blurb: 'GPT, over OpenAI’s API.',
  },
  {
    id: 'xai',
    label: 'xAI (Grok)',
    dialect: 'openai',
    baseUrl: 'https://api.x.ai/v1',
    needsKey: true,
    defaults: { primary: 'grok-4', fast: 'grok-4-fast' },
    blurb: 'Grok. Speaks the same shape as OpenAI.',
  },
  {
    id: 'openai-compatible',
    label: 'Local or other',
    dialect: 'openai',
    baseUrl: '',
    needsKey: false,
    defaults: { primary: 'local-primary', fast: 'local-primary' },
    blurb:
      'llama.cpp, vLLM, Ollama, LM Studio, a router — anything serving /v1/chat/completions. Nothing leaves your network.',
  },
] as const;

export function aiProviderInfo(id: AiProvider): AiProviderInfo {
  const found = AI_PROVIDERS.find((p) => p.id === id);
  // The enum and the catalogue are checked against each other in tests, so a
  // miss here is impossible rather than merely unlikely; the fallback keeps
  // the function total instead of throwing inside a render.
  return found ?? AI_PROVIDERS[0]!;
}

/**
 * The GM's AI configuration, as stored and as read back.
 *
 * `baseUrl` is only meaningful for `openai-compatible`; for the named
 * providers the catalogue's own URL wins, so switching provider cannot leave a
 * stale host behind pointing somewhere unrelated.
 */
export const AiSettingsSchema = z.object({
  provider: AiProviderSchema.default('off'),
  /** Required for `openai-compatible`; ignored otherwise. */
  baseUrl: z.string().max(500).default(''),
  /** Big model: conversations, fiction, rules synthesis. */
  primaryModel: z.string().max(200).default(''),
  /** Small model: mechanical tasks and live-session work (FR12.16). */
  fastModel: z.string().max(200).default(''),
});
export type AiSettings = z.infer<typeof AiSettingsSchema>;

/** What a GET returns: the settings plus whether a key is on file, never the key. */
export const AiSettingsViewSchema = AiSettingsSchema.extend({
  hasKey: z.boolean(),
  /**
   * Whether this configuration would actually run. A provider that needs a key
   * and has none is configured but not usable, and the difference is worth
   * saying out loud rather than leaving the GM to discover it mid-session.
   */
  ready: z.boolean(),
});
export type AiSettingsView = z.infer<typeof AiSettingsViewSchema>;

/**
 * A write. The key is optional on every save: omitting it leaves whatever is
 * on file alone, so a GM can change models without re-typing a secret. An
 * empty string is the explicit "forget it".
 */
export const AiSettingsWriteSchema = AiSettingsSchema.partial().extend({
  apiKey: z.string().max(400).optional(),
});
export type AiSettingsWrite = z.infer<typeof AiSettingsWriteSchema>;

/** Is this configuration complete enough to make a request with? */
export function aiSettingsReady(settings: AiSettings, hasKey: boolean): boolean {
  if (settings.provider === 'off') return false;
  const info = aiProviderInfo(settings.provider);
  if (info.needsKey && !hasKey) return false;
  const baseUrl = settings.provider === 'openai-compatible' ? settings.baseUrl : info.baseUrl;
  if (baseUrl.trim().length === 0) return false;
  return settings.primaryModel.trim().length > 0;
}
