/**
 * What the AI is doing right now, per campaign — and the one button that
 * stops it.
 *
 * Every model call the server makes on a GM's behalf runs inside `withRun`:
 * one run per campaign at a time (the lock the chat route always had), an
 * AbortSignal handed to whatever does the calling, and an `ai.activity`
 * ephemeral on the way in and out so every screen can show "the Fixer is
 * drafting a floor · 12 s · cancel" without polling. `cancelRun` aborts the
 * signal; the caller sees a 499 `ai_cancelled`, never a half-applied result,
 * because nothing an AI route does is written until its model call returns.
 */
import { randomUUID } from 'node:crypto';
import { httpError } from '../services/auth.js';

export interface ActivityHub {
  emitEphemeral(
    campaignId: string,
    input: { type: string; payload: unknown; visibility?: 'gm' | 'public' | 'gm_owner' },
  ): void;
}

export interface AiRun {
  id: string;
  campaignId: string;
  /** `chat` | `npc` | `floor` | `map` | `architect` … — what the client keys its wording on. */
  kind: string;
  /** The sentence on the activity bar: "drafting a floor for Pier 23". */
  label: string;
  startedAt: number;
  controller: AbortController;
}

export interface AiActivity {
  runId: string;
  kind: string;
  label: string;
  /** ISO — when it started, so a client can show elapsed time from its own clock. */
  since: string;
}

const runs = new Map<string, AiRun>();

export function currentRun(campaignId: string): AiActivity | null {
  const run = runs.get(campaignId);
  if (!run) return null;
  return { runId: run.id, kind: run.kind, label: run.label, since: new Date(run.startedAt).toISOString() };
}

function announce(hub: ActivityHub | undefined, campaignId: string, payload: Record<string, unknown>): void {
  hub?.emitEphemeral(campaignId, { type: 'ai.activity', payload, visibility: 'gm' });
}

/** Rename a run mid-flight — the architect says which item it is on. */
export function updateRun(hub: ActivityHub | undefined, run: AiRun, label: string): void {
  run.label = label;
  announce(hub, run.campaignId, { state: 'busy', ...currentRun(run.campaignId) });
}

/**
 * Stop whatever the campaign's AI is doing. True when there was something to
 * stop; the route that was running answers its caller with `ai_cancelled`.
 */
export function cancelRun(hub: ActivityHub | undefined, campaignId: string): boolean {
  const run = runs.get(campaignId);
  if (!run) return false;
  run.controller.abort(new Error('cancelled by the GM'));
  announce(hub, campaignId, { state: 'cancelling', runId: run.id, kind: run.kind, label: run.label });
  return true;
}

export function isCancelled(err: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true;
  if (err instanceof Error) {
    if (err.name === 'AbortError') return true;
    if (/cancelled by the GM/.test(err.message)) return true;
  }
  return false;
}

/**
 * Run one AI job for a campaign: the lock, the signal, the announcements.
 * Rejects with 409 `ai_busy` if one is already running, 499 `ai_cancelled`
 * if the GM stopped it, and whatever `fn` threw otherwise.
 */
export async function withRun<T>(
  hub: ActivityHub | undefined,
  campaignId: string,
  kind: string,
  label: string,
  fn: (signal: AbortSignal, run: AiRun) => Promise<T>,
): Promise<T> {
  const existing = runs.get(campaignId);
  if (existing) {
    throw httpError(409, 'ai_busy', `the Fixer is still ${existing.label} — cancel it or wait`, {
      runId: existing.id,
      kind: existing.kind,
      label: existing.label,
    });
  }
  const run: AiRun = { id: randomUUID(), campaignId, kind, label, startedAt: Date.now(), controller: new AbortController() };
  runs.set(campaignId, run);
  announce(hub, campaignId, { state: 'busy', ...currentRun(campaignId) });
  let outcome: 'done' | 'cancelled' | 'error' = 'done';
  try {
    return await fn(run.controller.signal, run);
  } catch (err) {
    if (isCancelled(err, run.controller.signal)) {
      outcome = 'cancelled';
      throw httpError(499, 'ai_cancelled', `${run.label} — cancelled by the GM`);
    }
    outcome = 'error';
    throw err;
  } finally {
    // A run that returns normally after the GM stopped it (the Architect
    // hands back what landed) is still a cancelled run to the bar.
    if (outcome === 'done' && run.controller.signal.aborted) outcome = 'cancelled';
    runs.delete(campaignId);
    announce(hub, campaignId, {
      state: 'idle',
      runId: run.id,
      kind,
      label: run.label,
      outcome,
      ms: Date.now() - run.startedAt,
    });
  }
}

/** Tests only: forget every run (a failed test must not lock the next one out). */
export function resetRunsForTests(): void {
  runs.clear();
}
