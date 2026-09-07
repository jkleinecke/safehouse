/**
 * A live turn against a real model server — OPT-IN.
 *
 * Skipped unless `SAFEHOUSE_E2E_LLM_URL` names one, because the rest of the
 * suite runs deliberately model-free (NG7) and must keep passing on a laptop
 * with no GPU, in CI, and on anybody else's machine. Turn it on with:
 *
 *   SAFEHOUSE_E2E_LLM_URL=http://127.0.0.1:8080/v1 \
 *   SAFEHOUSE_E2E_LLM_MODEL=your-model \
 *   pnpm --filter @safehouse/web e2e -- local-model
 *
 * ## What it is actually for
 *
 * Every other test of the AI layer works on shapes: does the config resolve,
 * does the translation round-trip, does the key stay server-side. This one
 * asks the only question those cannot — does a real box answer, through the
 * whole chain, from a setting a GM saved rather than an env var.
 *
 * It earned its place on the first run. Three defects came out of it that no
 * unit test could have seen: a provider-only save silently wiped the model
 * names (Zod's `.partial()` keeps `.default()`), llama.cpp answers a wrong
 * model name with 400 where the helpful path only matched 404, and the
 * "nothing configured" note still sent GMs to look at an env var that is no
 * longer how any of this works.
 */
import { expect, test } from './fixtures/test';

const BASE_URL = process.env['SAFEHOUSE_E2E_LLM_URL'] ?? '';
const MODEL = process.env['SAFEHOUSE_E2E_LLM_MODEL'] ?? '';

test.describe('a live model, configured at runtime', () => {
  test.skip(
    BASE_URL.length === 0 || MODEL.length === 0,
    'set SAFEHOUSE_E2E_LLM_URL and SAFEHOUSE_E2E_LLM_MODEL to run this',
  );

  test('answers a GM through the whole chain', async ({ world, api }) => {
    // A cold model load can take a while on a real box.
    test.setTimeout(600_000);
    const gm = world.gm.token;
    const c = world.campaignId;

    const configure = (body: Record<string, unknown>) =>
      api.request<{ ai: Record<string, unknown> }>('PUT', `/api/campaigns/${c}/ai`, {
        token: gm,
        body,
      });
    const status = () =>
      api.get<{ enabled: boolean; models: { primary: string } | null }>(
        `/api/fixer/status?campaignId=${c}`,
        gm,
      );

    // 1. Configured the way a GM would — no env var, no restart.
    const saved = await configure({
      provider: 'openai-compatible',
      baseUrl: BASE_URL,
      primaryModel: MODEL,
      fastModel: MODEL,
    });
    expect(saved.ai['ready']).toBe(true);
    expect((await status()).enabled).toBe(true);

    // 2. A real turn.
    const chat = await api.request<{ text: string; usage: { totalTokens: number } }>(
      'POST',
      '/api/fixer/chat',
      {
        token: gm,
        body: { campaignId: c, message: 'In one short sentence, what is a shadowrunner?', maxRounds: 1 },
      },
    );
    expect(chat.text.length).toBeGreaterThan(10);
    expect(chat.usage.totalTokens).toBeGreaterThan(0);

    // 3. A real TOOL call. The riskiest part with a local model, and the one
    // that proves the agent loop and the campaign's own state are reachable.
    const tools = await api.request<{
      text: string;
      tools: Array<{ name: string; ok: boolean }>;
    }>('POST', '/api/fixer/chat', {
      token: gm,
      body: {
        campaignId: c,
        message: 'Look up the player characters in this campaign and list their names. Use your tools.',
        maxRounds: 4,
      },
    });
    expect(tools.tools.length).toBeGreaterThan(0);
    expect(tools.tools.every((t) => t.ok)).toBe(true);

    // 4. A wrong model name must produce the sentence that ends the search —
    // naming what the box DOES serve — not the raw JSON of its refusal.
    await configure({ primaryModel: 'no-such-model-here', fastModel: 'no-such-model-here' });
    const wrong = await api.request<{ error: { message: string } }>('POST', '/api/fixer/chat', {
      token: gm,
      body: { campaignId: c, message: 'hello', maxRounds: 1 },
      allowStatus: [500, 502, 503],
    });
    expect(wrong.error.message).toContain('no-such-model-here');
    expect(wrong.error.message).toContain('it serves');

    // 5. The reasoning cap, measured. On a reasoning model this is the
    // difference between a Fixer that answers and one that thinks out loud for
    // ten seconds first — measured at 3.4s / 112 completion tokens on the
    // default against 0.24s / 3 tokens with thinking off.
    await configure({ primaryModel: MODEL, fastModel: MODEL, reasoningEffort: 'default' });
    const loud = await api.request<{ usage: { completionTokens: number } }>(
      'POST',
      '/api/fixer/chat',
      {
        token: gm,
        body: { campaignId: c, message: 'Name one Shadowrun archetype. Two words maximum.', maxRounds: 1 },
      },
    );
    await configure({ reasoningEffort: 'off' });
    const quiet = await api.request<{ usage: { completionTokens: number } }>(
      'POST',
      '/api/fixer/chat',
      {
        token: gm,
        body: { campaignId: c, message: 'Name one Shadowrun archetype. Two words maximum.', maxRounds: 1 },
      },
    );
    // Thinking off must actually cost fewer tokens, or the knob is decorative.
    expect(quiet.usage.completionTokens).toBeLessThan(loud.usage.completionTokens);

    // 6. And a save that changes ONE field leaves the others alone. This is
    // the silent data loss the first live run found.
    const before = await api.get<{ ai: Record<string, unknown> }>(`/api/campaigns/${c}/ai`, gm);
    await configure({ provider: 'openai-compatible' });
    const after = await api.get<{ ai: Record<string, unknown> }>(`/api/campaigns/${c}/ai`, gm);
    expect(after.ai['primaryModel']).toBe(before.ai['primaryModel']);
    expect(after.ai['baseUrl']).toBe(before.ai['baseUrl']);
  });
});
