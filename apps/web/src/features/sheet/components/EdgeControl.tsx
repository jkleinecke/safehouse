/**
 * Current Edge with spend / regain / burn (FR2.3, FR3.4), plus the two
 * initiative-moving Edge actions (FR2.3/FR4.4).
 *
 * Burning Edge is a distinct, loudly-confirmed action — two taps with an
 * explicit warning. Seize the Initiative and Blitz appear only while this
 * character actually has a seat in a running encounter, because both of them
 * move a position in the initiative order and there is nothing to move
 * otherwise; `GET /api/characters/:id/derived` supplies that `combatantId`.
 * Close Call is not here: it answers a roll that has already happened, so it
 * is offered next to the glitch instead (see CloseCallOffer).
 */
import { useState } from 'react';
import type { EdgeState } from '@safehouse/contracts';
import { edgeTrackLabel } from '../a11y.js';
import { EDGE_ACTION_HINTS, EDGE_ACTION_LABELS } from '../edgeActions.js';
import type { EdgeOp } from '../lib.js';

export interface EdgeActionsApi {
  /** This character's row in the live encounter, or null when out of combat. */
  combatantId: string | null;
  onAction: (action: 'seize_initiative' | 'blitz') => void;
  pending?: boolean;
}

export default function EdgeControl({
  edge,
  burned = 0,
  onOp,
  busy,
  actions,
}: {
  edge: EdgeState;
  /** Points burned permanently — spoken, since the pips cannot show it. */
  burned?: number;
  onOp: (op: EdgeOp) => void;
  busy?: boolean;
  actions?: EdgeActionsApi;
}) {
  const [confirmBurn, setConfirmBurn] = useState(false);
  const canAct = Boolean(actions?.combatantId) && edge.current > 0;

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <span className="mono-label w-7 shrink-0" aria-hidden>
          EDG
        </span>
        <div
          className="flex items-center gap-0.5"
          role="img"
          aria-label={edgeTrackLabel(edge.current, edge.max, burned)}
        >
          {Array.from({ length: Math.max(edge.max, edge.current) }, (_, i) => (
            <span
              key={i}
              aria-hidden
              className={`text-base leading-none ${i < edge.current ? 'text-warn' : 'text-edge-bright'}`}
            >
              ◆
            </span>
          ))}
          {edge.max === 0 && (
            <span className="text-xs text-faint" aria-hidden>
              —
            </span>
          )}
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          {confirmBurn ? (
            <>
              <span className="text-xs text-danger" role="alert">
                Burn permanently?
              </span>
              <button
                type="button"
                className="chip border-danger text-danger"
                disabled={busy}
                onClick={() => {
                  setConfirmBurn(false);
                  onOp('burn');
                }}
              >
                Burn it
              </button>
              <button
                type="button"
                className="chip text-dim"
                onClick={() => setConfirmBurn(false)}
              >
                Keep
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="chip text-dim hover:border-cyan hover:text-cyan disabled:opacity-40"
                disabled={busy || edge.current >= edge.max}
                onClick={() => onOp('regain')}
                aria-label="Regain a point of Edge"
              >
                +
              </button>
              <button
                type="button"
                className="chip border-warn/50 text-warn disabled:opacity-40"
                disabled={busy || edge.current <= 0}
                onClick={() => onOp('spend')}
                aria-label="Spend a point of Edge"
              >
                Spend
              </button>
              <button
                type="button"
                className="chip text-faint hover:border-danger hover:text-danger disabled:opacity-40"
                disabled={busy || edge.max <= 0}
                onClick={() => setConfirmBurn(true)}
                aria-label="Burn a point of Edge permanently"
              >
                Burn
              </button>
            </>
          )}
        </div>
      </div>

      {actions?.combatantId && (
        <div
          className="flex flex-wrap items-center gap-1.5 pl-9"
          role="group"
          aria-label="Edge actions in this fight"
        >
          {(['seize_initiative', 'blitz'] as const).map((action) => (
            <button
              key={action}
              type="button"
              className="chip border-warn/40 text-warn disabled:opacity-40"
              disabled={!canAct || actions.pending || busy}
              onClick={() => actions.onAction(action)}
              aria-label={`${EDGE_ACTION_LABELS[action]} — ${EDGE_ACTION_HINTS[action]}`}
            >
              {EDGE_ACTION_LABELS[action]}
            </button>
          ))}
          {edge.current <= 0 && <span className="text-xs text-faint">No Edge left.</span>}
        </div>
      )}
    </div>
  );
}
