/**
 * Playthrough harness — the plumbing behind `scripts/playthrough.ts`.
 *
 * Three small pieces, nothing clever:
 *   - `Api`    typed fetch against the in-process server, one instance per
 *              device token (GM, three phones, the TV).
 *   - `Live`   a WebSocket client that records every frame it is *allowed* to
 *              receive — which is what the secrecy assertions read (Principle 4:
 *              a player socket must never be handed data it may not render).
 *   - `Checks` / `Story` the two outputs: a pass/fail table and an in-fiction
 *              session narrative, written together into docs/demo/SESSION_REPORT.md.
 *
 * No test runner, no extra dependencies: plain fetch and Node's built-in
 * WebSocket, so `pnpm playthrough` runs anywhere the server runs.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

// ---------------------------------------------------------------------------
// Assertions
// ---------------------------------------------------------------------------

export interface Check {
  beat: string;
  name: string;
  expected: string;
  observed: string;
  pass: boolean;
  /** Rolled dice made this check inapplicable (recorded, never silently dropped). */
  skipped?: boolean;
}

const short = (value: unknown, max = 160): string => {
  const text =
    typeof value === 'string' ? value : (() => {
      try {
        return JSON.stringify(value);
      } catch {
        return String(value);
      }
    })();
  const flat = (text ?? 'undefined').replace(/\s+/g, ' ');
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

export class Checks {
  readonly rows: Check[] = [];
  private current = 'setup';

  beat(name: string): void {
    this.current = name;
  }

  /** Record a check with an explicit verdict. */
  record(name: string, expected: unknown, observed: unknown, pass: boolean): boolean {
    const row: Check = {
      beat: this.current,
      name,
      expected: short(expected),
      observed: short(observed),
      pass,
    };
    this.rows.push(row);
    console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name} — ${row.observed}`);
    return pass;
  }

  /** A check the dice made inapplicable this run; reported, never hidden. */
  skip(name: string, expected: unknown, why: string): void {
    this.rows.push({
      beat: this.current,
      name,
      expected: short(expected),
      observed: short(why),
      pass: true,
      skipped: true,
    });
    console.log(`  n/a   ${name} — ${short(why)}`);
  }

  eq(name: string, expected: unknown, actual: unknown): boolean {
    const pass = JSON.stringify(expected) === JSON.stringify(actual);
    return this.record(name, expected, actual, pass);
  }

  true_(name: string, expected: string, actual: unknown, pass: boolean): boolean {
    return this.record(name, expected, actual, pass);
  }

  get failures(): Check[] {
    return this.rows.filter((r) => !r.pass);
  }
}

// ---------------------------------------------------------------------------
// Narrative
// ---------------------------------------------------------------------------

export interface Scene {
  title: string;
  lines: string[];
}

/** The in-fiction log: prose lines and dice lines, in the order they happened. */
export class Story {
  readonly scenes: Scene[] = [];

  beat(title: string): void {
    this.scenes.push({ title, lines: [] });
    console.log(`\n=== ${title} ===`);
  }

  say(line: string): void {
    const scene = this.scenes[this.scenes.length - 1];
    if (scene) scene.lines.push(line);
  }

  /** A dice line: pool, faces, hits, and whatever else the table saw. */
  roll(label: string, detail: string): void {
    this.say(`> **${label}** — ${detail}`);
  }
}

/** `4, 6, 1, 5 → 2 hits` style summary of a roll result. */
export function diceLine(result: {
  faces?: number[];
  hits?: number;
  limitedHits?: number;
  ones?: number;
  glitch?: string;
  exploded?: number[];
}): string {
  const faces = (result.faces ?? []).join(' ');
  const limited =
    result.limitedHits !== undefined && result.limitedHits !== result.hits
      ? ` (${result.limitedHits} inside the limit)`
      : '';
  const exploded = result.exploded?.length ? ` · rule of six: ${result.exploded.join(' ')}` : '';
  const glitch =
    result.glitch && result.glitch !== 'none' ? ` · **${result.glitch.toUpperCase()}**` : '';
  return `[${faces}] → ${result.hits ?? 0} hits${limited}${exploded}${glitch}`;
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly method: string,
    readonly path: string,
    readonly body: string,
  ) {
    super(`${method} ${path} → ${status}: ${body.slice(0, 400)}`);
  }
}

export class Api {
  constructor(
    readonly base: string,
    readonly token: string,
    readonly who = 'anon',
  ) {}

  as(token: string, who: string): Api {
    return new Api(this.base, token, who);
  }

  private headers(body: unknown): Record<string, string> {
    return {
      // Fastify refuses an empty body under a JSON content-type, so a bodyless
      // request (DELETE, most GETs) must not claim one.
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
    };
  }

  async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.base}${path}`, {
      method,
      headers: this.headers(body),
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    if (!res.ok) throw new ApiError(res.status, method, path, text);
    return (text.length > 0 ? JSON.parse(text) : {}) as T;
  }

  /**
   * Status + raw body, without throwing. Used by the probes that assert the
   * SHAPE of a refusal (a 403, a 404 that must not carry a token) rather than
   * a success — LIVE-3's "`/join/:code` is not an API route" is exactly that.
   */
  async raw(method: string, path: string, body?: unknown): Promise<{ status: number; body: string }> {
    const res = await fetch(`${this.base}${path}`, {
      method,
      headers: this.headers(body),
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    return { status: res.status, body: await res.text() };
  }

  /** Same as `call`, but hands back the status instead of throwing (403 probes). */
  async status(method: string, path: string, body?: unknown): Promise<number> {
    return (await this.raw(method, path, body)).status;
  }

  get<T>(path: string): Promise<T> {
    return this.call<T>('GET', path);
  }
  post<T>(path: string, body?: unknown): Promise<T> {
    return this.call<T>('POST', path, body ?? {});
  }
  patch<T>(path: string, body: unknown): Promise<T> {
    return this.call<T>('PATCH', path, body);
  }
  del<T>(path: string): Promise<T> {
    return this.call<T>('DELETE', path);
  }
}

// ---------------------------------------------------------------------------
// WebSocket
// ---------------------------------------------------------------------------

export interface Frame {
  id?: number;
  type: string;
  payload?: unknown;
  visibility?: string;
  ownerUserId?: string;
  ephemeral?: boolean;
}

/** One live device: connects, records every frame the hub let through. */
export class Live {
  readonly frames: Frame[] = [];
  private waiters: Array<{ pred: (f: Frame) => boolean; resolve: (f: Frame) => void }> = [];

  private constructor(
    private readonly ws: WebSocket,
    readonly who: string,
  ) {
    ws.addEventListener('message', (ev) => {
      let frame: Frame;
      try {
        frame = JSON.parse(String((ev as MessageEvent).data)) as Frame;
      } catch {
        return;
      }
      this.frames.push(frame);
      this.waiters = this.waiters.filter((w) => {
        if (!w.pred(frame)) return true;
        w.resolve(frame);
        return false;
      });
    });
  }

  static connect(url: string, who: string, timeoutMs = 15_000): Promise<Live> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      const live = new Live(ws, who);
      const timer = setTimeout(() => reject(new Error(`ws connect timeout (${who})`)), timeoutMs);
      ws.addEventListener('open', () => {
        clearTimeout(timer);
        resolve(live);
      });
      ws.addEventListener('close', (ev) => {
        clearTimeout(timer);
        reject(new Error(`ws closed before open (${who}, code ${(ev as CloseEvent).code})`));
      });
      ws.addEventListener('error', () => {
        /* the close event carries the reason */
      });
    });
  }

  next(pred: (f: Frame) => boolean, timeoutMs = 15_000): Promise<Frame> {
    const seen = this.frames.find(pred);
    if (seen) return Promise.resolve(seen);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () =>
          reject(
            new Error(
              `${this.who}: timed out waiting for a frame; saw ${this.frames.map((f) => f.type).join(', ')}`,
            ),
          ),
        timeoutMs,
      );
      this.waiters.push({
        pred,
        resolve: (f) => {
          clearTimeout(timer);
          resolve(f);
        },
      });
    });
  }

  ofType(type: string): Frame[] {
    return this.frames.filter((f) => f.type === type);
  }

  send(obj: Record<string, unknown>): void {
    this.ws.send(JSON.stringify(obj));
  }

  close(): void {
    this.ws.close();
  }
}

/** Give the event loop a moment for broadcasts that nothing awaits. */
export function settle(ms = 150): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

export interface ReportInput {
  path: string;
  ranAt: string;
  story: Story;
  checks: Checks;
  gaps: string[];
  facts: Record<string, string>;
}

/** Table cells: pipes break the row, backticks break the code span around it. */
const cell = (s: string): string => s.replace(/\|/g, '\\|').replace(/`/g, "'");

export async function writeReport(input: ReportInput): Promise<void> {
  const { checks, story } = input;
  const passed = checks.rows.filter((r) => r.pass && !r.skipped).length;
  const skipped = checks.rows.filter((r) => r.skipped).length;
  const failed = checks.failures.length;

  const lines: string[] = [
    '# Static on the Line — session report',
    '',
    'One scripted session of the demo campaign, played end to end against a live',
    'server by `apps/server/scripts/playthrough.ts`: a fresh PGlite database, the',
    'seeded campaign, five devices on the socket, and every beat asserted as it',
    'happened. The narrative below is what the table saw; the dice in it are the',
    'dice the server actually rolled on this run.',
    '',
    `**Run:** ${input.ranAt} · **checks:** ${passed} passed, ${failed} failed` +
      `${skipped > 0 ? `, ${skipped} not applicable` : ''}`,
    '',
    ...Object.entries(input.facts).map(([k, v]) => `- **${k}:** ${v}`),
    '',
    '---',
    '',
    '## The session',
    '',
  ];

  for (const scene of story.scenes) {
    lines.push(`### ${scene.title}`, '');
    for (const line of scene.lines) lines.push(line, '');
  }

  lines.push('---', '', '## Assertions', '');
  let beat = '';
  lines.push('| # | Check | Expected | Observed | Pass |');
  lines.push('| --- | --- | --- | --- | --- |');
  checks.rows.forEach((row, i) => {
    if (row.beat !== beat) {
      beat = row.beat;
      lines.push(`| | **${cell(beat)}** | | | |`);
    }
    lines.push(
      `| ${i + 1} | ${cell(row.name)} | \`${cell(row.expected)}\` | ` +
        `\`${cell(row.observed)}\` | ${row.skipped ? 'n/a' : row.pass ? 'yes' : '**NO**'} |`,
    );
  });
  lines.push('');

  if (input.gaps.length > 0) {
    lines.push('---', '', '## Gaps this run found', '');
    lines.push(...input.gaps.map((g) => `- ${g}`), '');
  }

  lines.push(
    '---',
    '',
    '## How to replay this yourself',
    '',
    'Everything below runs offline: no Docker, no internet, no model.',
    '',
    '```bash',
    'pnpm install',
    '',
    '# 1. the whole scripted session again, against a throwaway database',
    'pnpm playthrough',
    '',
    '# 2. or play it by hand — seed the campaign into ./data',
    'pnpm seed:demo          # prints join codes AND device tokens',
    '',
    '# 3. two terminals',
    'pnpm dev:server         # http://localhost:8787',
    'pnpm dev:web            # http://localhost:5173 (proxies /api /ws /files /read /join)',
    '```',
    '',
    'Then open, in as many browser windows as you have hands:',
    '',
    '| Who | Where |',
    '| --- | --- |',
    '| GM | paste the **GM device token** the seed printed, or — from a laptop already signed in as GM — `POST /api/campaigns/:id/gm-pair` and scan the code it returns at `http://localhost:5173/join/<code>` |',
    '| Player | `http://localhost:5173/join/<player-code>` — one code per phone, and the seed prints three |',
    '| The TV | `http://localhost:5173/join/<display-code>`, then `/tv/<campaignId>` |',
    '',
    'Ordinary invites are role-scoped to player / observer / display and refuse `gm`',
    'outright; a GM device comes only from the bootstrap, `gm-device`, or a',
    'single-use `gm-pair` code. Every one of those redeems at **`/api/join/:code`** —',
    '`/join/:code` is the SPA screen the QR points a camera at.',
    '',
    '`pnpm seed:demo` prints all of those codes and tokens; it is idempotent, so',
    'running it again wipes *Static on the Line* and rebuilds it from scratch',
    'without touching any other campaign.',
    '',
    'To play the same beats by hand: write a codex page with one GM-only section',
    'and open it on a phone before and after revealing it; activate **Pier 23',
    'Warehouse** and roll a Perception from a phone (the dim light is already in',
    'the pool — the dialog shows it as context, never as a chip you add again);',
    'reveal *Main Floor*; drag a token to the office door and watch the GM-only',
    'nudge appear; launch the encounter from the scene, build the opposition from',
    'the *Rusted Halo* template at **blooded**; spend Edge on Seize the Initiative,',
    'Blitz and a Close Call; then post the run award and settle karma and nuyen in',
    'the housekeeping beat before you close the session.',
    '',
    'Optional extras:',
    '',
    '```bash',
    '# register the rulebook PDFs sitting at the repo root (FR11.7)',
    'pnpm seed:books -- --only SR5 --max-pages 60',
    '',
    '# point the Fixer at a local OpenAI-compatible model (llama.cpp / vLLM)',
    '# with LLM_BASE_URL unset every AI entry point simply hides (NG7)',
    'LLM_BASE_URL=http://127.0.0.1:8080 pnpm dev:server',
    '```',
    '',
  );

  await mkdir(dirname(input.path), { recursive: true });
  await writeFile(input.path, lines.join('\n'), 'utf8');
}
