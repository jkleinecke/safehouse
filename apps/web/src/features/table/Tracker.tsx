/**
 * The initiative tracker (FR4.2–4.10). Rows sorted by Initiative Score, the
 * current pass and acting combatant always on screen, GM controls for
 * next / end-pass / new-turn, and the per-row copilot rack, damage dialog,
 * and interrupt menu.
 *
 * State comes from REST on mount and after every reconnect (LIVE-1), with
 * `encounter.updated` merged on top — `useTrackerEncounter` owns that join.
 * Before hydration the tracker says so: "no combatants yet" is a claim about
 * the server's answer, not about whether we bothered to ask.
 */
import { useMemo, useState } from 'react';
import type { Combatant } from '@safehouse/contracts';
import { useMyCharacterId } from '../../api/campaigns.js';
import { getSession } from '../../api/session.js';
import CombatantRow from './CombatantRow.js';
import { postEndPass, postNewTurn, sendCommand, useTrackerEncounter } from './commands.js';
import DamageDialog from './DamageDialog.js';
import MoraleToasts from './MoraleToasts.js';
import ResolveChainDialog from './ResolveChainDialog.js';
import { passLabel, trackerRows, type Viewer } from './initiative.js';

export interface TrackerProps {
  campaignId: string;
}

/**
 * The line under an empty roster. Four distinct truths, never conflated:
 * still asking · the read failed · no fight exists · a fight with no rows.
 */
export function TrackerEmptyLine({
  asked,
  failed,
  hasEncounter,
}: {
  asked: boolean;
  failed: boolean;
  hasEncounter: boolean;
}) {
  if (failed) {
    return (
      <li className="p-4 text-center text-sm text-warn">
        Could not read the encounter from the server. Retrying on reconnect.
      </li>
    );
  }
  if (!asked) {
    return (
      <li className="p-4 text-center text-sm text-faint" aria-busy="true">
        Loading the encounter…
      </li>
    );
  }
  return (
    <li className="p-4 text-center text-sm text-faint">
      {hasEncounter
        ? 'No combatants yet — the GM stages them from a scene or the encounter list.'
        : 'No live encounter. The tracker wakes up when the GM starts one.'}
    </li>
  );
}

export default function Tracker({ campaignId }: TrackerProps) {
  const session = getSession();
  const isGm = session?.role === 'gm';
  const { encounter, asked, failed } = useTrackerEncounter(campaignId);

  const myCharacterId = useMyCharacterId(campaignId);
  const viewer: Viewer = useMemo(
    () => ({
      role: session?.role ?? 'observer',
      ...(myCharacterId ? { characterId: myCharacterId } : {}),
    }),
    [session?.role, myCharacterId],
  );

  const rows = useMemo(() => trackerRows(encounter, viewer), [encounter, viewer]);
  const combatants = encounter?.combatants ?? [];
  const acting = rows.find((r) => r.acting);

  const [rackPublic, setRackPublic] = useState(false);
  const [damageFor, setDamageFor] = useState<{ c: Combatant; track?: 'physical' | 'stun' } | null>(null);
  const [chainFor, setChainFor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const encounterId = encounter?.id ?? '';

  const run = (fn: () => Promise<unknown>) => {
    if (!encounterId || busy) return;
    setBusy(true);
    fn()
      .catch(() => undefined)
      .finally(() => setBusy(false));
  };

  return (
    <section className="panel flex min-h-0 flex-col" aria-label="Initiative tracker">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-edge px-3 py-2">
        <span className="mono-label text-cyan">{encounter?.name ?? 'No encounter'}</span>
        <span className="mono-label text-faint">{passLabel(encounter)}</span>
        {acting && (
          <span className="mono-label text-ink">
            <span className="text-faint">up: </span>
            {acting.combatant.name}
          </span>
        )}
        {isGm && encounterId && (
          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              className={`chip ${rackPublic ? 'border-cyan text-cyan' : 'border-edge-bright text-faint'}`}
              onClick={() => setRackPublic((v) => !v)}
              title="Where copilot rack rolls land"
            >
              rack {rackPublic ? 'public' : 'behind screen'}
            </button>
            <button
              type="button"
              className="btn btn-accent px-2.5 py-1"
              disabled={busy}
              onClick={() => sendCommand(campaignId, { cmd: 'encounter.advance', encounterId })}
            >
              Next ▸
            </button>
            <button
              type="button"
              className="btn px-2.5 py-1"
              disabled={busy}
              onClick={() => run(() => postEndPass(encounterId))}
              title="Every score −10 (FR4.3)"
            >
              End pass
            </button>
            <button
              type="button"
              className="btn px-2.5 py-1"
              disabled={busy}
              onClick={() => run(() => postNewTurn(encounterId))}
              title="Re-roll initiative (FR4.3)"
            >
              New turn
            </button>
          </div>
        )}
      </header>

      <ul className="min-h-0 flex-1 overflow-y-auto">
        {rows.length === 0 && (
          <TrackerEmptyLine asked={asked} failed={failed} hasEncounter={encounter !== null} />
        )}
        {rows.map((row) => (
          <CombatantRow
            key={row.combatant.id}
            campaignId={campaignId}
            encounterId={encounterId}
            row={row}
            isGm={isGm}
            rackVisibility={rackPublic ? 'public' : 'gm'}
            onDamage={(c, track) => setDamageFor(track ? { c, track } : { c })}
            onOpenChain={(id) => setChainFor(id)}
          />
        ))}
      </ul>

      {damageFor && (
        <DamageDialog
          campaignId={campaignId}
          encounterId={encounterId}
          combatant={damageFor.c}
          {...(damageFor.track ? { initialTrack: damageFor.track } : {})}
          onClose={() => setDamageFor(null)}
        />
      )}

      {chainFor && (
        <ResolveChainDialog
          campaignId={campaignId}
          encounterId={encounterId}
          combatants={combatants}
          initialAttackerId={chainFor}
          onClose={() => setChainFor(null)}
        />
      )}

      {isGm && <MoraleToasts campaignId={campaignId} combatants={combatants} />}
    </section>
  );
}
