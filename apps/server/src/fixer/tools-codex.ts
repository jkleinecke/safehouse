/**
 * The rest of the FR12.17 catalog: `search_codex`, `get_page`,
 * `list_contacts`, `list_runs` / `get_run`, `get_calendar`, and the
 * `get_magic_state` / `get_matrix_state` snapshots.
 *
 * Every tool here is READ-ONLY — `kind: 'read'`, no `ai_generations` row, no
 * mutation of any kind — and every one goes through the live readers in
 * `state-codex.ts`, so what the model sees is what the table is playing with at
 * the moment it asked.
 */
import { z } from 'zod';
import { Limit, tool, type FixerTool } from './tool-kit.js';
import {
  getBookPageState,
  getCalendarState,
  getRunState,
  listContactsState,
  listRunsState,
  searchCodexState,
} from './state-codex.js';
import { getMagicState, getMatrixState } from './state-play.js';

export const CODEX_TOOLS: readonly FixerTool[] = [
  tool({
    name: 'search_codex',
    description:
      "Full-text search over the campaign's own codex — locations, factions, NPC pages, run write-ups, lore. GM-only pages are included and flagged `gmOnly: true`; never read those aloud to players without the GM saying so.",
    kind: 'read',
    schema: z.object({
      query: z.string().min(2).describe('Search terms; quoted phrases and -exclusions work'),
      kind: z
        .string()
        .optional()
        .describe('Limit to one page kind, e.g. location | faction | npc | run'),
      limit: Limit(20, 5),
    }),
    run: async (args, ctx) =>
      searchCodexState(ctx.db, ctx.campaignId, args.query, {
        ...(args.kind !== undefined ? { kind: args.kind } : {}),
        limit: args.limit,
      }),
  }),

  tool({
    name: 'get_page',
    description:
      "The full extracted text of one printed page from the GM's library, addressed as a ref: book code plus printed page. Use it after search_books when you need the surrounding paragraph. The ref it returns is where the text physically came from — cite that, nothing else.",
    kind: 'read',
    schema: z.object({
      book: z.string().min(1).max(8).describe('Book code, e.g. SR5'),
      page: z.number().int().min(1).max(2000).describe('PRINTED page number, not the PDF page'),
    }),
    run: async (args, ctx) => getBookPageState(ctx.db, args.book, args.page),
  }),

  tool({
    name: 'list_contacts',
    description:
      "Each character's contacts with Connection and Loyalty, plus any favors owed or owing the GM wrote in the note, and the codex page a contact links to. Ask this before inventing anyone the team already knows.",
    kind: 'read',
    schema: z.object({
      characterId: z.string().optional().describe('Omit for the whole party'),
    }),
    run: async (args, ctx) =>
      listContactsState(ctx.db, ctx.campaignId, {
        ...(args.characterId !== undefined ? { characterId: args.characterId } : {}),
      }),
  }),

  tool({
    name: 'list_runs',
    description:
      'The jobs in this campaign: title, state (prep/running/done), the Johnson page, agreed payout and awards, and whether an after-action recap exists.',
    kind: 'read',
    schema: z.object({
      state: z.string().optional().describe('Filter by state, e.g. prep'),
    }),
    run: async (args, ctx) =>
      listRunsState(ctx.db, ctx.campaignId, {
        ...(args.state !== undefined ? { state: args.state } : {}),
      }),
  }),

  tool({
    name: 'get_run',
    description:
      'One run in full: objectives, opposition links, payout, awards, the recap, and every karma/nuyen ledger line already booked against it.',
    kind: 'read',
    schema: z.object({ runId: z.string().describe('Run id from list_runs') }),
    run: async (args, ctx) => getRunState(ctx.db, ctx.campaignId, args.runId),
  }),

  tool({
    name: 'get_calendar',
    description:
      'The in-game timeline: current campaign date, the GM-pinned beats (with the ones still ahead called out), sessions past and planned, runs, and every lifestyle with its paid-through date and whether rent is overdue. Dates are Sixth World, not real-world, except session dates.',
    kind: 'read',
    schema: z.object({}),
    run: async (_args, ctx) => getCalendarState(ctx.db, ctx.campaignId),
  }),

  tool({
    name: 'get_magic_state',
    description:
      'Awakened bookkeeping right now: spells and adept powers per character, what each of them is sustaining and the dice penalty that costs, and any foci on the sheet. Spirits and services are not tracked by the app yet — it says so rather than reporting zero.',
    kind: 'read',
    schema: z.object({}),
    run: async (_args, ctx) => getMagicState(ctx.db, ctx.campaignId),
  }),

  tool({
    name: 'get_matrix_state',
    description:
      "Matrix bookkeeping: each character's deck (ASDF and programs) and complex forms, plus the GM's host roster with ratings and IC. Overwatch scores and marks are run by hand and reported as untracked — do not guess them.",
    kind: 'read',
    schema: z.object({}),
    run: async (_args, ctx) => getMatrixState(ctx.db, ctx.campaignId),
  }),
];
