/**
 * The initiative tracker (FR4.2–4.10). Rows sorted by Initiative Score, the
 * current pass and acting combatant always on screen, GM controls for
 * start / roll / next / end-pass / new-turn / end, and the per-row copilot
 * rack, damage dialog, and interrupt menu.
 *
 * Two ways to get the numbers, both first-class (FR4.2 "roll or hand-enter"):
 * the server throws the dice, or the table does and the numbers are typed in.
 * "Hand rolls" flips the whole tracker between the two — a turn opens with
 * every line blank and each row takes a dice total, base and wounds added by
 * the server. A runner may do the same for their own row from their phone.
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
import {
  patchEncounter,
  postEndPass,
  postNewTurn,
  postRollInitiative,
  sendCommand,
  useEncounterList,
  useTrackerEncounter,
} from './commands.js';
import DamageDialog from './DamageDialog.js';
import FightMenu from './FightMenu.js';
import { useHintsSetting } from './hints.js';
import MoraleToasts from './MoraleToasts.js';
import ResolveChainDialog from './ResolveChainDialog.js';
import { fightPhase, passLabel, trackerRows, type Viewer } from './initiative.js';

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
        ? 'No combatants yet — start a fight from a scene on the Grid, or build one in the Generator.'
        : 'No fight yet. Start one from a scene on the Grid (Scenes ▸ Fight), or build one in the Generator.'}
    </li>
  );
}

/** The header's turn readout: the pass structure while live, otherwise the phase. */
function phaseLabel(phase: ReturnType<typeof fightPhase>, label: string): string {
  if (phase === 'live') return label;
  if (phase === 'prep') return 'NOT STARTED';
  if (phase === 'done') return 'OVER';
  return '';
}

export default function Tracker({ campaignId }: TrackerProps) {
  const session = getSession();
  const isGm = session?.role === 'gm';
  // The GM may look at any fight; everyone else follows the live one.
  const [pickedId, setPickedId] = useState<string | null>(null);
  const { encounter, asked, failed } = useTrackerEncounter(campaignId, isGm ? pickedId : null);
  const list = useEncounterList(isGm ? campaignId : undefined);

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
  const phase = fightPhase(encounter);
  const live = phase === 'live';

  const [rackPublic, setRackPublic] = useState(false);
  // Hand rolls (FR4.2): the table's dice instead of the server's. A GM
  // preference for the session, not a campaign setting — it changes nothing
  // about the fight itself, only where the numbers come from.
  const [handRolls, setHandRolls] = useState(false);
  // FR10.10 lives next to the rack toggle because that is where the GM already
  // reaches when they want the tracker to help them run the opposition — and
  // because it is the only screen where a hint ever appears.
  const hints = useHintsSetting(campaignId, isGm);
  const [damageFor, setDamageFor] = useState<{ c: Combatant; track?: 'physical' | 'stun' } | null>(null);
  const [chainFor, setChainFor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Making, naming, linking and deleting fights, and adding rows by hand (FR4.1/FR4.8).
  const [manageOpen, setManageOpen] = useState(false);

  const encounterId = encounter?.id ?? '';

  const run = (fn: () => Promise<unknown>) => {
    if (!encounterId || busy) return;
    setBusy(true);
    fn()
      .catch(() => undefined)
      .finally(() => setBusy(false));
  };

  const rollRow = (c: Combatant) => run(() => postRollInitiative(encounterId, [c.id]));

  const pickerOptions = (list.data ?? []).map((e) => ({
    id: e.id,
    label: `${e.name} · ${e.state === 'live' ? 'live' : e.state === 'done' ? 'over' : 'prep'}`,
  }));

  return (
    <section className="panel flex min-h-0 flex-col" aria-label="Initiative tracker">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-edge px-3 py-2">
        {isGm && pickerOptions.length > 1 ? (
          <select
            aria-label="Which fight"
            className="max-w-[16rem] rounded border border-edge bg-deck px-1.5 py-0.5 font-label text-xs uppercase tracking-wide text-cyan"
            value={pickedId ?? encounterId}
            onChange={(e) => setPickedId(e.target.value || null)}
          >
            {pickerOptions.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        ) : (
          <span className="mono-label text-cyan">{encounter?.name ?? 'No encounter'}</span>
        )}
        <span className="mono-label text-faint">{phaseLabel(phase, passLabel(encounter))}</span>
        {acting && live && (
          <span className="mono-label text-ink">
            <span className="text-faint">up: </span>
            {acting.combatant.name}
          </span>
        )}
        {isGm && (
          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              className={`chip ${manageOpen ? 'border-cyan text-cyan' : 'border-edge-bright text-faint'}`}
              aria-pressed={manageOpen}
              onClick={() => setManageOpen((v) => !v)}
              title="New fight, rename, link a scene, add a combatant by hand, delete (FR4.1)"
            >
              manage ▾
            </button>
            {encounterId && (
            <>
            <button
              type="button"
              className={`chip ${handRolls ? 'border-warn text-warn' : 'border-edge-bright text-faint'}`}
              aria-pressed={handRolls}
              onClick={() => setHandRolls((v) => !v)}
              title={
                handRolls
                  ? 'The table rolls: each row takes the dice total, and the tracker adds base and wounds. Switch off to let the server roll.'
                  : 'The server rolls initiative. Switch on to roll at the table and type each row’s dice total — base and wounds are added for you.'
              }
            >
              hand rolls {handRolls ? 'on' : 'off'}
            </button>
            <button
              type="button"
              className={`chip ${rackPublic ? 'border-cyan text-cyan' : 'border-edge-bright text-faint'}`}
              onClick={() => setRackPublic((v) => !v)}
              title="Where copilot rack rolls land"
            >
              rack {rackPublic ? 'public' : 'behind screen'}
            </button>
            {hints.ready && (
              <button
                type="button"
                className={`chip ${
                  hints.enabled ? 'border-magenta text-magenta' : 'border-edge-bright text-faint'
                }`}
                aria-pressed={hints.enabled}
                disabled={hints.pending}
                onClick={hints.toggle}
                title={
                  hints.enabled
                    ? 'A one-line suggestion on the acting NPC’s row. It never acts (FR10.10).'
                    : 'Off by default. Turn on to get a one-line suggestion on the acting NPC’s row — advice only, it never acts (FR10.10).'
                }
              >
                hints {hints.enabled ? 'on' : 'off'}
              </button>
            )}
            {!live && (
              <button
                type="button"
                className="btn btn-accent px-2.5 py-1"
                disabled={busy || rows.length === 0}
                onClick={() => run(() => postNewTurn(encounterId, !handRolls))}
                title={
                  handRolls
                    ? 'Turn 1, pass 1, every line blank — type the dice as the table rolls them (FR4.2)'
                    : 'Turn 1, pass 1, the server rolls everyone’s initiative (FR4.2)'
                }
              >
                Start the fight
              </button>
            )}
            {live && (
              <>
                <button
                  type="button"
                  className="btn btn-accent px-2.5 py-1"
                  disabled={busy}
                  onClick={() => sendCommand(campaignId, { cmd: 'encounter.advance', encounterId })}
                  title="The acting combatant is done; on to the next (FR4.3)"
                >
                  Next ▸
                </button>
                <button
                  type="button"
                  className="btn px-2.5 py-1"
                  disabled={busy}
                  onClick={() => run(() => postRollInitiative(encounterId))}
                  title="Roll everyone’s initiative again with the server’s dice, without moving the turn"
                >
                  Roll initiative
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
                  onClick={() => run(() => postNewTurn(encounterId, !handRolls))}
                  title={
                    handRolls
                      ? 'Next combat turn: every line blank again, for the table’s dice (FR4.3)'
                      : 'Next combat turn: everyone re-rolls (FR4.3)'
                  }
                >
                  New turn
                </button>
                <button
                  type="button"
                  className="btn px-2.5 py-1 text-faint"
                  disabled={busy}
                  onClick={() => run(() => patchEncounter(encounterId, { state: 'done' }))}
                  title="The fight is over; the tracker and the TV stand down"
                >
                  End the fight
                </button>
              </>
            )}
            </>
            )}
          </div>
        )}
      </header>

      {isGm && manageOpen && (
        <FightMenu
          campaignId={campaignId}
          encounter={encounter}
          onPick={(id) => setPickedId(id)}
          onClose={() => setManageOpen(false)}
        />
      )}

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
            live={live}
            handRolls={handRolls}
            rackVisibility={rackPublic ? 'public' : 'gm'}
            onRoll={rollRow}
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
