/**
 * The initiative tracker (FR4.2–4.10). Rows in the server's acting order
 * (`turnOrder`), the current pass and acting combatant always on screen, GM
 * controls for initiative / next / end-pass / new-turn / end, and the per-row
 * copilot rack, damage dialog, and interrupt menu.
 *
 * Initiative is called, not rolled for everyone: "Roll initiative" opens the
 * checklist of recipes (`InitiativePanel`), each row filled by the app's dice,
 * the table's dice total or a typed score, from the GM's screen or the
 * runner's own phone. The rows are also the order strip: place, passes left,
 * acting / next / acted / delayed / out, and the GM's levers on the order.
 *
 * State comes from REST on mount and after every reconnect (LIVE-1), with
 * `encounter.updated` merged on top — `useTrackerEncounter` owns that join.
 * Before hydration the tracker says so: "no combatants yet" is a claim about
 * the server's answer, not about whether we bothered to ask.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Combatant } from '@safehouse/contracts';
import { useMyCharacterId } from '../../api/campaigns.js';
import { getSession } from '../../api/session.js';
import { useGmExchanges } from '../combat/gmApi.js';
import GmIncoming from '../combat/GmIncoming.js';
import CombatantRow, { type RowOrderControls } from './CombatantRow.js';
import {
  patchEncounter,
  postAdvance,
  postCallInitiative,
  postDelay,
  postEndPass,
  postOrder,
  postRollInitiative,
  useEncounterList,
  useTrackerEncounter,
} from './commands.js';
import DamageDialog from './DamageDialog.js';
import FightMenu from './FightMenu.js';
import { useHintsSetting } from './hints.js';
import InitiativePanel from './InitiativePanel.js';
import MoraleToasts from './MoraleToasts.js';
import ResolveChainDialog from './ResolveChainDialog.js';
import { fightPhase, isManualOrder, passLabel, stepIndex, trackerRows, type TrackerRow, type Viewer } from './initiative.js';

export interface TrackerProps {
  campaignId: string;
  /** On the map: show that scene's fight rather than the live one. */
  sceneId?: string | null;
  /** Under an empty roster: the map's "Start from the map" / "Add new tokens". */
  emptyAction?: ReactNode;
}

/**
 * The line under an empty roster. Four distinct truths, never conflated:
 * still asking · the read failed · no fight exists · a fight with no rows.
 */
export function TrackerEmptyLine({
  asked,
  failed,
  hasEncounter,
  action,
}: {
  asked: boolean;
  failed: boolean;
  hasEncounter: boolean;
  action?: ReactNode;
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
    <li className="flex flex-col items-center gap-2 p-4 text-center text-sm text-faint">
      <span>
        {hasEncounter
          ? 'No combatants yet. Add the map’s tokens, or build some in the Generator.'
          : 'No fight yet. Start one from the map, or build one in the Generator.'}
      </span>
      {action}
    </li>
  );
}

/** The header's turn readout: the pass structure while live, otherwise the phase. */
function phaseLabel(phase: ReturnType<typeof fightPhase>, label: string, gathering: boolean): string {
  if (phase === 'live') return gathering ? `${label.split(' · ')[0]} · INITIATIVE` : label;
  if (phase === 'prep') return 'NOT STARTED';
  if (phase === 'done') return 'OVER';
  return '';
}

export default function Tracker({ campaignId, sceneId = null, emptyAction }: TrackerProps) {
  const session = getSession();
  const isGm = session?.role === 'gm';
  // The GM may look at any fight; everyone else follows the live one.
  const [pickedId, setPickedId] = useState<string | null>(null);
  // The rail follows the scene: a new map drops a fight picked on the old one.
  useEffect(() => setPickedId(null), [sceneId]);
  const { encounter, asked, failed } = useTrackerEncounter(campaignId, isGm ? pickedId : null, sceneId);
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
  const gathering = live && encounter?.gathering === true;
  const manual = isManualOrder(encounter);

  const [rackPublic, setRackPublic] = useState(false);
  // Hand rolls (FR4.2): stored on the fight, so the end of a turn opens the
  // next one blank for the table's dice instead of the app rolling it.
  const handRolls = encounter?.handRolls === true;
  // FR10.10 lives next to the rack toggle because that is where the GM already
  // reaches when they want the tracker to help them run the opposition — and
  // because it is the only screen where a hint ever appears.
  const hints = useHintsSetting(campaignId, isGm);
  const [damageFor, setDamageFor] = useState<{ c: Combatant; track?: 'physical' | 'stun' } | null>(null);
  const [chainFor, setChainFor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The recipes over a running turn, opened by hand; while gathering they are always open.
  const [initOpen, setInitOpen] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  // Making, naming, linking and deleting fights, and adding rows by hand (FR4.1/FR4.8).
  const [manageOpen, setManageOpen] = useState(false);

  const encounterId = encounter?.id ?? '';
  // Open attacks, on their rows; the count opens them all in one list.
  const exchanges = useGmExchanges(isGm ? encounterId : null);
  const [openList, setOpenList] = useState(false);

  const run = (fn: () => Promise<unknown>) => {
    if (!encounterId || busy) return;
    setBusy(true);
    setError(null);
    fn()
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'That did not go through.'))
      .finally(() => setBusy(false));
  };

  const rollRow = (c: Combatant) => run(() => postRollInitiative(encounterId, [c.id]));
  const callInitiative = () => {
    setInitOpen(true);
    run(() => postCallInitiative(encounterId));
  };

  const ranked = rows.filter((r) => r.order !== null);
  const orderControls = (row: TrackerRow): RowOrderControls => {
    const id = row.combatant.id;
    const move = (toIndex: number) => run(() => postOrder(encounterId, { move: { combatantId: id, toIndex } }));
    return {
      onStep: (dir) => {
        const to = stepIndex(rows, id, dir);
        if (to !== null) move(to);
      },
      onActNow: () => run(() => postOrder(encounterId, { actNow: id })),
      onDelay: () => run(() => postDelay(id, row.combatant.delayed !== true)),
      onDragStart: () => setDragId(id),
      onDrop: () => {
        const from = dragId;
        setDragId(null);
        const to = ranked.findIndex((r) => r.combatant.id === id);
        if (from && from !== id && to >= 0) run(() => postOrder(encounterId, { move: { combatantId: from, toIndex: to } }));
      },
    };
  };

  const pickerOptions = (list.data ?? []).map((e) => ({
    id: e.id,
    label: `${e.name} · ${e.state === 'live' ? 'live' : e.state === 'done' ? 'over' : 'prep'}`,
  }));

  const showInit = encounter !== null && (gathering || (isGm && initOpen && live));

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
          <span className="mono-label text-cyan">{encounter?.name ?? 'No fight'}</span>
        )}
        <span className="mono-label text-faint">{phaseLabel(phase, passLabel(encounter), gathering)}</span>
        {acting && live && (
          <span className="mono-label text-ink">
            <span className="text-faint">up: </span>
            {acting.combatant.name}
          </span>
        )}
        {isGm && exchanges.length > 0 && (
          <button
            type="button"
            className={`chip py-0 ${openList ? 'border-magenta text-magenta' : 'border-magenta-dim text-magenta'}`}
            aria-pressed={openList}
            onClick={() => setOpenList((v) => !v)}
            title="Attacks waiting on a defense, a soak or the boxes"
          >
            {exchanges.length} open {exchanges.length === 1 ? 'attack' : 'attacks'}
          </button>
        )}
        {!acting && live && encounter?.gmTurn && (
          <span className="mono-label text-ink">
            <span className="text-faint">up: </span>
            GM’s turn
          </span>
        )}
        {isGm && (
          <div className="ml-auto flex flex-wrap items-center gap-3">
            {/*
              Two kinds of thing, kept apart (docs/UX_SITE.md, Alignment): the
              settings are chips, the actions are buttons, and a rule stands
              between the groups — at the start of the actions' own line when
              the row wraps, so the split survives a narrow screen.
            */}
            <span className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Tracker settings">
            <button
              type="button"
              className={`chip ${manageOpen ? 'border-cyan text-cyan' : 'border-edge-bright text-faint'}`}
              aria-pressed={manageOpen}
              onClick={() => setManageOpen((v) => !v)}
              title="New fight, rename, link a scene, add a combatant by hand, delete"
            >
              manage ▾
            </button>
            {encounterId && (
            <>
            <button
              type="button"
              className={`chip ${handRolls ? 'border-warn text-warn' : 'border-edge-bright text-faint'}`}
              aria-pressed={handRolls}
              onClick={() => run(() => patchEncounter(encounterId, { handRolls: !handRolls }))}
              title={
                handRolls
                  ? 'The table rolls: each new turn opens blank for the dice, and rows take a dice total. Switch off to let the app roll new turns.'
                  : 'The app rolls each new turn. Switch on to open new turns blank for the table’s dice.'
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
                    ? 'A one-line suggestion on the acting NPC’s row. It never acts.'
                    : 'Off by default. Turn on to get a one-line suggestion on the acting NPC’s row — advice only, it never acts.'
                }
              >
                hints {hints.enabled ? 'on' : 'off'}
              </button>
            )}
            </>
            )}
            </span>
            {encounterId && (
            <span
              className="flex flex-wrap items-center gap-1.5 border-l border-edge pl-3"
              role="group"
              aria-label="Fight actions"
            >
            {!live && (
              <button
                type="button"
                className="btn btn-accent px-2.5 py-1"
                disabled={busy}
                onClick={callInitiative}
                title="Turn 1: every row's recipe, rolled here, at the table, or typed"
              >
                Roll initiative
              </button>
            )}
            {live && !gathering && (
              <>
                <button
                  type="button"
                  className="btn btn-accent px-2.5 py-1"
                  disabled={busy}
                  // Who this screen shows acting: a second press after the order
                  // moved on is refused, instead of skipping the next row.
                  onClick={() => run(() => postAdvance(encounterId, acting?.combatant.id ?? null))}
                  title="The acting combatant is done; on to the next"
                >
                  Next ▸
                </button>
                <button
                  type="button"
                  className="btn px-2.5 py-1"
                  disabled={busy}
                  onClick={() => setInitOpen((v) => !v)}
                  aria-pressed={initOpen}
                  title="Every row's recipe and score this turn: roll here, type the dice, or type a score"
                >
                  Roll initiative
                </button>
                <button
                  type="button"
                  className="btn px-2.5 py-1"
                  disabled={busy}
                  onClick={() => run(() => postEndPass(encounterId))}
                  title="Every score −10"
                >
                  End pass
                </button>
                <button
                  type="button"
                  className="btn px-2.5 py-1"
                  disabled={busy}
                  onClick={callInitiative}
                  title="Next Combat Turn: call for initiative again"
                >
                  New turn
                </button>
              </>
            )}
            {live && (
              <button
                type="button"
                className="btn px-2.5 py-1 text-faint"
                disabled={busy}
                onClick={() => run(() => patchEncounter(encounterId, { state: 'done' }))}
                title="The fight is over; the tracker and the TV stand down"
              >
                End the fight
              </button>
            )}
            </span>
            )}
          </div>
        )}
      </header>

      {/* The order is the server's: a manual arrangement says so, and one press undoes it. */}
      {live && !gathering && (manual || (isGm && ranked.length > 1)) && (
        <div className="flex flex-wrap items-center gap-2 border-b border-edge px-3 py-1">
          {manual && (
            <span className="chip border-warn/70 py-0 text-warn" title="The GM has arranged this turn's order by hand; scores are unchanged">
              manual order
            </span>
          )}
          {isGm && (
            <>
              <span className="text-xs text-faint">Drag or ▲▼ to move a place; scores stay.</span>
              <button
                type="button"
                className="btn ml-auto px-2 py-0.5"
                disabled={busy}
                onClick={() => run(() => postOrder(encounterId, { sort: 'score' }))}
                title="Back to the book's order: score, then Edge, Reaction, Intuition (p.159)"
              >
                Sort by score
              </button>
            </>
          )}
        </div>
      )}

      {error && (
        <p className="border-b border-edge px-3 py-1 text-xs text-warn" role="status">
          {error}
        </p>
      )}

      {isGm && manageOpen && (
        <FightMenu
          campaignId={campaignId}
          encounter={encounter}
          onPick={(id) => setPickedId(id)}
          onClose={() => setManageOpen(false)}
        />
      )}

      {isGm && openList && exchanges.length > 0 && (
        <div className="border-b border-edge px-3 pb-2" aria-label="Open attacks">
          {exchanges.map((x) => (
            <GmIncoming key={x.id} x={x} row={combatants.find((c) => c.id === x.target.combatantId)} named />
          ))}
        </div>
      )}

      {showInit && encounter && (
        <InitiativePanel
          encounter={encounter}
          isGm={isGm}
          {...(isGm ? { onClose: () => setInitOpen(false) } : {})}
        />
      )}

      <ul className="min-h-0 flex-1 overflow-y-auto">
        {rows.length === 0 && (
          <TrackerEmptyLine
            asked={asked}
            failed={failed}
            hasEncounter={encounter !== null}
            {...(isGm && emptyAction ? { action: emptyAction } : {})}
          />
        )}
        {rows.map((row) => (
          <CombatantRow
            key={row.combatant.id}
            campaignId={campaignId}
            encounterId={encounterId}
            row={row}
            isGm={isGm}
            // While initiative is gathered the panel takes the entries; the rows wait.
            live={live && !gathering}
            handRolls={handRolls}
            rackVisibility={rackPublic ? 'public' : 'gm'}
            onRoll={rollRow}
            onDamage={(c, track) => setDamageFor(track ? { c, track } : { c })}
            onOpenChain={(id) => setChainFor(id)}
            {...(isGm && live && !gathering ? { orderControls: orderControls(row) } : {})}
            {...(isGm ? { incoming: exchanges.filter((x) => x.target.combatantId === row.combatant.id) } : {})}
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
