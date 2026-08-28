/** Small form atoms for the Grid's GM authoring panel (desktop-first, NG5). */
import type { ReactNode } from 'react';

export const inputCls =
  'w-full rounded border border-edge bg-deck px-2 py-1 text-xs text-ink ' +
  'placeholder:text-faint focus:border-cyan focus:outline-none';

export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex items-center gap-2">
      <span className="mono-label w-20 shrink-0">{label}</span>
      <span className="min-w-0 flex-1">{children}</span>
    </label>
  );
}

export function Num({
  value,
  onChange,
  step = 1,
  min,
  max,
  title,
}: {
  value: number;
  onChange: (n: number) => void;
  step?: number;
  min?: number;
  max?: number;
  title?: string;
}) {
  return (
    <input
      type="number"
      className={inputCls}
      value={Number.isFinite(value) ? value : 0}
      step={step}
      min={min}
      max={max}
      title={title}
      onChange={(e) => {
        const n = Number(e.target.value);
        if (Number.isFinite(n)) onChange(n);
      }}
    />
  );
}

export function PanelSection({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="border-b border-edge px-3 py-3 last:border-b-0">
      <div className="flex items-baseline justify-between gap-2">
        <span className="mono-label text-cyan">{title}</span>
        {hint && <span className="mono-label text-faint">{hint}</span>}
      </div>
      <div className="mt-2 space-y-2">{children}</div>
    </section>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="mono-label text-faint">{children}</p>;
}

/** Best-effort client id; the server may replace it on write. */
export function newId(prefix: string): string {
  const rand =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  return `${prefix}_${rand}`;
}
