/**
 * The map's context menu — the list `contextMenuItems.ts` decided on, drawn
 * at the pointer inside the canvas host (UX proposal 4.1).
 *
 * Fitts: it opens where the pointer already is and every row is a full-width
 * target. It closes on Escape, on a click anywhere else, and after any row.
 * Near the right or bottom edge it flips so it never opens off-canvas.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { MenuItem } from './contextMenuItems.js';

export interface ContextMenuProps {
  /** Pixels from the canvas host's top-left. */
  x: number;
  y: number;
  /** A one-line eyebrow: what the menu is about ("Whisper", "the door"). */
  about: string;
  items: MenuItem[];
  onClose: () => void;
}

export default function ContextMenu({ x, y, about, items, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  // Keep it on the canvas: measure once mounted, flip if it would overflow.
  useLayoutEffect(() => {
    const el = ref.current;
    const host = el?.parentElement;
    if (!el || !host) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const maxLeft = host.clientWidth - w - 4;
    const maxTop = host.clientHeight - h - 4;
    setPos({
      left: Math.max(4, Math.min(x, maxLeft)),
      top: Math.max(4, Math.min(y, maxTop)),
    });
  }, [x, y, items.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener('keydown', onKey);
    // Capture, so a click on the canvas closes the menu before the canvas
    // starts a new gesture with it.
    window.addEventListener('pointerdown', onDown, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown, true);
    };
  }, [onClose]);

  // The first row takes focus so arrow keys and Enter work without a mouse.
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>('button')?.focus();
  }, []);

  const onMenuKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const buttons = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>('button') ?? []);
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = e.key === 'ArrowDown' ? (i + 1) % buttons.length : (i - 1 + buttons.length) % buttons.length;
    buttons[next]?.focus();
  };

  if (items.length === 0) return null;
  return (
    <div
      ref={ref}
      role="menu"
      aria-label={`Actions for ${about}`}
      data-testid="map-context-menu"
      className="absolute z-30 min-w-[13rem] max-w-[17rem] rounded-md border border-edge bg-panel/95 py-1 shadow-lg backdrop-blur"
      style={{ left: pos.left, top: pos.top }}
      onKeyDown={onMenuKey}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="mono-label truncate px-3 pb-1 pt-1 text-faint">{about}</div>
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="menuitem"
          data-testid={`ctx-${item.id}`}
          className={
            'block w-full px-3 py-1.5 text-left text-sm hover:bg-deck focus:bg-deck focus:outline-none ' +
            (item.danger ? 'text-danger' : 'text-ink')
          }
          onClick={() => {
            onClose();
            item.run();
          }}
        >
          <span className="block">{item.label}</span>
          {item.hint && <span className="block text-xs text-dim">{item.hint}</span>}
        </button>
      ))}
    </div>
  );
}
