/**
 * The shared vocabulary of the FR12.17 tool catalog: the tool shape, the
 * context every tool runs in, and the two helpers that keep declarations
 * short.
 *
 * It lives apart from `tools.ts` so the catalog can be split across files
 * (core / codex / table) without an import cycle. `tools.ts` re-exports
 * everything here, so callers still only import from there.
 */
import { z } from 'zod';
import type { Db } from '@safehouse/db';
import type { LlmConfig } from './llm.js';

export interface ToolContext {
  db: Db;
  campaignId: string;
  /** The GM turn that triggered this call — recorded on any draft it creates. */
  prompt: string;
  /** Model slot id in play, stamped on drafts for the meter. */
  model: string | null;
  /**
   * The configured inference box, when there is one. Almost every tool is a
   * plain data read and never wants this; map vision (FR12.11) is the exception
   * — it calls the model a second time with the map image attached. Absent on
   * the deterministic HTTP routes, which run with no model at all (NG7).
   */
  llm?: LlmConfig | null;
}

export interface FixerTool {
  name: string;
  description: string;
  /** `read` costs nothing and is unlogged; `draft` writes an ai_generations row. */
  kind: 'read' | 'draft';
  schema: z.ZodType;
  run(args: unknown, ctx: ToolContext): Promise<unknown>;
}

export interface ToolDef<S extends z.ZodType> {
  name: string;
  description: string;
  kind: 'read' | 'draft';
  schema: S;
  run(args: z.output<S>, ctx: ToolContext): Promise<unknown>;
}

export function tool<S extends z.ZodType>(def: ToolDef<S>): FixerTool {
  return def as unknown as FixerTool;
}

/** A bounded, defaulted integer — every list tool takes one. */
export const Limit = (max: number, fallback: number) =>
  z.number().int().min(1).max(max).default(fallback);
