/**
 * `draft_recap` (FR12.12) — the Fixer writes the session up for the GM to edit.
 *
 * P4's exit clause says recaps write themselves for editing. This is that tool,
 * and it is deliberately *not* `draft_wiki_page` with a different prompt:
 *
 *  - the facts come from the log, not the model (`fixer/recap.ts`), so no
 *    number in a recap was ever hallucinated (D13);
 *  - the FR12.19 spoiler guard runs **unconditionally**, because a recap is
 *    player-facing by definition — FR6.3 posts it to Discord, and with the app
 *    offline to players between sessions it is their only window into the
 *    campaign. A GM-only name in it is not a style problem;
 *  - the draft lands on the session (`game_sessions.recap_md`) on accept, which
 *    is exactly what `POST /api/sessions/:id/publish-recap` reads — so the
 *    accepted draft is one GM tap away from the players, and never closer
 *    (Principle 8).
 */
import { z } from 'zod';
import { createDraft, spoilerScan } from './drafts.js';
import { assembleRecap, recapDigest, recapSessionRow } from './recap.js';
import { tool, type FixerTool } from './tool-kit.js';

const Moment = z.object({
  title: z.string().min(1).max(120).describe('Three or four words naming the beat'),
  text: z.string().min(1).max(1200).describe('What happened, in the table’s own terms'),
});

const Contribution = z.object({
  who: z.string().min(1).max(80).describe('Character or NPC name as the table says it'),
  what: z.string().min(1).max(600),
});

export const RECAP_TOOLS: readonly FixerTool[] = [
  tool({
    name: 'draft_recap',
    description:
      'Write the session recap as a DRAFT for the GM to edit and publish (FR12.12). Call get_session_log first and base every beat on what is actually in it. Write ONLY prose — headline moments, who did what, the cliffhanger; the server adds the roll tallies, casualties, reveals and karma/nuyen awards from the log itself, so never state a number yourself. The recap is what the players read between sessions, so it is spoiler-checked against GM-only material and you will be told what it flagged.',
    kind: 'draft',
    schema: z.object({
      sessionId: z
        .string()
        .optional()
        .describe('Defaults to the live session, else the most recent one'),
      title: z.string().min(1).max(160).default('Session recap'),
      headline: z
        .string()
        .min(1)
        .max(2000)
        .describe('The opening paragraph: where the team started and what the job turned into'),
      moments: z.array(Moment).max(8).default([]).describe('Headline moments, in play order'),
      whoDidWhat: z
        .array(Contribution)
        .max(12)
        .default([])
        .describe('One line per runner — what they actually did, not what they are like'),
      cliffhanger: z
        .string()
        .max(1200)
        .default('')
        .describe('Where the session stopped and what is hanging over the next one'),
    }),
    run: async (args, ctx) => {
      const session = await recapSessionRow(ctx.db, ctx.campaignId, args.sessionId);
      const digest = await recapDigest(ctx.db, ctx.campaignId, session);
      const recapMd = assembleRecap(
        args.title,
        {
          headline: args.headline,
          moments: args.moments,
          whoDidWhat: args.whoDidWhat,
          cliffhanger: args.cliffhanger,
        },
        digest,
      );
      // Unconditional (FR12.19): a recap has no GM-only mode to fall back on.
      const spoilerFlags = await spoilerScan(
        ctx.db,
        ctx.campaignId,
        `${args.title}\n${recapMd}`,
      );
      const draft = await createDraft(ctx.db, {
        campaignId: ctx.campaignId,
        kind: 'recap',
        prompt: ctx.prompt,
        model: ctx.model,
        output: {
          sessionId: session.id,
          sessionDate: session.date,
          title: args.title,
          recapMd,
          digest,
          spoilerFlags,
          playerFacing: true,
        },
      });
      return {
        generationId: draft.id,
        status: 'draft',
        sessionId: session.id,
        title: args.title,
        recapMd,
        spoilerFlags,
        /** What the log actually gave us — so the Fixer can say what it saw. */
        facts: {
          publicRolls: digest.rolls.total,
          bestHits: digest.rolls.best,
          glitches: digest.rolls.glitches,
          criticals: digest.rolls.criticals,
          down: digest.down,
          reveals: digest.reveals,
          scenes: digest.sceneMarkers,
          awards: digest.awards.length,
          hiddenRolls: digest.hiddenRolls,
          gmOnlyEvents: digest.events.gmOnly,
        },
        appliesTo: 'game_sessions.recap_md',
        note:
          spoilerFlags.length > 0
            ? `Draft saved, but it names GM-only material (${spoilerFlags
                .map((f) => f.name)
                .join(', ')}) — tell the GM to reveal or cut before publishing.`
            : 'Saved as a draft recap. Accepting puts it on the session; publishing to Discord stays a separate GM action.',
      };
    },
  }),
];
