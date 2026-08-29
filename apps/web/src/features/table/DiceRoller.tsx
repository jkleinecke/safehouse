/**
 * Free-form dice roller (FR2.8): pool + optional limit + edge + visibility,
 * buy-hits shortcut (FR2.4), and personal macros. Dice are rolled server-side
 * via the `roll.request` WS command (§10.1).
 *
 * The rack is the *same* rack as the sheet's (`features/sheet/macroStore.ts`):
 * server-backed, keyed to the signed-in user, with a localStorage mirror
 * underneath. It used to be a second, device-local list — so the GM's macros
 * lived on whichever laptop made them, and a player who saved one on the sheet
 * did not see it here. One store, one rack, whichever screen you are on.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { LimitKind, RollRequestInput } from '@safehouse/contracts';
import { buyHits } from '@safehouse/rules';
import { useMyCharacterId } from '../../api/campaigns.js';
import { apiPost } from '../../api/client.js';
import { getSession } from '../../api/session.js';
import { useMacroMutation, useMacros } from '../sheet/api.js';
import {
  mergeMacros,
  newMacroId,
  withMacro,
  withoutMacro,
  type DiceMacro,
} from '../sheet/macroStore.js';
import { sendCommand } from './commands.js';
import { takeLegacyMacros } from './macros.js';

const LIMIT_KINDS: LimitKind[] = ['physical', 'mental', 'social', 'accuracy', 'force'];
type EdgeChoice = '' | 'push_pre' | 'push_post' | 'second_chance';

export default function DiceRoller({ campaignId }: { campaignId: string }) {
  const session = getSession();
  const isGm = session?.role === 'gm';

  const [pool, setPool] = useState(6);
  const [limitOn, setLimitOn] = useState(false);
  const [limitKind, setLimitKind] = useState<LimitKind>('physical');
  const [limitValue, setLimitValue] = useState(4);
  const [edge, setEdge] = useState<EdgeChoice>('');
  const [visibility, setVisibility] = useState<'public' | 'gm' | 'gm_owner'>('public');
  const [flash, setFlash] = useState<string | null>(null);

  const rack = useMacros(campaignId);
  const saveRack = useMacroMutation(campaignId);
  const macros = rack.data?.macros ?? [];

  // One-time hand-over from the old device-local rack (see ./macros.ts). Runs
  // after the server's list has landed, so the merge keeps the shared rack
  // first and appends only what this device alone was holding.
  const adopted = useRef(false);
  const rackReady = rack.isSuccess;
  useEffect(() => {
    if (!rackReady || adopted.current) return;
    adopted.current = true;
    const legacy = takeLegacyMacros(campaignId);
    if (legacy.length === 0) return;
    saveRack.mutate(mergeMacros(macros, legacy));
    // `macros`/`saveRack` deliberately out of deps: this fires once per mount,
    // and re-running it on every rack change would fight the mutation it made.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignId, rackReady]);

  // A free-form roll is still attributed: sheet-backed for a player (so the
  // server recomputes the pool against the real sheet), GM-flagged otherwise.
  const myCharacterId = useMyCharacterId(campaignId);
  const actor = useMemo(
    () =>
      isGm ? { gm: true as const } : myCharacterId ? { characterId: myCharacterId } : {},
    [isGm, myCharacterId],
  );

  const note = (text: string) => {
    setFlash(text);
    window.setTimeout(() => setFlash(null), 2500);
  };

  const buildRequest = (extraMeta?: Record<string, unknown>): RollRequestInput => ({
    kind: 'simple',
    pool,
    breakdown: [{ label: 'Free roll', value: pool }],
    ...(limitOn ? { limit: { kind: limitKind, value: limitValue } } : {}),
    ...(edge ? { edge } : {}),
    visibility,
    actor,
    ...(extraMeta ? { meta: extraMeta } : {}),
  });

  const roll = () => {
    const ok = sendCommand(campaignId, { cmd: 'roll.request', ...buildRequest({ label: 'Free roll' }) });
    if (!ok) note('Offline — roll not sent');
  };

  /**
   * Buying hits takes no dice (FR2.4), so it has no WS command — it goes over
   * REST to the dedicated route, which recomputes the pool and does the 4:1
   * division server-side. `buyHits` here is only the preview on the button.
   */
  const buy = () => {
    apiPost('/api/rolls/buy-hits', buildRequest({ label: 'Bought hits' })).catch(() => {
      note('Offline — hits not bought');
    });
  };

  const saveMacro = () => {
    const name = window.prompt('Macro name?', `Pool ${pool}`);
    if (!name?.trim()) return;
    const macro: DiceMacro = {
      id: newMacroId(),
      name: name.trim(),
      pool,
      ...(limitOn ? { limitKind, limitValue } : {}),
      ...(edge ? { edge } : {}),
    };
    saveRack.mutate(withMacro(macros, macro), {
      onError: () => note('Macro saved on this device only'),
    });
  };

  const runMacro = (m: DiceMacro) => {
    setPool(m.pool);
    setLimitOn(m.limitKind !== undefined);
    if (m.limitKind) setLimitKind(m.limitKind);
    if (m.limitValue !== undefined) setLimitValue(m.limitValue);
    setEdge(m.edge ?? '');
    const ok = sendCommand(campaignId, {
      cmd: 'roll.request',
      kind: 'simple',
      pool: m.pool,
      breakdown: [{ label: m.name, value: m.pool }],
      ...(m.limitKind && m.limitValue !== undefined
        ? { limit: { kind: m.limitKind, value: m.limitValue } }
        : {}),
      ...(m.edge ? { edge: m.edge } : {}),
      visibility,
      actor,
      meta: { label: m.name },
    });
    if (!ok) note('Offline — roll not sent');
  };

  const inputCls =
    'rounded-md border border-edge bg-deck px-2 py-1.5 text-sm outline-none focus:border-cyan-dim';

  return (
    <section className="border-t border-edge bg-panel/60 p-3" aria-label="Dice roller">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className="mono-label">Pool</span>
          <input
            type="number"
            min={0}
            max={60}
            value={pool}
            onChange={(e) => setPool(Math.max(0, Math.min(60, Number(e.target.value) || 0)))}
            className={`${inputCls} w-20 font-label text-lg`}
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="mono-label">
            <input
              type="checkbox"
              checked={limitOn}
              onChange={(e) => setLimitOn(e.target.checked)}
              className="mr-1 accent-[#2fe6ff]"
            />
            Limit
          </span>
          <div className="flex gap-1">
            <select
              value={limitKind}
              onChange={(e) => setLimitKind(e.target.value as LimitKind)}
              disabled={!limitOn}
              className={`${inputCls} disabled:opacity-40`}
            >
              {LIMIT_KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
            <input
              type="number"
              min={0}
              max={30}
              value={limitValue}
              onChange={(e) => setLimitValue(Math.max(0, Number(e.target.value) || 0))}
              disabled={!limitOn}
              className={`${inputCls} w-16 disabled:opacity-40`}
            />
          </div>
        </label>

        <label className="flex flex-col gap-1">
          <span className="mono-label text-magenta">Edge</span>
          <select value={edge} onChange={(e) => setEdge(e.target.value as EdgeChoice)} className={inputCls}>
            <option value="">—</option>
            <option value="push_pre">Push the Limit</option>
            <option value="push_post">Push (post-roll)</option>
            <option value="second_chance">Second Chance</option>
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="mono-label">Visibility</span>
          <select
            value={visibility}
            onChange={(e) => setVisibility(e.target.value as typeof visibility)}
            className={inputCls}
          >
            <option value="public">public</option>
            {isGm && <option value="gm">GM only</option>}
            <option value="gm_owner">behind the screen</option>
          </select>
        </label>

        <div className="flex gap-2">
          <button type="button" className="btn btn-accent" onClick={roll} disabled={pool <= 0 && !edge}>
            Roll {pool}d6
          </button>
          <button type="button" className="btn" onClick={buy} disabled={pool < 4} title="4 dice : 1 hit">
            Buy {buyHits(pool)}
          </button>
          <button type="button" className="btn" onClick={saveMacro} title="Save as macro">
            ★
          </button>
        </div>
      </div>

      {macros.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {macros.map((m) => (
            <span key={m.id} className="chip border-edge-bright">
              <button type="button" className="hover:text-cyan" onClick={() => runMacro(m)}>
                {m.name} · {m.pool}d6
                {m.limitKind ? ` [${m.limitValue}]` : ''}
              </button>
              <button
                type="button"
                aria-label={`Delete macro ${m.name}`}
                className="text-faint hover:text-danger"
                onClick={() => saveRack.mutate(withoutMacro(macros, m.id))}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      {flash && <div className="mono-label mt-2 text-warn">{flash}</div>}
    </section>
  );
}
