/**
 * Provenance UI (Principle 3: "why is my pool 11?"): any derived number can
 * expand into its breakdown, and any breakdown offers an inline override
 * (Principle 2) — long-press the value, or tap it and hit Override.
 */
import { useRef, useState } from 'react';
import type { LimitRef, ProvenanceEntry } from '@safehouse/contracts';
import { breakdownLabel } from '../a11y.js';
import { hasOverrideEntry, signed } from '../lib.js';
import { Sheet } from './ui.js';

const LONG_PRESS_MS = 450;

export interface OverrideApi {
  /** Current override on this target, if any. */
  current?: { value: number; note?: string };
  set: (value: number, note?: string) => void;
  clear: () => void;
}

export interface BreakdownButtonProps {
  /** What the number is — dialog title ("Perception pool", "Physical monitor"). */
  title: string;
  value: number;
  breakdown: ProvenanceEntry[];
  limit?: LimitRef;
  /** Provided ⇒ the value is overridable (target known). */
  override?: OverrideApi;
  className?: string;
  /** Render the value; default is the plain number. */
  children?: React.ReactNode;
}

/**
 * A tappable derived value: tap → breakdown sheet; long-press → straight to
 * the override editor. Shows a flag when an override is in play.
 *
 * Long-press is a touch shortcut, never the only path: the breakdown sheet it
 * opens always carries an "Override…" button, so a keyboard user reaches the
 * same editor with Enter then Tab. The sheet itself traps Tab and closes on
 * Escape (see `Sheet`), which is what made this popover escapable at all.
 */
export function BreakdownButton(props: BreakdownButtonProps) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longFired = useRef(false);

  const overridden = Boolean(props.override?.current) || hasOverrideEntry(props.breakdown);

  const startPress = () => {
    if (!props.override) return;
    longFired.current = false;
    pressTimer.current = setTimeout(() => {
      longFired.current = true;
      setEditing(true);
      setOpen(true);
    }, LONG_PRESS_MS);
  };
  const endPress = () => {
    if (pressTimer.current) clearTimeout(pressTimer.current);
    pressTimer.current = null;
  };

  return (
    <>
      <button
        type="button"
        className={
          props.className ??
          'inline-flex items-center gap-1 rounded border border-edge bg-raised px-2 py-0.5 font-label text-sm text-cyan'
        }
        onClick={(e) => {
          e.stopPropagation(); // rows may have their own tap action (e.g. roll)
          if (longFired.current) return; // long-press already opened the editor
          setEditing(false);
          setOpen(true);
        }}
        onPointerDown={startPress}
        onPointerUp={endPress}
        onPointerLeave={endPress}
        onContextMenu={(e) => {
          if (!props.override) return;
          e.preventDefault();
          setEditing(true);
          setOpen(true);
        }}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={breakdownLabel(props.title, props.value, overridden)}
      >
        {props.children ?? props.value}
        {overridden && (
          <span className="text-warn" title="Overridden" aria-hidden>
            ⚑
          </span>
        )}
      </button>

      <BreakdownSheet
        open={open}
        onClose={() => {
          setOpen(false);
          setEditing(false);
        }}
        title={props.title}
        value={props.value}
        breakdown={props.breakdown}
        limit={props.limit}
        override={props.override}
        startEditing={editing}
      />
    </>
  );
}

export function BreakdownSheet({
  open,
  onClose,
  title,
  value,
  breakdown,
  limit,
  override,
  startEditing = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  value: number;
  breakdown: ProvenanceEntry[];
  limit?: LimitRef;
  override?: OverrideApi;
  startEditing?: boolean;
}) {
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <div className="mb-3 flex items-baseline gap-2">
        <span className="font-label text-3xl text-cyan">{value}</span>
        {limit && (
          <span className="chip text-dim">
            limit {limit.kind} {limit.value}
          </span>
        )}
      </div>

      <ul className="divide-y divide-edge/60">
        {breakdown.map((entry, i) => (
          <li key={i} className="flex items-center justify-between gap-3 py-1.5 text-sm">
            <span className="min-w-0 flex-1 truncate text-ink">{entry.label}</span>
            {entry.source && <span className="mono-label shrink-0">{entry.source}</span>}
            <span
              className={`w-10 shrink-0 text-right font-label ${
                entry.value < 0 ? 'text-magenta' : 'text-ink'
              }`}
            >
              {signed(entry.value)}
            </span>
          </li>
        ))}
        {breakdown.length === 0 && <li className="py-2 text-sm text-faint">No contributions.</li>}
      </ul>

      {override && <OverrideEditor override={override} startEditing={startEditing} onDone={onClose} />}
    </Sheet>
  );
}

function OverrideEditor({
  override,
  startEditing,
  onDone,
}: {
  override: OverrideApi;
  startEditing: boolean;
  onDone: () => void;
}) {
  const [editing, setEditing] = useState(startEditing);
  const [value, setValue] = useState<string>(override.current ? String(override.current.value) : '');
  const [note, setNote] = useState(override.current?.note ?? '');

  if (!editing) {
    return (
      <div className="mt-4 flex items-center justify-between gap-2 border-t border-edge pt-3">
        {override.current ? (
          <span className="chip border-warn/60 text-warn">
            ⚑ override {override.current.value}
            {override.current.note ? ` — ${override.current.note}` : ''}
          </span>
        ) : (
          <span className="text-xs text-faint">GM/owner can override this value.</span>
        )}
        <div className="flex gap-2">
          {override.current && (
            <button
              type="button"
              className="btn"
              onClick={() => {
                override.clear();
                onDone();
              }}
            >
              Clear
            </button>
          )}
          <button type="button" className="btn btn-accent" onClick={() => setEditing(true)}>
            Override…
          </button>
        </div>
      </div>
    );
  }

  const parsed = Number(value);
  const valid = value.trim() !== '' && Number.isFinite(parsed);

  return (
    <div className="mt-4 border-t border-edge pt-3">
      <div className="mono-label mb-2 text-warn">Set override</div>
      <div className="flex gap-2">
        <input
          className="w-20 rounded border border-edge-bright bg-ground px-2 py-1.5 font-label text-sm text-ink"
          inputMode="numeric"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="value"
          aria-label="Override value"
          autoFocus
        />
        <input
          className="min-w-0 flex-1 rounded border border-edge bg-ground px-2 py-1.5 text-sm text-ink"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="because… (optional)"
          aria-label="Override note"
        />
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <button type="button" className="btn" onClick={() => setEditing(false)}>
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-accent"
          disabled={!valid}
          onClick={() => {
            if (!valid) return;
            override.set(parsed, note.trim() || undefined);
            onDone();
          }}
        >
          Save
        </button>
      </div>
    </div>
  );
}
