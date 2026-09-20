/**
 * Grid calibration behind a gear on the mode bar.
 *
 * Calibration is "tune cols, rows and offset until the drawn grid sits on the
 * image's own squares", which is a thing a GM does once per scanned map and
 * then never again — but while they are doing it they are staring at the
 * canvas, nudging a number and looking, nudging and looking. A panel section
 * is the wrong shape for that: it competes for the width that the map wants,
 * and it is filed under a tab.
 *
 * So it is a gear beside the set, and what it opens is the same six numbers
 * over the canvas, close to the grid they move.
 */
import { useEffect, useRef, useState } from 'react';
import type { Scene } from '@safehouse/contracts';
import { usePatchScene } from '../api.js';
import { Num, Row } from '../gm/ui.js';

export default function CalibrateMenu({ scene }: { scene: Scene }) {
  const patch = usePatchScene();
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    const away = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', key);
    };
  }, [open]);

  const grid = scene.grid;
  const setGrid = (next: Partial<typeof grid>) =>
    patch.mutate({ sceneId: scene.id, patch: { grid: { ...grid, ...next } } });

  return (
    <div ref={boxRef} className="relative flex items-center">
      <button
        type="button"
        data-testid="calibrate-menu"
        title="Calibrate the grid"
        aria-label="Calibrate the grid"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="btn min-h-9 px-2 py-1 text-xs leading-none text-dim"
      >
        <span aria-hidden>⚙</span>
      </button>

      {open && (
        <div
          data-testid="calibrate-open"
          className="absolute left-0 top-full z-30 mt-1 w-64 space-y-2 rounded-lg border border-edge bg-panel p-3 shadow-lg"
        >
          <Row label="Columns">
            <Num value={grid.cols} min={1} onChange={(n) => setGrid({ cols: Math.max(1, Math.round(n)) })} />
          </Row>
          <Row label="Rows">
            <Num value={grid.rows} min={1} onChange={(n) => setGrid({ rows: Math.max(1, Math.round(n)) })} />
          </Row>
          <Row label="Metres">
            <Num
              value={grid.unitM}
              min={0.1}
              step={0.5}
              title="Metres per square"
              onChange={(n) => setGrid({ unitM: n > 0 ? n : 1 })}
            />
          </Row>
          <Row label="Offset X">
            <Num value={grid.offset.x} step={0.05} onChange={(n) => setGrid({ offset: { ...grid.offset, x: n } })} />
          </Row>
          <Row label="Offset Y">
            <Num value={grid.offset.y} step={0.05} onChange={(n) => setGrid({ offset: { ...grid.offset, y: n } })} />
          </Row>
          <Row label="Opacity">
            <Num
              value={grid.opacity ?? 0.35}
              step={0.05}
              min={0}
              max={1}
              onChange={(n) => setGrid({ opacity: Math.max(0, Math.min(1, n)) })}
            />
          </Row>
          <p className="mono-label text-faint" data-testid="calibrate-size">
            {grid.cols}×{grid.rows} squares = {(grid.cols * grid.unitM).toFixed(0)}×
            {(grid.rows * grid.unitM).toFixed(0)} m
          </p>
        </div>
      )}
    </div>
  );
}
