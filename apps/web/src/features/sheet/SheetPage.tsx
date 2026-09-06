/**
 * /c/:campaignId/sheet/:characterId — the phone-first character sheet
 * (DESIGN.md FR3.2–3.6). Pinned identity/condition strip over a tab deck;
 * every derived number expands to its provenance (Principle 3) and accepts an
 * override (Principle 2); rolls preview locally and resolve server-side.
 *
 * LIVE-1: everything here hydrates from REST on mount and re-hydrates on
 * reconnect (`HYDRATE_ON_MOUNT`, `useSheetLive`), so a reload mid-session
 * shows the world as it is rather than an empty sheet waiting for the next
 * WebSocket frame.
 */
import { useCallback, useMemo, useRef, useState, type ReactElement } from 'react';
import { useParams } from 'react-router-dom';
import type { SheetV1 } from '@safehouse/contracts';
import {
  useCharacter,
  useConditionMutation,
  useDerivedView,
  useEdgeActionMutation,
  useEdgeMutation,
  useSheetMutation,
} from './api.js';
import { findCloseCallOffer } from './edgeActions.js';
import {
  clearOverride,
  findOverride,
  upsertOverride,
  type ConditionState,
  type EdgeOp,
} from './lib.js';
import { SHEET_TABS, useSheetPlayStore, type SheetTab } from './playState.js';
import { useSheetLive } from './useSheetLive.js';
import { useLiveStore } from '../../live/store.js';
import CloseCallOfferCard from './components/CloseCallOffer.js';
import IdentityStrip from './components/IdentityStrip.js';
import PortraitControl from './components/PortraitControl.js';
import type { OverrideApi } from './components/Provenance.js';
import RollDialog from './components/RollDialog.js';
import { withPendingRangeChip, type RollConfig } from './rollDialogState.js';
import { usePendingRollMod } from './usePendingRollMod.js';
import BackgroundTab from './tabs/BackgroundTab.js';
import CombatTab from './tabs/CombatTab.js';
import ContactsTab from './tabs/ContactsTab.js';
import GearTab from './tabs/GearTab.js';
import LedgerTab from './tabs/LedgerTab.js';
import MagicTab from './tabs/MagicTab.js';
import SkillsTab from './tabs/SkillsTab.js';
import type { TabProps } from './tabs/shared.js';

function Notice({ title, body }: { title: string; body: string }) {
  return (
    <div className="p-6">
      <div className="panel p-6 text-center">
        <div className="mono-label text-cyan">Sheet</div>
        <h1 className="mt-3 text-base font-semibold text-ink">{title}</h1>
        <p className="mt-1.5 text-sm text-dim">{body}</p>
      </div>
    </div>
  );
}

const TAB_VIEWS: Record<SheetTab, (props: TabProps) => ReactElement | null> = {
  skills: SkillsTab,
  combat: CombatTab,
  magic: MagicTab,
  gear: GearTab,
  contacts: ContactsTab,
  background: BackgroundTab,
  ledger: LedgerTab,
};

export default function SheetPage() {
  const { campaignId = '', characterId = '' } = useParams<{
    campaignId: string;
    characterId: string;
  }>();

  useSheetLive(characterId);

  const characterQuery = useCharacter(characterId);
  const character = characterQuery.data;
  const viewQuery = useDerivedView(character);
  const view = viewQuery.data;

  const sheetMutation = useSheetMutation(characterId);
  const conditionMutation = useConditionMutation(characterId);
  const edgeMutation = useEdgeMutation(characterId);
  const edgeActionMutation = useEdgeActionMutation(characterId);

  const tab = useSheetPlayStore((s) => s.tab[characterId] ?? 'skills');
  const setTab = useSheetPlayStore((s) => s.setTab);

  // Close Call (FR2.3): a glitch this character just rolled, until it is
  // bought off or waved away. Read from the live event buffer, which the
  // socket also backfills on reconnect.
  const events = useLiveStore((s) => s.events);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const closeCall = useMemo(
    () => findCloseCallOffer(events, characterId, new Set(dismissed)),
    [events, characterId, dismissed],
  );

  // Roll dialog host: a bumped seq gives each roll a fresh dialog (and lets a
  // chained roll — cast → drain — replace the one that just closed).
  const seq = useRef(0);
  const [pendingRoll, setPendingRoll] = useState<{
    seq: number;
    config: RollConfig;
    onSent?: () => void;
  } | null>(null);

  // A range measured on the Grid rides into whatever the player rolls next
  // (FR9.9). Read through a ref-free hook and folded in at the single funnel
  // every tab's roll passes through, so no tab has to remember to do it.
  const pendingMod = usePendingRollMod();
  const pendingRef = useRef(pendingMod);
  pendingRef.current = pendingMod;

  const openRoll = useCallback((config: RollConfig, onSent?: () => void) => {
    seq.current += 1;
    setPendingRoll({
      seq: seq.current,
      config: withPendingRangeChip(config, pendingRef.current),
      ...(onSent ? { onSent } : {}),
    });
  }, []);

  const patchSheet = useCallback(
    (next: SheetV1) => sheetMutation.mutate(next),
    [sheetMutation],
  );
  const setCondition = useCallback(
    (next: ConditionState) => conditionMutation.mutate(next),
    [conditionMutation],
  );
  const onEdgeOp = useCallback((op: EdgeOp) => edgeMutation.mutate(op), [edgeMutation]);

  const sheet = character?.sheet;
  const overrideFor = useCallback(
    (target: string): OverrideApi => {
      const existing = sheet ? findOverride(sheet, target) : undefined;
      return {
        ...(existing
          ? {
              current: {
                value: existing.value,
                ...(existing.note ? { note: existing.note } : {}),
              },
            }
          : {}),
        set: (value: number, note?: string) => {
          if (sheet) patchSheet(upsertOverride(sheet, target, value, note));
        },
        clear: () => {
          if (sheet) patchSheet(clearOverride(sheet, target));
        },
      };
    },
    [sheet, patchSheet],
  );

  if (characterQuery.isPending) {
    return <Notice title="Loading…" body="Pulling the sheet off the host." />;
  }
  if (characterQuery.isError || !character || !sheet) {
    return (
      <Notice
        title="Sheet unavailable"
        body={
          characterQuery.error instanceof Error
            ? characterQuery.error.message
            : 'This character could not be loaded.'
        }
      />
    );
  }
  if (!view) {
    return <Notice title="Deriving…" body="Running the rules engine over the sheet." />;
  }

  const derived = view.derived;
  const tabProps: TabProps = {
    character,
    derived,
    campaignId,
    patchSheet,
    setCondition,
    roll: openRoll,
    overrideFor,
  };
  const TabView = TAB_VIEWS[tab];

  /** Left/Right move between tabs — the WAI-ARIA tablist keyboard pattern. */
  const onTabKey = (e: React.KeyboardEvent, index: number) => {
    const delta = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (delta === 0) return;
    e.preventDefault();
    const next = SHEET_TABS[(index + delta + SHEET_TABS.length) % SHEET_TABS.length];
    if (next) setTab(characterId, next.id);
  };

  return (
    <div className="pb-8">
      <div className="sticky top-0 z-30 border-b border-edge bg-deck/95 backdrop-blur">
        <IdentityStrip
          portrait={
            <PortraitControl
              subject={{
                id: character.id,
                name: character.name,
                alias: character.sheet.identity.alias,
                ownerUserId: character.ownerUserId,
                portraitId: character.sheet.identity.portraitId ?? null,
              }}
            />
          }
          character={character}
          derived={derived}
          overrideFor={overrideFor}
          onCondition={setCondition}
          onEdgeOp={onEdgeOp}
          busy={edgeMutation.isPending}
          edgeActions={{
            combatantId: view.combatantId,
            onAction: (action) => {
              if (!view.combatantId) return;
              edgeActionMutation.mutate({ action, combatantId: view.combatantId });
            },
            pending: edgeActionMutation.isPending,
          }}
        />
        <nav
          className="flex gap-1 overflow-x-auto border-t border-edge/70 px-2"
          role="tablist"
          aria-label="Character sheet sections"
        >
          {SHEET_TABS.map((t, i) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              tabIndex={tab === t.id ? 0 : -1}
              className={`shrink-0 border-b-2 px-2.5 py-2 font-label text-[0.65rem] uppercase tracking-widest transition-colors ${
                tab === t.id
                  ? 'border-cyan text-cyan'
                  : 'border-transparent text-dim hover:text-ink'
              }`}
              onClick={() => setTab(characterId, t.id)}
              onKeyDown={(e) => onTabKey(e, i)}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </div>

      {closeCall && (
        <CloseCallOfferCard
          offer={closeCall}
          edgeCurrent={sheet.attributes.edg.current}
          busy={edgeActionMutation.isPending}
          onDismiss={() => setDismissed((d) => [...d, closeCall.rollId])}
          onSpend={() =>
            edgeActionMutation.mutate(
              {
                action: 'close_call',
                rollId: closeCall.rollId,
                combatantId: view.combatantId,
              },
              { onSuccess: () => setDismissed((d) => [...d, closeCall.rollId]) },
            )
          }
        />
      )}

      <TabView {...tabProps} />

      {pendingRoll && (
        <RollDialog
          key={pendingRoll.seq}
          open
          onClose={() => setPendingRoll(null)}
          campaignId={campaignId}
          characterId={characterId}
          edgeCurrent={sheet.attributes.edg.current}
          config={pendingRoll.config}
          onSent={() => pendingRoll.onSent?.()}
        />
      )}
    </div>
  );
}
