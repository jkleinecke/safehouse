/**
 * Usage meter (FR12.15/FR12.16). There is no per-token bill — the budget is
 * the hardware — so the meter reports **tokens and latency**, per campaign,
 * per model slot, so the GM can see what the box is actually doing.
 *
 * INTEGRATION: chat turns that produce no draft have nowhere durable to live
 * in the §9.2 schema (`ai_generations.usage` only covers drafts), so this
 * accumulator is per-process and resets when the server restarts; the HTTP
 * endpoint adds the persisted draft usage on top. A `ai_usage` table would
 * make the meter survive restarts.
 */
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

/** Process-wide meter (one server, one table). */
export const usageMeter = new UsageMeter();
