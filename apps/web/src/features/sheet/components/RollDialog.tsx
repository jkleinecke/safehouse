/**
 * Roll dialog (G1: any common roll ≤2 taps). Local pool preview from the
 * shared rules provenance, situational chips, limit display, Edge options
 * (FR2.3), visibility picker (FR2.7) → WS `roll.request`, server-rolled
 * (DESIGN.md §10.1).
 *
 * LIVE-2: the active scene's environment is shown as CONTEXT — "already in
 * this pool" — and is never re-sent as a situational modifier. The server's
 * derived pool is the one authority for it; the arithmetic lives in
 * `../rollDialogState.ts`, which is where the reasoning is written down.
 *
 * A consequence worth naming: rolls with no derived pool behind them — a
 * Drain resistance (WIL + tradition attribute), a free-form macro — no longer
 * pick up a scene penalty either. That is the right answer for Drain, which is
 * not an environmental test, and the situational stepper covers the rest.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ProvenanceEntry, Visibility } from '@safehouse/contracts';
import { getSession } from '../../../api/session.js';
import { apiPost } from '../../../api/client.js';
import { getLiveSocket } from '../../../live/socket.js';
import { signed, type RollChip } from '../lib.js';
import {
  activeChips,
  appliedSceneEntries,
  buildRollRequest,
  nonSceneEntries,
  rollPool,
  type EdgeChoice,
  type RollConfig,
} from '../rollDialogState.js';
import { Sheet, Stepper } from './ui.js';

export type { RollConfig } from '../rollDialogState.js';

export interface RollDialogProps {
  open: boolean;
  onClose: () => void;
  campaignId: string;
  characterId: string;
  /** Current Edge — gates the Edge options. */
  edgeCurrent: number;
  config: RollConfig | null;
  /** Fired once the roll request is accepted (ammo/recoil/drain chains). */
  onSent?: (config: RollConfig) => void;
}

const VISIBILITIES: { id: Visibility; label: string }[] = [
  { id: 'public', label: 'Public' },
  { id: 'gm_owner', label: 'GM + me' },
  { id: 'gm', label: 'GM only' },
];

const EDGE_OPTIONS: { id: EdgeChoice; label: string }[] = [
  { id: 'none', label: 'No edge' },
  { id: 'push_pre', label: 'Push the limit' },
  { id: 'second_chance', label: 'Second chance' },
];

export default function RollDialog(props: RollDialogProps) {
  const { config } = props;
  /** Chips the user flipped away from their default state, by chip id. */
  const [flipped, setFlipped] = useState<Record<string, boolean>>({});
  const [situational, setSituational] = useState(0);
  const [edge, setEdge] = useState<EdgeChoice>('none');
  const [visibility, setVisibility] = useState<Visibility>(
    config?.defaultVisibility ?? 'public',
  );
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rollButton = useRef<HTMLButtonElement | null>(null);

  const chips: RollChip[] = useMemo(() => activeChips(config, flipped), [config, flipped]);
  const sceneEntries: ProvenanceEntry[] = useMemo(
    () => appliedSceneEntries(config?.baseBreakdown ?? []),
    [config],
  );
  const baseEntries: ProvenanceEntry[] = useMemo(
    () => nonSceneEntries(config?.baseBreakdown ?? []),
    [config],
  );

  // Keyboard path: opening the dialog lands focus on the thing you came for,
  // so Enter twice is a complete roll and the reader announces the dice count.
  useEffect(() => {
    if (props.open) rollButton.current?.focus();
  }, [props.open]);

  if (!config) return null;

  const pool = rollPool(config.baseTotal, chips, situational);
  const canRoll = pool > 0 && !sending;

  const close = () => {
    setFlipped({});
    setSituational(0);
    setEdge('none');
    setSending(false);
    setError(null);
    props.onClose();
  };

  const send = async () => {
    const session = getSession();
    if (!session) {
      setError('No device session.');
      return;
    }
    setSending(true);
    setError(null);

    const request = buildRollRequest({
      config,
      chips,
      situational,
      edge,
      visibility,
      characterId: props.characterId,
      edgeCurrent: props.edgeCurrent,
    });

    // `close()` runs BEFORE `onSent` so a chained roll (cast → drain, FR8.1)
    // can open its own dialog without this one clearing it again.
    const socket = getLiveSocket({ campaignId: props.campaignId, token: session.token });
    if (socket.send({ cmd: 'roll.request', ...request })) {
      close();
      props.onSent?.(config);
      return;
    }
    // Socket offline — REST fallback through the same roll service. The
    // campaign comes from the device token, so the path carries no id.
    try {
      await apiPost('/api/rolls', request);
      close();
      props.onSent?.(config);
    } catch {
      setSending(false);
      setError('Offline — the roll could not reach the table.');
    }
  };

  return (
    <Sheet open={props.open} onClose={close} title={config.title}>
      {/* Pool preview + limit */}
      <div className="flex items-baseline gap-3">
        <span className="font-label text-4xl text-cyan" aria-hidden>
          {pool}
        </span>
        <span className="mono-label" aria-hidden>
          dice
        </span>
        <span className="sr-only" role="status">
          {`${pool} dice`}
        </span>
        {config.limit && (
          <span className={`chip ${edge === 'push_pre' ? 'text-faint line-through' : 'text-dim'}`}>
            limit {config.limit.kind} {config.limit.value}
          </span>
        )}
      </div>

      {config.note && <p className="mt-1 text-xs text-warn">{config.note}</p>}

      {/* Base provenance, compact. Scene lines are pulled out below so the
          same penalty is never printed twice on one card. */}
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-dim">
        {baseEntries.map((e, i) => (
          <span key={i}>
            {e.label} <span className="font-label text-ink">{signed(e.value)}</span>
          </span>
        ))}
      </div>

      {/*
        LIVE-2: scene environment, already inside the pool above. Read-only on
        purpose — offering it as a removable chip is what made the penalty land
        twice. Dropping it is a GM call at the table, i.e. an override on the
        scene, not a per-roll tap here.
      */}
      {sceneEntries.length > 0 && (
        <div className="mt-2 rounded border border-edge/70 bg-raised/40 px-2 py-1.5">
          <div className="mono-label text-faint">Already in this pool</div>
          <ul className="mt-0.5 space-y-0.5">
            {sceneEntries.map((e, i) => (
              <li key={i} className="flex items-baseline justify-between gap-2 text-xs text-dim">
                <span className="min-w-0 flex-1 truncate">{e.label}</span>
                <span className="font-label text-magenta">{signed(e.value)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Situational chips — tap to drop/restore (FR9.11 removable per-roll) */}
      {chips.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5" role="group" aria-label="Situational modifiers">
          {chips.map((chip) => (
            <button
              key={chip.id}
              type="button"
              aria-pressed={chip.active}
              className={`chip transition-colors ${
                chip.active
                  ? chip.value < 0
                    ? 'border-magenta-dim text-magenta'
                    : 'border-cyan-dim text-cyan'
                  : 'text-faint line-through'
              }`}
              onClick={() => setFlipped((m) => ({ ...m, [chip.id]: !m[chip.id] }))}
              aria-label={`${chip.label} ${signed(chip.value)}, ${
                chip.active ? 'applied — activate to drop' : 'dropped — activate to apply'
              }`}
            >
              {chip.label} {signed(chip.value)}
            </button>
          ))}
        </div>
      )}

      <div className="mt-3 flex items-center justify-between">
        <span className="mono-label" id="roll-situational">
          Situational
        </span>
        <Stepper value={situational} onChange={setSituational} label="situational modifier" />
      </div>

      {/* Edge (FR2.3) */}
      <div className="mt-3">
        <div className="mono-label mb-1.5" id="roll-edge">
          Edge <span className="text-warn">{props.edgeCurrent} left</span>
        </div>
        <div className="flex gap-1.5" role="group" aria-labelledby="roll-edge">
          {EDGE_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              disabled={opt.id !== 'none' && props.edgeCurrent <= 0}
              aria-pressed={edge === opt.id}
              className={`chip disabled:opacity-40 ${
                edge === opt.id ? 'border-warn text-warn' : 'text-dim'
              }`}
              onClick={() => setEdge(opt.id)}
            >
              {opt.label}
            </button>
          ))}
        </div>
        {edge === 'push_pre' && (
          <p className="mt-1 text-xs text-faint">
            +{props.edgeCurrent} Edge dice, Rule of Six, no limit. Spends 1 Edge.
          </p>
        )}
        {edge === 'second_chance' && (
          <p className="mt-1 text-xs text-faint">Reroll non-hits once. Spends 1 Edge.</p>
        )}
      </div>

      {/* Visibility (FR2.7) */}
      <div className="mt-3">
        <div className="mono-label mb-1.5" id="roll-visibility">
          Visibility
        </div>
        <div className="flex gap-1.5" role="group" aria-labelledby="roll-visibility">
          {VISIBILITIES.map((v) => (
            <button
              key={v.id}
              type="button"
              aria-pressed={visibility === v.id}
              className={`chip ${visibility === v.id ? 'border-cyan text-cyan' : 'text-dim'}`}
              onClick={() => setVisibility(v.id)}
            >
              {v.label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <p className="mt-3 text-sm text-danger" role="alert">
          {error}
        </p>
      )}

      <button
        ref={rollButton}
        type="button"
        className="btn btn-accent mt-4 w-full py-3 text-sm"
        disabled={!canRoll}
        onClick={() => void send()}
      >
        {sending ? 'Rolling…' : `Roll ${pool}d6`}
      </button>
    </Sheet>
  );
}
