/**
 * Tactical hints (FR10.10) — the client half.
 *
 * On the acting NPC's turn the GM can get one line of the kind a co-GM would
 * mutter. The FR says three things about it and all three are load-bearing:
 * **optional**, **off by default**, and **never automation**.
 *
 * The server enforces all three (`services/tactical-hints.ts`): the route is
 * GM-only, the line is withheld unless `campaigns.settings.tacticalHints` is
 * exactly `true`, and the payload has no id, no target and no verb — there is
 * literally nothing to POST back. So nothing here is a security boundary; a
 * hint that reached a player's device would already be a server bug, and no
 * client-side check would have saved it (Principle 4).
 *
 * What this file owns is the *offer*: the toggle where the GM would look for
 * it, and the rule for when a line is worth putting on a row. That rule is
 * narrower than "did the server send one" — a hint on a spent row is noise,
 * and hints on twelve rows at once are advice nobody reads.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiPatch } from '../../api/client.js';
import { useCampaign, type CampaignSummary } from '../../api/campaigns.js';
import type { TacticalHint } from './quickRolls.js';

export type { TacticalHint } from './quickRolls.js';

/** The settings key. Named once, here, so the toggle and the server agree. */
export const HINTS_SETTING = 'tacticalHints';

/**
 * The server's rule, mirrored exactly: only a literal `true` is on.
 *
 * A truthy-ish value ("yes", 1) reading as ON here while the server reads it
 * as OFF would put the toggle in a state the table never actually gets, which
 * is a worse bug than the feature being off.
 */
export function hintsEnabled(settings: Record<string, unknown> | null | undefined): boolean {
  return settings?.[HINTS_SETTING] === true;
}

/**
 * When a row gets a line.
 *
 * `acting` is the whole of it beyond role: FR10.10 is a hint on *the acting
 * NPC's turn*, not a column of advice down the tracker. The GM check is
 * belt-and-braces over a GM-only route — a player device never has the payload
 * to render.
 */
export function shouldShowHint(input: {
  isGm: boolean;
  acting: boolean;
  hint: TacticalHint | undefined;
}): boolean {
  return input.isGm && input.acting && input.hint !== undefined;
}

/**
 * What the GM reads under the line: the tag it came from, and the fact that it
 * is advice. Provenance in the Principle 3 spirit — a number the app shows can
 * always be traced, and so can a sentence.
 */
export function hintProvenance(hint: TacticalHint): string {
  return `suggestion · ${hint.why} · nothing here acts on its own`;
}

/** Screen-reader name: says it is a suggestion before it says anything else. */
export function hintAriaLabel(hint: TacticalHint, name: string): string {
  return `Tactical suggestion for ${name} (${hint.roleTag}): ${hint.text}. Advisory only — it takes no action.`;
}

// ---------------------------------------------------------------------------
// The toggle
// ---------------------------------------------------------------------------

export interface HintsSetting {
  enabled: boolean;
  /** False while the campaign read is in flight, or for a non-GM device. */
  ready: boolean;
  pending: boolean;
  toggle: () => void;
  error: unknown;
}

/**
 * Read and flip `campaigns.settings.tacticalHints` (GM only — `settings` is
 * filtered out of a player's campaign read server-side, so a player device
 * simply never sees the flag and the toggle never renders).
 *
 * Flipping it invalidates the quick-roll reads as well as the campaign: those
 * are cached for ten seconds, so without it the GM would flip the switch and
 * watch nothing happen for most of a combat pass.
 */
export function useHintsSetting(campaignId: string, isGm: boolean): HintsSetting {
  const qc = useQueryClient();
  const campaign = useCampaign(campaignId);
  const settings = campaign.data?.settings;

  const mutation = useMutation({
    mutationFn: (next: boolean) =>
      apiPatch<CampaignSummary>(`/api/campaigns/${campaignId}`, {
        settings: { [HINTS_SETTING]: next },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['campaign', campaignId] });
      void qc.invalidateQueries({ queryKey: ['combatant'] });
    },
  });

  return {
    enabled: hintsEnabled(settings),
    ready: isGm && settings !== undefined,
    pending: mutation.isPending,
    toggle: () => mutation.mutate(!hintsEnabled(settings)),
    error: mutation.error,
  };
}
