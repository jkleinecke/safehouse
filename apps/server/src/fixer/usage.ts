/**
 * Usage meter (FR12.15/FR12.16). There is no per-token bill — the budget is
 * the hardware — so the meter reports **tokens and latency**, per campaign,
 * per model slot, so the GM can see what the box is actually doing.
 *
 * ## Why there are two halves
 *
 * The meter used to be a single per-process `Map`: every chat turn added to it
 * and a restart wiped it, because `ai_generations.usage` only covers turns that
 * produced a DRAFT, and most turns do not. A GM who restarted the server after
 * an afternoon of prep saw a meter reading zero, which is not a meter.
 *
 * So the number now lives in `ai_usage` — one row per completed Fixer turn,
 * campaign-scoped, append-only — and the meter's read is an aggregate over
 * that table (`campaignUsage`). `ai_generations.usage` is untouched: it is the
 * draft's own paper trail (Principle 8) and answers a different question.
 *
 * The in-process `UsageMeter` survives as the *live* half. It is what the GM's
 * panel watches during a session (per-round, no round trip, no write amplifying
 * a streaming turn), and it is still useful precisely because it is scoped to
 * "since this server started". The durable table is the total.
 *
 * Writes are best-effort by construction: a usage row that fails to insert must
 * never fail the GM's turn — the answer is the thing they asked for, the meter
 * is bookkeeping. `persistTurnUsage` therefore resolves either way and reports
 * whether it landed.
 */
import { aiUsage, type Db } from '@safehouse/db';
import { and, eq, gte, sql } from 'drizzle-orm';
import type { LlmUsage } from './llm.js';

export interface UsageRecord {
  model: string;
  usage: LlmUsage;
  latencyMs: number;
}

export interface ModelUsage {
  calls: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  latencyMsTotal: number;
}

export interface UsageTotals extends ModelUsage {
  latencyMsAvg: number;
  byModel: Record<string, ModelUsage>;
}

function empty(): ModelUsage {
  return { calls: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, latencyMsTotal: 0 };
}

function add(target: ModelUsage, record: UsageRecord): void {
  target.calls += 1;
  target.promptTokens += record.usage.promptTokens;
  target.completionTokens += record.usage.completionTokens;
  target.totalTokens += record.usage.totalTokens;
  target.latencyMsTotal += record.latencyMs;
}

export class UsageMeter {
  private readonly campaigns = new Map<string, { total: ModelUsage; byModel: Map<string, ModelUsage> }>();

  record(campaignId: string, record: UsageRecord): void {
    let entry = this.campaigns.get(campaignId);
    if (!entry) {
      entry = { total: empty(), byModel: new Map() };
      this.campaigns.set(campaignId, entry);
    }
    add(entry.total, record);
    const model = record.model || 'unknown';
    let perModel = entry.byModel.get(model);
    if (!perModel) {
      perModel = empty();
      entry.byModel.set(model, perModel);
    }
    add(perModel, record);
  }

  totals(campaignId: string): UsageTotals {
    const entry = this.campaigns.get(campaignId);
    const total = entry ? { ...entry.total } : empty();
    const byModel: Record<string, ModelUsage> = {};
    for (const [model, usage] of entry?.byModel ?? []) byModel[model] = { ...usage };
    return {
      ...total,
      latencyMsAvg: total.calls > 0 ? Math.round(total.latencyMsTotal / total.calls) : 0,
      byModel,
    };
  }

  reset(campaignId?: string): void {
    if (campaignId === undefined) this.campaigns.clear();
    else this.campaigns.delete(campaignId);
  }
}

/** Process-wide live meter (one server, one table). Resets on restart, by design. */
export const usageMeter = new UsageMeter();

// ---------------------------------------------------------------------------
// The durable half — `ai_usage`
// ---------------------------------------------------------------------------

/** What kind of work the tokens bought. Free-form; these are the ones we write. */
export type UsageKind = 'chat' | 'npc' | 'draft' | 'tool';

export interface TurnUsageInput {
  campaignId: string;
  model: string;
  usage: LlmUsage;
  latencyMs: number;
  kind?: UsageKind | string;
}

/** Clamp to a non-negative 32-bit integer — the column is `integer`. */
function counter(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.min(Math.max(Math.round(value), 0), 2_147_483_647);
}

/**
 * Persist one completed turn (FR12.15). Never throws: the GM already has their
 * answer by the time this runs, and a bookkeeping row is not worth a 500.
 * Returns whether the row landed, so a caller that cares can log it.
 */
export async function persistTurnUsage(db: Db, input: TurnUsageInput): Promise<boolean> {
  try {
    await db.insert(aiUsage).values({
      campaignId: input.campaignId,
      model: input.model || 'unknown',
      kind: input.kind ?? 'chat',
      promptTokens: counter(input.usage.promptTokens),
      completionTokens: counter(input.usage.completionTokens),
      totalTokens: counter(
        input.usage.totalTokens || input.usage.promptTokens + input.usage.completionTokens,
      ),
      latencyMs: counter(input.latencyMs),
    });
    return true;
  } catch {
    // A campaign deleted mid-turn, a full disk, a closed handle: none of those
    // are the GM's problem, and none of them should lose them their answer.
    return false;
  }
}

export interface DurableUsage extends UsageTotals {
  /** ISO timestamp of the oldest counted turn, or null when there are none. */
  since: string | null;
  /** Tokens grouped by what they bought (`chat`, `npc`, …). */
  byKind: Record<string, number>;
}

interface UsageAggregateRow {
  model: string;
  kind: string;
  calls: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  latencyMsTotal: number;
  oldest: Date | string | null;
}

/**
 * The durable meter: everything `ai_usage` holds for one campaign, aggregated
 * in the database rather than pulled into memory — a long campaign is thousands
 * of turns and the answer is a dozen numbers.
 *
 * `since` lets the GM read the number honestly ("14.2M tokens since March"),
 * which matters because the count is now cumulative rather than per-boot.
 */
export async function campaignUsage(
  db: Db,
  campaignId: string,
  opts: { since?: Date } = {},
): Promise<DurableUsage> {
  const where =
    opts.since !== undefined
      ? and(eq(aiUsage.campaignId, campaignId), gte(aiUsage.createdAt, opts.since))
      : eq(aiUsage.campaignId, campaignId);
  const rows: UsageAggregateRow[] = await db
    .select({
      model: aiUsage.model,
      kind: aiUsage.kind,
      calls: sql<number>`count(*)::int`,
      promptTokens: sql<number>`coalesce(sum(${aiUsage.promptTokens}), 0)::int`,
      completionTokens: sql<number>`coalesce(sum(${aiUsage.completionTokens}), 0)::int`,
      totalTokens: sql<number>`coalesce(sum(${aiUsage.totalTokens}), 0)::int`,
      latencyMsTotal: sql<number>`coalesce(sum(${aiUsage.latencyMs}), 0)::int`,
      oldest: sql<Date | null>`min(${aiUsage.createdAt})`,
    })
    .from(aiUsage)
    .where(where)
    .groupBy(aiUsage.model, aiUsage.kind);

  const total = empty();
  const byModel: Record<string, ModelUsage> = {};
  const byKind: Record<string, number> = {};
  let since: number | null = null;

  for (const row of rows) {
    const bucket = (byModel[row.model] ??= empty());
    for (const target of [total, bucket]) {
      target.calls += row.calls;
      target.promptTokens += row.promptTokens;
      target.completionTokens += row.completionTokens;
      target.totalTokens += row.totalTokens;
      target.latencyMsTotal += row.latencyMsTotal;
    }
    byKind[row.kind] = (byKind[row.kind] ?? 0) + row.totalTokens;
    const oldest = row.oldest === null ? null : new Date(row.oldest).getTime();
    if (oldest !== null && !Number.isNaN(oldest) && (since === null || oldest < since)) {
      since = oldest;
    }
  }

  return {
    ...total,
    latencyMsAvg: total.calls > 0 ? Math.round(total.latencyMsTotal / total.calls) : 0,
    byModel,
    byKind,
    since: since === null ? null : new Date(since).toISOString(),
  };
}
