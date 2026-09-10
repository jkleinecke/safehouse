/**
 * Managing the fight itself, from the tracker (FR4.1, FR4.8).
 *
 * The tracker runs a fight; this is where the GM makes one, names it, ties
 * it to a scene, adds a row by hand — "dumb mode": a name, a line, its boxes,
 * nothing else required — and throws a fight away. Everything the server
 * could already do and the browser could not reach.
 *
 * A fight is made here in two ways: a new empty one to fill by hand, or the
 * scene's tokens from the Grid (Scenes ▸ Fight) and the Generator's parts —
 * those two live on their own screens and are linked from the empty state.
 */
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Combatant, Encounter } from '@safehouse/contracts';
import { liveKeys } from '../../api/live.js';
import { useScenes } from '../grid/api.js';
import {
  addCombatant,
  createEncounter,
  deleteEncounter,
  patchEncounter,
  type HandCombatantInput,
} from './commands.js';

export interface FightMenuProps {
  campaignId: string;
  encounter: Encounter | null;
  /** Show this fight in the tracker (a fight made here, or none after a delete). */
  onPick: (encounterId: string | null) => void;
  onClose: () => void;
}

const KINDS: Array<{ id: Combatant['initKind']; label: string }> = [
  { id: 'physical', label: 'physical (REA+INT)' },
  { id: 'astral', label: 'astral (INT×2, 2d6)' },
  { id: 'matrix_ar', label: 'Matrix AR' },
  { id: 'vr_cold', label: 'VR cold-sim (3d6)' },
  { id: 'vr_hot', label: 'VR hot-sim (4d6)' },
];

const field = 'rounded border border-edge bg-deck px-2 py-1 text-sm text-ink outline-none focus:border-cyan-dim';

export default function FightMenu({ campaignId, encounter, onPick, onClose }: FightMenuProps) {
  const qc = useQueryClient();
  const scenes = useScenes(campaignId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [name, setName] = useState(encounter?.name ?? '');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [row, setRow] = useState<HandCombatantInput>({
    name: '',
    initBase: 8,
    initDice: 1,
    initKind: 'physical',
    hidden: true,
    physicalBoxes: 10,
    stunBoxes: 10,
  });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: liveKeys.encounters(campaignId) });
    void qc.invalidateQueries({ queryKey: liveKeys.encounter(campaignId) });
  };
  const run = (fn: () => Promise<unknown>, after?: () => void) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    fn()
      .then(() => {
        refresh();
        after?.();
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'the server refused'))
      .finally(() => setBusy(false));
  };

  const id = encounter?.id ?? null;
  const rowValid = row.name.trim().length > 0 && row.initDice >= 0 && row.initDice <= 5;

  return (
    <div className="space-y-3 border-b border-edge bg-deck/60 px-3 py-3" data-testid="fight-menu">
      {/* A new fight, empty, to fill by hand. */}
      <section className="space-y-1.5">
        <span className="mono-label text-cyan">New fight</span>
        <div className="flex gap-1.5">
          <input
            className={`${field} min-w-0 flex-1`}
            value={newName}
            placeholder="Rooftop scrap, the alley, round two…"
            aria-label="New fight name"
            onChange={(e) => setNewName(e.target.value)}
          />
          <button
            type="button"
            className="btn btn-accent px-2.5 py-1"
            disabled={busy || newName.trim().length === 0}
            onClick={() =>
              run(
                () =>
                  createEncounter(campaignId, newName.trim()).then((made) => {
                    onPick(made.id);
                    setName(made.name);
                  }),
                () => setNewName(''),
              )
            }
          >
            create
          </button>
        </div>
        <p className="text-xs text-faint">
          Or start one from a scene’s tokens on the Grid (Scenes ▸ Fight), or roll the opposition in
          the Generator and save it there.
        </p>
      </section>

      {encounter && id && (
        <>
          <section className="space-y-1.5">
            <span className="mono-label text-cyan">This fight</span>
            <div className="flex gap-1.5">
              <input
                className={`${field} min-w-0 flex-1`}
                value={name}
                aria-label="Fight name"
                onChange={(e) => setName(e.target.value)}
              />
              <button
                type="button"
                className="btn px-2.5 py-1"
                disabled={busy || name.trim().length === 0 || name.trim() === encounter.name}
                onClick={() => run(() => patchEncounter(id, { name: name.trim() }))}
              >
                rename
              </button>
            </div>
            <label className="flex items-center gap-2 text-xs text-dim">
              <span className="mono-label">scene</span>
              <select
                className={`${field} min-w-0 flex-1`}
                value={encounter.sceneId ?? ''}
                aria-label="Linked scene"
                disabled={busy}
                onChange={(e) => run(() => patchEncounter(id, { sceneId: e.target.value || null }))}
              >
                <option value="">— none —</option>
                {(scenes.data ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          </section>

          <section className="space-y-1.5">
            <span className="mono-label text-cyan">Add a combatant by hand</span>
            <div className="grid grid-cols-[1fr_4rem_4rem] gap-1.5">
              <input
                className={`${field} min-w-0`}
                value={row.name}
                placeholder="Name"
                aria-label="Combatant name"
                onChange={(e) => setRow({ ...row, name: e.target.value })}
              />
              <input
                className={field}
                type="number"
                value={row.initBase}
                aria-label="Initiative base"
                title="REA + INT (or the variant's base)"
                onChange={(e) => setRow({ ...row, initBase: Math.trunc(Number(e.target.value) || 0) })}
              />
              <input
                className={field}
                type="number"
                min={0}
                max={5}
                value={row.initDice}
                aria-label="Initiative dice"
                title="How many d6 (0–5)"
                onChange={(e) => setRow({ ...row, initDice: Math.max(0, Math.min(5, Math.trunc(Number(e.target.value) || 0))) })}
              />
            </div>
            <div className="grid grid-cols-[1fr_4rem_4rem] gap-1.5">
              <select
                className={`${field} min-w-0`}
                value={row.initKind}
                aria-label="Initiative kind"
                onChange={(e) => setRow({ ...row, initKind: e.target.value as Combatant['initKind'] })}
              >
                {KINDS.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.label}
                  </option>
                ))}
              </select>
              <input
                className={field}
                type="number"
                min={1}
                value={row.physicalBoxes}
                aria-label="Physical boxes"
                title="Physical condition monitor"
                onChange={(e) => setRow({ ...row, physicalBoxes: Math.max(1, Math.trunc(Number(e.target.value) || 1)) })}
              />
              <input
                className={field}
                type="number"
                min={1}
                value={row.stunBoxes}
                aria-label="Stun boxes"
                title="Stun condition monitor"
                onChange={(e) => setRow({ ...row, stunBoxes: Math.max(1, Math.trunc(Number(e.target.value) || 1)) })}
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1 text-xs text-dim">
                <input
                  type="checkbox"
                  checked={row.hidden}
                  aria-label="Hidden from players"
                  onChange={(e) => setRow({ ...row, hidden: e.target.checked })}
                />
                hidden from players
              </label>
              <span className="mono-label text-faint">
                {row.initBase}+{row.initDice}d6 · P{row.physicalBoxes}/S{row.stunBoxes}
              </span>
              <button
                type="button"
                className="btn btn-accent ml-auto px-2.5 py-1"
                disabled={busy || !rowValid}
                onClick={() => run(() => addCombatant(id, { ...row, name: row.name.trim() }), () => setRow({ ...row, name: '' }))}
              >
                add
              </button>
            </div>
          </section>

          <section className="flex items-center gap-2">
            {confirmDelete ? (
              <>
                <span className="text-xs text-danger">Delete “{encounter.name}” and every row in it?</span>
                <button
                  type="button"
                  className="btn px-2.5 py-1 text-danger"
                  disabled={busy}
                  onClick={() =>
                    run(
                      () => deleteEncounter(id),
                      () => {
                        onPick(null);
                        setConfirmDelete(false);
                        onClose();
                      },
                    )
                  }
                >
                  yes, delete it
                </button>
                <button type="button" className="btn px-2.5 py-1" onClick={() => setConfirmDelete(false)}>
                  keep it
                </button>
              </>
            ) : (
              <button
                type="button"
                className="btn px-2.5 py-1 text-faint hover:text-danger"
                disabled={busy}
                onClick={() => setConfirmDelete(true)}
              >
                Delete this fight
              </button>
            )}
          </section>
        </>
      )}

      {error && <p className="mono-label text-danger">{error}</p>}
      <button type="button" className="btn px-2.5 py-1" onClick={onClose}>
        close
      </button>
    </div>
  );
}
