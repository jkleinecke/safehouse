/**
 * At-the-table tools (FR12.8, FR12.9, FR12.11).
 *
 * `check_fog_proximity` is a plain read. `identify_tokens` and
 * `propose_geometry` both produce DRAFTS: a rename or a wall is a change to the
 * table, so it waits for the GM (Principle 8, D13). Neither tool asks the model
 * for numbers — the labels come from the live encounter rows, and the geometry
 * is compiled from a bounded integer schema onto the scene's own grid.
 */
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { scenes } from '@safehouse/db';
import { createDraft, spoilerScan } from './drafts.js';
import { compileLayout, LayoutDoorSchema, LayoutRoomSchema } from './geometry.js';
import { fogProximityState, DEFAULT_PROXIMITY_M } from './proximity.js';
import { activeSceneRow } from './state-core.js';
import { identifyTokensState } from './token-id.js';
import { tool, type FixerTool, type ToolContext } from './tool-kit.js';
import { httpError } from '../services/auth.js';

/** The scene a table tool acts on: the one named, else the active one. */
async function sceneRowFor(ctx: ToolContext, sceneId?: string) {
  const row = sceneId
    ? (await ctx.db.select().from(scenes).where(eq(scenes.id, sceneId)).limit(1))[0]
    : await activeSceneRow(ctx.db, ctx.campaignId);
  if (!row || row.campaignId !== ctx.campaignId) {
    throw httpError(404, 'not_found', 'no scene to work on');
  }
  return row;
}

export const TABLE_TOOLS: readonly FixerTool[] = [
  tool({
    name: 'check_fog_proximity',
    description:
      'Which tokens are standing next to a named fog region that is still hidden ("they are at the lab door"). Read-only: it reveals nothing, it tells you what is worth revealing.',
    kind: 'read',
    schema: z.object({
      sceneId: z.string().optional().describe('Defaults to the active scene'),
      radiusM: z
        .number()
        .min(0)
        .max(50)
        .optional()
        .describe(`How close counts, in metres (default ${DEFAULT_PROXIMITY_M})`),
    }),
    run: async (args, ctx) =>
      fogProximityState(ctx.db, ctx.campaignId, {
        ...(args.sceneId !== undefined ? { sceneId: args.sceneId } : {}),
        ...(args.radiusM !== undefined ? { radiusM: args.radiusM } : {}),
      }),
  }),

  tool({
    name: 'identify_tokens',
    description:
      'Work out who every token on a scene is: number the grunts that share a name, match tokens to characters, NPC templates and combatant rows, and write a one-line "who is this?" for each. Saves the proposed labels as a DRAFT — nothing is renamed until the GM accepts.',
    kind: 'draft',
    schema: z.object({
      sceneId: z.string().optional().describe('Defaults to the active scene'),
      note: z.string().max(400).optional().describe('Why now, for the GM reading the draft'),
    }),
    run: async (args, ctx) => {
      const state = await identifyTokensState(ctx.db, ctx.campaignId, {
        ...(args.sceneId !== undefined ? { sceneId: args.sceneId } : {}),
      });
      // Labels on player-visible tokens travel to every socket, so they get the
      // FR12.19 treatment before the GM can accept them.
      const visible = state.tokens
        .filter((t) => !t.hidden && t.changed)
        .map((t) => t.label)
        .join('\n');
      const spoilerFlags = visible.length > 0 ? await spoilerScan(ctx.db, ctx.campaignId, visible) : [];
      const labels = state.tokens.map((t) => ({
        tokenId: t.tokenId,
        from: t.currentName,
        to: t.label,
        description: t.description,
        hidden: t.hidden,
        confidence: t.confidence,
        match: t.match,
      }));
      const draft = await createDraft(ctx.db, {
        campaignId: ctx.campaignId,
        kind: 'token_label',
        prompt: ctx.prompt,
        model: ctx.model,
        output: {
          sceneId: state.sceneId,
          sceneName: state.sceneName,
          labels,
          spoilerFlags,
          ...(args.note !== undefined ? { note: args.note } : {}),
        },
      });
      return {
        generationId: draft.id,
        status: 'draft',
        sceneId: state.sceneId,
        renames: state.renames,
        spoilerFlags,
        /** The answer to "who's this?" for every token, whether or not it renames. */
        tokens: state.tokens.map((t) => ({
          tokenId: t.tokenId,
          label: t.label,
          description: t.description,
          hidden: t.hidden,
          confidence: t.confidence,
        })),
        appliesTo: 'tokens.name',
        note:
          state.renames === 0
            ? 'Every token is already named correctly; the draft records the descriptions only.'
            : `${state.renames} token(s) would be renamed once the GM accepts.`,
      };
    },
  }),

  tool({
    name: 'propose_geometry',
    description:
      "Lay out a location as rooms on the scene's grid: each room an axis-aligned rectangle measured in WHOLE GRID SQUARES, each door an offset along one named room's wall. The server turns that into walls, doors, zones and named fog regions snapped to the grid, and saves it as a DRAFT for the GM to accept onto the scene. Give real room names — they become the fog regions you will later ask to reveal. Never describe walls yourself; give rooms and doors and let the grid do it.",
    kind: 'draft',
    schema: z.object({
      title: z.string().min(1).max(120).describe('What this layout is, e.g. "Renraku branch office"'),
      sceneId: z.string().optional().describe('Defaults to the active scene'),
      rooms: z.array(LayoutRoomSchema).min(1).max(60),
      doors: z.array(LayoutDoorSchema).max(160).default([]),
      notes: z.string().max(2000).default('').describe('GM-facing notes about the layout'),
      mode: z
        .enum(['merge', 'replace'])
        .default('merge')
        .describe('merge keeps the existing geometry; replace swaps it out'),
    }),
    run: async (args, ctx) => {
      const scene = await sceneRowFor(ctx, args.sceneId);
      const compiled = compileLayout(
        { title: args.title, rooms: args.rooms, doors: args.doors, notes: args.notes },
        scene.grid,
      );
      const draft = await createDraft(ctx.db, {
        campaignId: ctx.campaignId,
        kind: 'geometry',
        prompt: ctx.prompt,
        model: ctx.model,
        output: {
          sceneId: scene.id,
          sceneName: scene.name,
          mode: args.mode,
          title: compiled.title,
          unitM: compiled.unitM,
          grid: compiled.grid,
          rooms: compiled.rooms,
          geometry: compiled.geometry,
          fogRegions: compiled.fogRegions,
          warnings: compiled.warnings,
          notes: compiled.notes,
        },
      });
      return {
        generationId: draft.id,
        status: 'draft',
        sceneId: scene.id,
        title: compiled.title,
        unitM: compiled.unitM,
        rooms: compiled.rooms.map((r) => ({
          name: r.name,
          kind: r.kind,
          sizeM: r.sizeM,
          areaM2: r.areaM2,
        })),
        counts: {
          rooms: compiled.rooms.length,
          walls: compiled.geometry.walls.length,
          doors: compiled.geometry.doors.length,
          zones: compiled.geometry.zones.length,
          fogRegions: compiled.fogRegions.length,
        },
        warnings: compiled.warnings,
        appliesTo: 'scenes.geometry',
        note: 'Saved as a draft. The Grid draws it once the GM accepts; fog regions arrive unrevealed.',
      };
    },
  }),
];
