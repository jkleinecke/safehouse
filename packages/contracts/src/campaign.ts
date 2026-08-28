import { z } from 'zod';
import { VisibilitySchema } from './common.js';

export const CurrencySchema = z.enum(['karma', 'nuyen']);
export type Currency = z.infer<typeof CurrencySchema>;

export const LedgerStateSchema = z.enum(['pending', 'approved', 'rejected']);
export type LedgerState = z.infer<typeof LedgerStateSchema>;

/**
 * Append-only karma/nuyen ledger entry (FR3.6). Balances are sums —
 * no free-floating numbers. Player spends start 'pending'.
 */
export const LedgerEntrySchema = z.object({
  id: z.string(),
  characterId: z.string(),
  currency: CurrencySchema,
  delta: z.number(),
  reason: z.string().min(1),
  state: LedgerStateSchema.default('pending'),
  sessionId: z.string().nullable().optional(),
  runId: z.string().nullable().optional(),
  createdBy: z.string().optional(),
  approvedBy: z.string().nullable().optional(),
  /** ISO timestamp. */
  createdAt: z.string().optional(),
});
export type LedgerEntry = z.infer<typeof LedgerEntrySchema>;

export const RollTableKindSchema = z.enum(['names', 'quirks', 'motivations', 'custom']);
export type RollTableKind = z.infer<typeof RollTableKindSchema>;

export const RollTableEntrySchema = z.object({
  weight: z.number().positive().default(1),
  text: z.string().min(1),
});
export type RollTableEntry = z.infer<typeof RollTableEntrySchema>;

/**
 * A weighted rollable table (FR2.11): run complications, loot, weather, rumor
 * mill — and the generator's flavor tables (FR10.2). Shipped defaults are
 * original writing only (G6).
 */
export const RollTableSchema = z.object({
  id: z.string(),
  /** Null → an instance-level default table. */
  campaignId: z.string().nullable().optional(),
  kind: RollTableKindSchema.default('custom'),
  title: z.string().min(1),
  entries: z.array(RollTableEntrySchema).default([]),
  visibility: VisibilitySchema.default('public'),
});
export type RollTable = z.infer<typeof RollTableSchema>;

/**
 * A registered rulebook PDF (M11). `pageOffset` maps printed page → PDF page
 * (printed + offset = pdf); the core book's is +5, measured (FR11.1).
 */
export const BookSchema = z.object({
  id: z.string().optional(),
  campaignId: z.string().optional(),
  /** Short code: 'SR5', 'RG', 'SG', … */
  code: z.string().min(1).max(12),
  title: z.string().min(1),
  pageOffset: z.number().int().default(0),
  /** Shared with the whole table (FR11.5, default per 0.4 decision). */
  shared: z.boolean().default(true),
  /** File-store attachment id of the PDF. */
  attachmentId: z.string().optional(),
});
export type Book = z.infer<typeof BookSchema>;
