/**
 * /c/:campaignId/sheet/:characterId — the phone-first character sheet
 * (DESIGN.md FR3.2–3.6). Pinned identity/condition strip over a tab deck;
 * every derived number expands to its provenance (Principle 3) and accepts an
 * override (Principle 2); rolls preview locally and resolve server-side.
 */
import { useCallback, useRef, useState, type ReactElement } from 'react';
import { useParams } from 'react-router-dom';
import type { SheetV1 } from '@safehouse/contracts';
import {
  useCharacter,
  useConditionMutation,
  useDerived,
  useEdgeMutation,
  useSheetMutation,
} from './api.js';
import {
  clearOverride,
  findOverride,
  upsertOverride,
  type ConditionState,
  type EdgeOp,
} from './lib.js';
import { SHEET_TABS, useSheetPlayStore, type SheetTab } from './playState.js';
import { useSheetLive } from './useSheetLive.js';
import IdentityStrip from './components/IdentityStrip.js';
import type { OverrideApi } from './components/Provenance.js';
import RollDialog, { type RollConfig } from './components/RollDialog.js';
import BackgroundTab from './tabs/BackgroundTab.js';
import CombatTab from './tabs/CombatTab.js';
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
  const derivedQuery = useDerived(character);
  const derived = derivedQuery.data;

  const sheetMutation = useSheetMutation(characterId);
  const conditionMutation = useConditionMutation(characterId);
  const edgeMutation = useEdgeMutation(characterId);

  const tab = useSheetPlayStore((s) => s.tab[characterId] ?? 'skills');
  const setTab = useSheetPlayStore((s) => s.setTab);

  // Roll dialog host: a bumped seq gives each roll a fresh dialog (and lets a
  // chained roll — cast → drain — replace the one that just closed).
  const seq = useRef(0);
  const [pendingRoll, setPendingRoll] = useState<{
    seq: number;
    config: RollConfig;
    onSent?: () => void;
  } | null>(null);

  const openRoll = useCallback((config: RollConfig, onSent?: () => void) => {
    seq.current += 1;
    setPendingRoll({ seq: seq.current, config, ...(onSent ? { onSent } : {}) });
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
  if (!derived) {
    return <Notice title="Deriving…" body="Running the rules engine over the sheet." />;
  }

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

  return (
    <div className="pb-8">
      <div className="sticky top-0 z-30 border-b border-edge bg-deck/95 backdrop-blur">
        <IdentityStrip
          character={character}
          derived={derived}
          overrideFor={overrideFor}
          onCondition={setCondition}
          onEdgeOp={onEdgeOp}
          busy={edgeMutation.isPending}
        />
        <nav className="flex gap-1 overflow-x-auto border-t border-edge/70 px-2" role="tablist">
          {SHEET_TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              className={`shrink-0 border-b-2 px-2.5 py-2 font-label text-[0.65rem] uppercase tracking-widest transition-colors ${
                tab === t.id
                  ? 'border-cyan text-cyan'
                  : 'border-transparent text-dim hover:text-ink'
              }`}
              onClick={() => setTab(characterId, t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </div>

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
