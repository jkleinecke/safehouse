/**
 * The mage's working surface (FR8.2–FR8.4): who is holding which spell up, the
 * spirit tracker, the focus rack, the reagent counter — and the spellbook,
 * rendered with the pools that have the foci folded into them.
 *
 * LIVE-1 is the rule it is built around. Everything here hydrates from
 * `GET /api/characters/:id/magic/derived` on mount and on reconnect; the
 * `magic.updated` frames that follow only ever refine that. An empty rack means
 * the server says the rack is empty, never "no events have arrived yet" — which
 * is why the loading state says so out loud instead of rendering zeros.
 */
import type { DerivedCharacter, WsEvent } from '@safehouse/contracts';
import { toggleSustain } from '../lib.js';
import type { TabProps } from '../tabs/shared.js';
import {
  useAddFocus,
  useDismissSpirit,
  useFocusToggle,
  useMagicLive,
  useMagicView,
  useReagentOp,
  useRemoveFocus,
  useSpendService,
  useSpiritJoin,
  useSpiritPatch,
  useSpiritSustain,
  useSummonSpirit,
  useSustainedOp,
} from './api.js';
import { magicLogLines } from './events.js';
import { liveSpirits, releaseSteps, sustainedRows } from './lib.js';
import { emptyMagicView } from './types.js';
import FociRack from './FociRack.js';
import ReagentCounter from './ReagentCounter.js';
import SpellBook from './SpellBook.js';
import SpiritList from './SpiritList.js';
import SustainedList from './SustainedList.js';

export interface MagicWorkbenchProps extends TabProps {
  /**
   * The fight a spirit can be sent into, or null. Passed in rather than read
   * from the live store here so the panel stays renderable from a fixture —
   * `MagicPanel` is the half that knows where live state lives.
   */
  encounter: { id: string; name: string } | null;
  /** The campaign log window, for the magic lines at the foot of the tab. */
  events: readonly WsEvent[];
  /** Placing figures on the tracker is the GM's (server-enforced). */
  isGm: boolean;
}

function messageOf(...errors: Array<unknown>): string | null {
  for (const err of errors) {
    if (err instanceof Error) return err.message;
  }
  return null;
}

/** A stable id per spell, so casting the same spell twice does not stack rows. */
export function sustainedIdFor(spellName: string): string {
  const slug = spellName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `spell.${slug || 'effect'}`;
}

export default function MagicWorkbench(props: MagicWorkbenchProps) {
  const { character, campaignId } = props;
  const characterId = character.id;

  useMagicLive(characterId);
  const query = useMagicView(characterId);
  const view = query.data ?? emptyMagicView(characterId);
  const derived: DerivedCharacter = view.derived ?? props.derived;
  const preview = { sheet: character.sheet, wounds: character.condition };

  const spend = useSpendService(campaignId, characterId);
  const patchSpirit = useSpiritPatch(campaignId, characterId);
  const dismiss = useDismissSpirit(campaignId, characterId);
  const join = useSpiritJoin(campaignId, characterId);
  const sustain = useSpiritSustain(campaignId, characterId);
  const summon = useSummonSpirit(campaignId, characterId);
  const toggleFocus = useFocusToggle(characterId, preview);
  const addFocus = useAddFocus(characterId);
  const removeFocus = useRemoveFocus(characterId);
  const reagents = useReagentOp(characterId);
  const sustained = useSustainedOp(characterId);

  const rows = sustainedRows(view, character.sheet);
  const spirits = liveSpirits(view);
  const log = magicLogLines(props.events);

  // Explicit rather than spread: the spellbook takes the sheet's tab props and
  // the magic-derived pools, and nothing about spirits or the log.
  const spellbook = (
    <SpellBook
      character={character}
      campaignId={campaignId}
      derived={derived}
      patchSheet={props.patchSheet}
      setCondition={props.setCondition}
      roll={props.roll}
      overrideFor={props.overrideFor}
      sustainedNames={rows.map((r) => r.name)}
      onSustain={(name) => sustained.mutate({ op: 'add', id: sustainedIdFor(name), name })}
    />
  );

  if (query.isPending) {
    return (
      <>
        <p className="py-4 text-center text-sm text-faint">Reading the tracker…</p>
        {spellbook}
      </>
    );
  }

  if (query.isError) {
    return (
      <>
        <p className="py-4 text-center text-sm text-faint" role="status">
          The magic tracker is not answering
          {messageOf(query.error) ? ` — ${messageOf(query.error)}` : ''}.
        </p>
        {spellbook}
      </>
    );
  }

  return (
    <>
      <SustainedList
        rows={rows}
        spirits={spirits}
        busy={sustained.isPending || sustain.isPending}
        onRelease={(row) => {
          // Ordered: a spirit lets go before the entry disappears, or it is
          // left holding an id that no longer exists (see `releaseSteps`).
          for (const step of releaseSteps(row)) {
            if (step.op === 'sheet_toggle') props.patchSheet(toggleSustain(character.sheet, step.name));
            else if (step.op === 'take_back') {
              sustain.mutate(
                { spiritId: step.spiritId, sustainedId: null },
                { onSuccess: () => sustained.mutate({ op: 'remove', id: step.sustainedId }) },
              );
              return;
            } else sustained.mutate({ op: 'remove', id: step.id });
          }
        }}
        onSetExempt={(row, exempt) => sustained.mutate({ op: 'toggle', id: row.id, exempt })}
        onHandToSpirit={(row, spiritId) => {
          if (spiritId) sustain.mutate({ spiritId, sustainedId: row.id });
          else if (row.spiritId) sustain.mutate({ spiritId: row.spiritId, sustainedId: null });
        }}
      />

      {spellbook}

      <SpiritList
        spirits={view.spirits}
        encounterId={props.encounter?.id ?? null}
        encounterName={props.encounter?.name ?? null}
        canPlaceOnTracker={props.isGm}
        busy={spend.isPending || join.isPending || dismiss.isPending}
        error={messageOf(spend.error, join.error, dismiss.error, summon.error, patchSpirit.error)}
        onSpendService={(spiritId) => spend.mutate({ spiritId })}
        onSetBound={(spiritId, bound) => patchSpirit.mutate({ spiritId, patch: { bound } })}
        onDismiss={(spiritId) => dismiss.mutate(spiritId)}
        onJoin={(spiritId, encounterId) => join.mutate({ spiritId, encounterId })}
        onSummon={(input) => summon.mutate(input)}
      />

      <FociRack
        foci={view.foci}
        derived={derived}
        overrideFor={props.overrideFor}
        busy={toggleFocus.isPending}
        onToggle={(focusId, patch) => toggleFocus.mutate({ focusId, patch })}
        onAdd={(input) => addFocus.mutate(input)}
        onRemove={(focusId) => removeFocus.mutate(focusId)}
      />

      <ReagentCounter
        drams={view.reagents}
        busy={reagents.isPending}
        onSpend={(amount) => reagents.mutate({ op: 'spend', amount })}
        onRestock={(amount) => reagents.mutate({ op: 'restock', amount })}
      />

      {log.length > 0 && (
        <div className="mt-4 rounded border border-edge/70 bg-raised/40 p-2">
          <div className="mono-label mb-1">Magic in the log</div>
          <ul className="space-y-0.5">
            {log.map((line) => (
              <li key={line.id} className="text-xs text-dim">
                {line.text}
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
