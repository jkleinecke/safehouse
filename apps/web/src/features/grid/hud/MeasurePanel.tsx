/**
 * Bottom-left readout: ruler distance with walk/run bands (FR9.8), weapon
 * range band + the "apply −N to next roll" handoff (FR9.9), and the AoE /
 * grenade-scatter controls (FR9.12).
 */
import type { SheetWeapon } from '@safehouse/contracts';
import type { RangeReadout } from '../projection.js';
import type { PendingRollMod } from '../store.js';
import type { AoeTemplate, GridTool, MovementThresholds, RulerState, ScatterResult } from '../types.js';

const m1 = (n: number) => (Math.round(n * 10) / 10).toFixed(1);

function paceLabel(meters: number, t: MovementThresholds | null): { text: string; cls: string } {
  if (!t) return { text: 'no movement data', cls: 'text-faint' };
  if (meters <= t.walkM) return { text: `within walk (${t.walkM} m)`, cls: 'text-ok' };
  if (meters <= t.runM) return { text: `running (walk ${t.walkM} / run ${t.runM} m)`, cls: 'text-warn' };
  return { text: `beyond run (${t.runM} m)`, cls: 'text-danger' };
}

export interface MeasurePanelProps {
  tool: GridTool;
  ruler: RulerState | null;
  unitM: number;
  thresholds: MovementThresholds | null;
  weapons: SheetWeapon[];
  selectedWeapon: string | null;
  onSelectWeapon: (name: string | null) => void;
  range: RangeReadout | null;
  onApplyMod: (value: number, label: string) => void;
  pending: PendingRollMod | null;
  onClearMod: () => void;
  aoe: AoeTemplate | null;
  aoeRadiusM: number;
  onAoeRadius: (r: number) => void;
  scatter: ScatterResult | null;
  scatterDice: number;
  scatterNetHits: number;
  onScatterDice: (n: number) => void;
  onScatterNetHits: (n: number) => void;
  onScatter: () => void;
  onClearAoe: () => void;
}

const numCls =
  'w-14 rounded border border-edge bg-deck px-1.5 py-1 text-xs text-ink focus:border-cyan focus:outline-none';

export default function MeasurePanel(p: MeasurePanelProps) {
  const showRuler = p.tool === 'ruler' && p.ruler !== null;
  const showAoe = p.tool === 'aoe';
  if (!showRuler && !showAoe && !p.pending) return null;

  const pace = p.ruler ? paceLabel(p.ruler.meters, p.thresholds) : null;

  return (
    <div className="absolute bottom-3 left-3 z-10 w-[min(22rem,calc(100%-1.5rem))] rounded-lg border border-edge bg-panel/94 p-3 backdrop-blur">
      {showRuler && p.ruler && (
        <section>
          <div className="flex items-baseline justify-between">
            <span className="mono-label text-cyan">Measure</span>
            <span className="text-lg font-semibold tabular-nums">{m1(p.ruler.meters)} m</span>
          </div>
          {pace && <div className={`mono-label mt-0.5 ${pace.cls}`}>{pace.text}</div>}
          {!p.ruler.fromTokenId && (
            <div className="mono-label mt-0.5 text-faint">start on a token for pace bands</div>
          )}

          {p.weapons.length > 0 && (
            <div className="mt-2 flex items-center gap-2">
              <label className="mono-label shrink-0">Weapon</label>
              <select
                className="min-w-0 flex-1 rounded border border-edge bg-deck px-1.5 py-1 text-xs text-ink focus:border-cyan focus:outline-none"
                value={p.selectedWeapon ?? ''}
                onChange={(e) => p.onSelectWeapon(e.target.value || null)}
              >
                <option value="">— none —</option>
                {p.weapons.map((w) => (
                  <option key={w.name} value={w.name}>
                    {w.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {p.range && (
            <div className="mt-2 rounded border border-edge bg-deck/60 p-2">
              <div className="flex items-center justify-between gap-2">
                <span className="mono-label text-ink">{p.range.band ?? 'out of range'}</span>
                <span className="text-sm font-semibold tabular-nums text-warn">
                  {p.range.value === 0 ? '±0' : p.range.value}
                </span>
              </div>
              <div className="mono-label mt-0.5 text-faint">{p.range.label}</div>
              {p.range.edges && (
                <div className="mono-label mt-1 text-faint">
                  bands {p.range.edges.join(' / ')} m
                </div>
              )}
              {p.range.band && (
                <button
                  type="button"
                  className="btn btn-accent mt-2 w-full py-1"
                  onClick={() => p.onApplyMod(p.range?.value ?? 0, p.range?.label ?? 'range')}
                >
                  apply {p.range.value === 0 ? '±0' : p.range.value} to next roll
                </button>
              )}
            </div>
          )}
        </section>
      )}

      {showAoe && (
        <section className={showRuler ? 'mt-3 border-t border-edge pt-3' : ''}>
          <div className="flex items-baseline justify-between">
            <span className="mono-label text-magenta">Template</span>
            <span className="mono-label text-faint">{p.unitM} m / square</span>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <label className="mono-label">Radius</label>
            <input
              type="number"
              min={0.5}
              step={0.5}
              className={numCls}
              value={p.aoeRadiusM}
              onChange={(e) => p.onAoeRadius(Number(e.target.value))}
            />
            <span className="mono-label text-faint">m</span>
            <button type="button" className="btn ml-auto py-1" onClick={p.onClearAoe}>
              clear
            </button>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <label className="mono-label">Scatter</label>
            <input
              type="number"
              min={1}
              max={6}
              className={numCls}
              value={p.scatterDice}
              onChange={(e) => p.onScatterDice(Number(e.target.value))}
              title="Scatter dice (thrown 2, launched 3 — editable)"
            />
            <span className="mono-label text-faint">d6 −</span>
            <input
              type="number"
              min={0}
              className={numCls}
              value={p.scatterNetHits}
              onChange={(e) => p.onScatterNetHits(Number(e.target.value))}
              title="Net hits on the attack reduce scatter"
            />
            <span className="mono-label text-faint">hits</span>
            <button
              type="button"
              className="btn btn-accent ml-auto py-1"
              disabled={!p.aoe}
              onClick={p.onScatter}
            >
              roll scatter
            </button>
          </div>
          {p.scatter && (
            <div className="mono-label mt-2 text-warn">landed {p.scatter.summary}</div>
          )}
          {!p.aoe && (
            <div className="mono-label mt-2 text-faint">click the map to place the template</div>
          )}
        </section>
      )}

      {p.pending && (
        <div className="mt-3 flex items-center gap-2 border-t border-edge pt-2">
          <span className="chip border-warn/40 text-warn">
            next roll {p.pending.value === 0 ? '±0' : p.pending.value}
          </span>
          <span className="mono-label min-w-0 flex-1 truncate text-faint">{p.pending.label}</span>
          <button type="button" className="btn py-1" onClick={p.onClearMod}>
            clear
          </button>
        </div>
      )}
    </div>
  );
}
