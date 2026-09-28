/**
 * The order on a phone. The rail is hidden below md, so a chip on the map says
 * who is up and who is next, and a tap opens the tracker as a sheet: the GM
 * runs the fight from it, a runner fills their own initiative there.
 */
import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Encounter, Token } from '@safehouse/contracts';
import { useMyCharacterId } from '../../../api/campaigns.js';
import { getSession } from '../../../api/session.js';
import { useTrackerEncounter } from '../../table/commands.js';
import { trackerRows, type TrackerRow, type Viewer } from '../../table/initiative.js';
import Tracker from '../../table/Tracker.js';
import '../../table/table.css';
import FightFromMap from './FightFromMap.js';

/** The chip's words: the turn, who is up, who is next; or what the fight is waiting on. */
export function orderSummary(encounter: Encounter | null, rows: readonly TrackerRow[]): { text: string; warn: boolean } {
  if (!encounter) return { text: 'fight', warn: false };
  if (encounter.state === 'prep') return { text: 'fight · not started', warn: false };
  if (encounter.state === 'done') return { text: 'fight · over', warn: false };
  if (encounter.gathering) {
    const mine = rows.some((r) => r.own && !r.rolled);
    return { text: mine ? 'roll initiative' : 'initiative', warn: mine };
  }
  const up = rows.find((r) => r.acting)?.combatant.name ?? (encounter.gmTurn ? 'GM’s turn' : null);
  const next = rows.find((r) => r.state === 'next')?.combatant.name;
  const turn = `T${Math.max(1, encounter.turn)}·P${Math.max(1, encounter.pass)}`;
  return { text: [turn, up, next ? `next ${next}` : null].filter(Boolean).join(' · '), warn: false };
}

export interface OrderChipProps {
  campaignId: string;
  sceneId: string;
  sceneName: string;
  tokens: readonly Token[];
}

export default function OrderChip({ campaignId, sceneId, sceneName, tokens }: OrderChipProps) {
  const session = getSession();
  const isGm = session?.role === 'gm';
  const myCharacterId = useMyCharacterId(campaignId);
  const viewer: Viewer = useMemo(
    () => ({ role: session?.role ?? 'observer', ...(myCharacterId ? { characterId: myCharacterId } : {}) }),
    [session?.role, myCharacterId],
  );
  const { encounter, fetched } = useTrackerEncounter(campaignId, null, sceneId);
  const rows = useMemo(() => trackerRows(encounter, viewer), [encounter, viewer]);
  const [open, setOpen] = useState(false);

  // A runner has no fight to show until one is live; the GM can start one from here.
  if (!encounter && !isGm) return null;
  const { text, warn } = orderSummary(encounter, rows);
  const start = isGm && fetched ? (
    <FightFromMap campaignId={campaignId} sceneId={sceneId} sceneName={sceneName} tokens={tokens} encounter={encounter} />
  ) : null;

  return (
    <>
      <button
        type="button"
        data-testid="order-chip"
        className={`chip pointer-events-auto max-w-[70vw] truncate bg-panel/90 md:hidden ${
          warn ? 'border-warn text-warn' : 'text-ink'
        }`}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        title="The order and the tracker"
      >
        {text}
      </button>
      {open &&
        createPortal(
          <div
            role="dialog"
            aria-label="The fight"
            className="fixed inset-x-0 bottom-0 z-50 flex max-h-[80dvh] flex-col rounded-t-xl border-t border-edge bg-deck shadow-lg md:hidden"
          >
            <div className="flex items-center gap-2 border-b border-edge px-3 py-1.5">
              <span className="mono-label text-dim">the fight</span>
              <span className="ml-auto" />
              {start}
              <button type="button" className="btn px-2 py-0.5 pointer-coarse:min-h-9" onClick={() => setOpen(false)}>
                close
              </button>
            </div>
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
              <Tracker campaignId={campaignId} sceneId={sceneId} emptyAction={start} />
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
