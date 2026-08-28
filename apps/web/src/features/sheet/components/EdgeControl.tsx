/**
 * Current Edge with spend / regain / burn (FR2.3, FR3.4). Burning Edge is a
 * distinct, loudly-confirmed action — two taps with an explicit warning.
 */
import { useState } from 'react';
import type { EdgeState } from '@safehouse/contracts';
import type { EdgeOp } from '../lib.js';

export default function EdgeControl({
  edge,
  onOp,
  busy,
}: {
  edge: EdgeState;
  onOp: (op: EdgeOp) => void;
  busy?: boolean;
}) {
  const [confirmBurn, setConfirmBurn] = useState(false);

  return (
    <div className="flex items-center gap-2">
      <span className="mono-label w-7 shrink-0">EDG</span>
      <div className="flex items-center gap-0.5" aria-label={`Edge ${edge.current} of ${edge.max}`}>
        {Array.from({ length: Math.max(edge.max, edge.current) }, (_, i) => (
          <span
            key={i}
            aria-hidden
            className={`text-base leading-none ${i < edge.current ? 'text-warn' : 'text-edge-bright'}`}
          >
            ◆
          </span>
        ))}
        {edge.max === 0 && <span className="text-xs text-faint">—</span>}
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-1.5">
        {confirmBurn ? (
          <>
            <span className="text-xs text-danger">Burn permanently?</span>
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
            <button type="button" className="chip text-dim" onClick={() => setConfirmBurn(false)}>
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
              title="Regain a point of Edge"
            >
              +
            </button>
            <button
              type="button"
              className="chip border-warn/50 text-warn disabled:opacity-40"
              disabled={busy || edge.current <= 0}
              onClick={() => onOp('spend')}
            >
              Spend
            </button>
            <button
              type="button"
              className="chip text-faint hover:border-danger hover:text-danger disabled:opacity-40"
              disabled={busy || edge.max <= 0}
              onClick={() => setConfirmBurn(true)}
            >
              Burn
            </button>
          </>
        )}
      </div>
    </div>
  );
}
