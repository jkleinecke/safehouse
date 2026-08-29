/**
 * A second, AI-enabled stack — booted only by `recap.spec.ts`.
 *
 * The shared world deliberately runs with `LLM_BASE_URL` unset: that is the
 * posture NG7 promises the table ("the app plays fine without it"), and every
 * other spec is written against it. Turning the Fixer on for the whole run to
 * test one feature would change the app under all of them.
 *
 * So the recap spec gets its own everything: its own `DATA_DIR`, its own
 * `seed:demo`, its own server on its own port, and a mock inference box in this
 * process. That is safe with PGlite — the rule is one process per data
 * directory, and these are two directories — and it costs a boot only when the
 * spec runs.
 *
 * The "model" is `apps/server/src/fixer/mock-llm.ts`, the same HTTP server
 * speaking OpenAI-compatible chat-completions with real SSE framing that the
 * server's own tests use. It is loaded out of `apps/server/dist` because the
 * server is already built for the E2E run; nothing imports it at runtime, and
 * no scripted turn ever decides anything — every number in the recap comes from
 * the session log, server-side (D13).
 */
import type { ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Api } from './api';
import { REPO_ROOT, seedDemo, startServer } from './harness';

// --- the slice of the mock we drive ----------------------------------------

export interface MockToolCall {
  name: string;
  arguments?: Record<string, unknown> | string;
  id?: string;
}
export interface MockTurn {
  content?: string;
  toolCalls?: MockToolCall[];
}
export interface MockChatRequest {
  model: string;
  messages: Array<{ role: string; content?: unknown }>;
}
export interface MockLlm {
  readonly baseUrl: string;
  readonly requests: MockChatRequest[];
  respondWith(fn: (req: MockChatRequest) => MockTurn | Promise<MockTurn>): MockLlm;
  close(): Promise<void>;
}
interface MockModule {
  MockLlmServer: { start(opts?: Record<string, unknown>): Promise<MockLlm> };
}

const MOCK_LLM = join(REPO_ROOT, 'apps', 'server', 'dist', 'fixer', 'mock-llm.js');

export interface AiStack {
  baseUrl: string;
  campaignId: string;
  gmToken: string;
  api: Api;
  llm: MockLlm;
  /** The live session the recap will be written for. */
  sessionId: string;
  /** A GM-only name from this campaign — the thing the spoiler guard hunts. */
  gmOnlyName: string;
  /**
   * The active scene's name. The recap digest puts it in the markdown from the
   * session's own state, so it is the cleanest proof that the facts around the
   * model's prose came from the server rather than from the model.
   */
  sceneName: string;
  stop: () => Promise<void>;
}

interface SessionDto {
  id: string;
  recapMd?: string;
  state: string;
}

/**
 * Seed, start a model, start a server pointed at it, and put the campaign in
 * the state a recap is written from: a live session with a log behind it.
 */
export async function bootAiStack(port: number): Promise<AiStack> {
  const dataDir = mkdtempSync(join(tmpdir(), 'safehouse-e2e-ai-'));
  const { campaignId, gmToken } = await seedDemo(dataDir);

  const mod = (await import(pathToFileURL(MOCK_LLM).href)) as MockModule;
  const llm = await mod.MockLlmServer.start();

  let server: ChildProcess;
  try {
    server = await startServer(dataDir, port, join(dataDir, 'server.log'), {
      // childEnv strips this by default; passing it back is the whole point of
      // this stack existing.
      LLM_BASE_URL: `${llm.baseUrl}/v1`,
      LLM_MODEL_PRIMARY: 'mock-primary',
      LLM_MODEL_FAST: 'mock-fast',
      // The map-vision capability probe would otherwise POST its own chat
      // completion at the mock on the first `GET /api/fixer/status`, and the
      // scripted responder answers every completion the same way. `off` is a
      // supported GM override (`fixer/vision-probe.ts`), so the box is asked
      // nothing it was not asked for.
      LLM_VISION: 'off',
    });
  } catch (err) {
    await llm.close();
    rmSync(dataDir, { recursive: true, force: true });
    throw err;
  }

  const baseUrl = `http://127.0.0.1:${port}`;
  const api = new Api(baseUrl);

  const stop = async (): Promise<void> => {
    server.kill('SIGTERM');
    await llm.close().catch(() => undefined);
    await new Promise((r) => setTimeout(r, 500));
    try {
      rmSync(dataDir, { recursive: true, force: true });
    } catch {
      /* the OS gets the temp dir */
    }
  };

  try {
    const started = await api.post<{ session: SessionDto }>(
      `/api/campaigns/${campaignId}/sessions/start`,
      {},
      gmToken,
    );

    // Something for the digest to count, and a public line so the recap is
    // written over a session that actually happened. The rolls matter: the
    // tally they produce is the fact the recap spec uses to tell the server's
    // half of the draft from the model's (D13).
    await api.post(
      `/api/campaigns/${campaignId}/log`,
      {
        kind: 'marker',
        text: 'RECAP-E2E: the freight door came down behind them.',
        visibility: 'public',
      },
      gmToken,
    );
    for (const pool of [7, 9]) {
      await api.post(
        '/api/rolls',
        {
          kind: 'simple',
          pool,
          breakdown: [{ label: 'RECAP-E2E', value: pool }],
          edge: null,
          visibility: 'public',
          actor: { gm: true },
          meta: { label: 'RECAP-E2E' },
        },
        gmToken,
      );
    }

    // The GM-only fact the spoiler guard is supposed to catch. Read from the
    // server rather than copied out of the seed, so the name (em dashes and
    // all) is byte-identical to what `gmOnlyNames` will look for.
    const campaign = await api.get<{ activeSceneId?: string | null }>(
      `/api/campaigns/${campaignId}`,
      gmToken,
    );
    const scene = await api.get<{
      scene: { id: string; name: string };
      tokens: { name: string; hidden?: boolean }[];
    }>(`/api/scenes/${campaign.activeSceneId}`, gmToken);
    const gmOnlyName = scene.tokens.find((t) => t.hidden && t.name.trim().length >= 3)?.name;
    if (!gmOnlyName) {
      throw new Error('e2e: the AI stack has no GM-only name for the spoiler guard to find');
    }

    return {
      baseUrl,
      campaignId,
      gmToken,
      api,
      llm,
      sessionId: started.session.id,
      gmOnlyName,
      sceneName: scene.scene.name,
      stop,
    };
  } catch (err) {
    await stop();
    throw err;
  }
}
