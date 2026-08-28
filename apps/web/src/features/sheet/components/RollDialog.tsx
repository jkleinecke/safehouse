/**
 * Roll dialog (G1: any common roll ≤2 taps): local pool preview via the
 * shared rules provenance, situational modifier chips (scene environment
 * included, removable per-roll — FR9.11), limit display, Edge options
 * (FR2.3), visibility picker (FR2.7) → WS `roll.request` (server-rolled,
 * DESIGN.md §10.1).
 */
import { useMemo, useState } from 'react';
import type { LimitRef, ProvenanceEntry, RollKind, Visibility } from '@safehouse/contracts';
import { getSession } from '../../../api/session.js';
import { apiPost } from '../../../api/client.js';
import { getLiveSocket } from '../../../live/socket.js';
import { chipEntries, chipSum, clampPool, signed, type RollChip } from '../lib.js';
import { useActiveSceneEnv } from '../api.js';
import { Sheet, Stepper } from './ui.js';

export interface RollConfig {
  title: string;
  /** One-line context under the title (drain DV, threshold, linked roll…). */
  note?: string;
  kind?: RollKind;
  baseTotal: number;
  baseBreakdown: ProvenanceEntry[];
  limit?: LimitRef;
  /**
   * Pre-baked situational chips (recoil, range, specialization…). A chip with
   * `active: false` renders as an offer — one tap arms it for this roll.
   */
  extraChips?: RollChip[];
  meta?: Record<string, unknown>;
  defaultVisibility?: Visibility;
}

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

type EdgeChoice = 'none' | 'push_pre' | 'second_chance';

const VISIBILITIES: { id: Visibility; label: string }[] = [
  { id: 'public', label: 'Public' },
  { id: 'gm_owner', label: 'GM + me' },
  { id: 'gm', label: 'GM only' },
];

export default function RollDialog(props: RollDialogProps) {
  const { config } = props;
  const sceneEnv = useActiveSceneEnv(props.campaignId);
  /** Chips the user flipped away from their default state, by chip id. */
  const [flipped, setFlipped] = useState<Record<string, boolean>>({});
  const [situational, setSituational] = useState(0);
  const [edge, setEdge] = useState<EdgeChoice>('none');
  const [visibility, setVisibility] = useState<Visibility>(
    config?.defaultVisibility ?? 'public',
  );
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chips: RollChip[] = useMemo(() => {
    const out: RollChip[] = [];
    for (const mod of sceneEnv?.mods ?? []) {
      out.push({
        id: mod.id,
        label: mod.note ?? `${sceneEnv?.sceneName ?? 'scene'} environment`,
        value: mod.value,
        active: mod.active !== Boolean(flipped[mod.id]),
        source: 'scene',
      });
    }
    for (const chip of config?.extraChips ?? []) {
      out.push({ ...chip, active: chip.active !== Boolean(flipped[chip.id]) });
    }
    return out;
  }, [sceneEnv, config, flipped]);

  if (!config) return null;

  const pool = clampPool(config.baseTotal + chipSum(chips) + situational);
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

    const breakdown: ProvenanceEntry[] = [
      ...config.baseBreakdown,
      ...chipEntries(chips),
      ...(situational !== 0
        ? [{ label: 'situational', value: situational, source: 'situational' }]
        : []),
    ];
    const request = {
      kind: config.kind ?? ('simple' as const),
      pool,
      breakdown,
      ...(config.limit ? { limit: config.limit } : {}),
      edge: edge === 'none' ? null : edge,
      visibility,
      actor: { characterId: props.characterId },
      meta: {
        ...config.meta,
        title: config.title,
        // A hint only: the server recomputes the pool and the Edge dice from
        // the stored sheet, and records this claim so a stale sheet shows up
        // in the log rather than silently winning.
        ...(edge === 'push_pre' ? { edgeDice: props.edgeCurrent } : {}),
      },
    };

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
        <span className="font-label text-4xl text-cyan">{pool}</span>
        <span className="mono-label">dice</span>
        {config.limit && (
          <span className={`chip ${edge === 'push_pre' ? 'text-faint line-through' : 'text-dim'}`}>
            limit {config.limit.kind} {config.limit.value}
          </span>
        )}
      </div>

      {config.note && <p className="mt-1 text-xs text-warn">{config.note}</p>}

      {/* Base provenance, compact */}
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-dim">
        {config.baseBreakdown.map((e, i) => (
          <span key={i}>
            {e.label} <span className="font-label text-ink">{signed(e.value)}</span>
          </span>
        ))}
      </div>

      {/* Situational chips — tap to drop/restore (FR9.11 removable per-roll) */}
      {chips.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {chips.map((chip) => (
            <button
              key={chip.id}
              type="button"
              className={`chip transition-colors ${
                chip.active
                  ? chip.value < 0
                    ? 'border-magenta-dim text-magenta'
                    : 'border-cyan-dim text-cyan'
                  : 'text-faint line-through'
              }`}
              onClick={() => setFlipped((m) => ({ ...m, [chip.id]: !m[chip.id] }))}
              title={chip.active ? 'Tap to drop from this roll' : 'Tap to apply to this roll'}
            >
              {chip.label} {signed(chip.value)}
            </button>
          ))}
        </div>
      )}

      <div className="mt-3 flex items-center justify-between">
        <span className="mono-label">Situational</span>
        <Stepper value={situational} onChange={setSituational} />
      </div>

      {/* Edge (FR2.3) */}
      <div className="mt-3">
        <div className="mono-label mb-1.5">
          Edge <span className="text-warn">{props.edgeCurrent} left</span>
        </div>
        <div className="flex gap-1.5">
          {(
            [
              { id: 'none', label: 'No edge' },
              { id: 'push_pre', label: 'Push the limit' },
              { id: 'second_chance', label: 'Second chance' },
            ] as { id: EdgeChoice; label: string }[]
          ).map((opt) => (
            <button
              key={opt.id}
              type="button"
              disabled={opt.id !== 'none' && props.edgeCurrent <= 0}
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
        <div className="mono-label mb-1.5">Visibility</div>
        <div className="flex gap-1.5">
          {VISIBILITIES.map((v) => (
            <button
              key={v.id}
              type="button"
              className={`chip ${visibility === v.id ? 'border-cyan text-cyan' : 'text-dim'}`}
              onClick={() => setVisibility(v.id)}
            >
              {v.label}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="mt-3 text-sm text-danger">{error}</p>}

      <button
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
