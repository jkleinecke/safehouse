/**
 * GM steering of the table display (FR9.21) and the two table-feel gestures
 * that need a console (FR9.15): "focus here" and the pointer trail.
 *
 * `display.set` / `scene.focus` / `pointer` are contracted commands with hub
 * handlers behind them; the TV consumes the `display.updated` event this
 * drives (`features/tv/feed.ts tvControls`). All three are GM-gated
 * server-side, so this panel's absence on a player's screen is a courtesy,
 * not the security boundary.
 */
import { useEffect, useState } from 'react';
import type { GridCommands } from '../commands.js';
import { useGridStore } from '../store.js';
import { useDisplayState } from '../useGridLive.js';

export interface DisplayTabProps {
  commands: GridCommands;
}

function Toggle({
  on,
  label,
  hint,
  onClick,
}: {
  on: boolean;
  label: string;
  hint: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={hint}
      aria-pressed={on}
      className={'btn w-full py-1 ' + (on ? 'border-cyan text-cyan' : 'text-dim')}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

export default function DisplayTab({ commands }: DisplayTabProps) {
  const display = useGridStore((s) => s.display);
  const setDisplay = useGridStore((s) => s.setDisplay);
  const tool = useGridStore((s) => s.tool);
  const setTool = useGridStore((s) => s.setTool);
  const [offline, setOffline] = useState(false);

  // The console follows the server's own `display.updated` when one exists, so
  // a refresh mid-session shows what the table is actually doing (LIVE-1).
  const server = useDisplayState();
  useEffect(() => {
    setDisplay({ blank: server.blank, ribbon: server.ribbon });
  }, [server.blank, server.ribbon, setDisplay]);

  /** Optimistic locally; the TV follows the server's `display.updated`. */
  const push = (patch: { blank?: boolean; ribbon?: boolean }) => {
    setDisplay(patch);
    setOffline(!commands.display(patch));
  };

  return (
    <>
      <section className="border-b border-edge px-3 py-3">
        <div className="flex items-baseline justify-between gap-2">
          <span className="mono-label text-cyan">The table display</span>

        </div>
        <div className="mt-2 space-y-2">
          <Toggle
            on={display.blank}
            label={display.blank ? 'table is blanked' : 'blank the table'}
            hint="One tap hides everything on the big screen"
            onClick={() => push({ blank: !display.blank })}
          />
          <Toggle
            on={display.ribbon}
            label={display.ribbon ? 'initiative ribbon on' : 'initiative ribbon off'}
            hint="Hide the ribbon during pure roleplay"
            onClick={() => push({ ribbon: !display.ribbon })}
          />
          {offline && (
            <p className="mono-label text-warn">
              not connected — the table did not hear that
            </p>
          )}
        </div>
      </section>

      <section className="border-b border-edge px-3 py-3">
        <div className="flex items-baseline justify-between gap-2">
          <span className="mono-label text-cyan">Focus &amp; pointer</span>

        </div>
        <div className="mt-2 space-y-2">
          <Toggle
            on={tool === 'focus'}
            label={tool === 'focus' ? 'click the map to pull every view' : 'focus here'}
            hint="Recentres every viewport once; players pan freely afterwards"
            onClick={() => setTool(tool === 'focus' ? 'select' : 'focus')}
          />
          <Toggle
            on={tool === 'pointer'}
            label={tool === 'pointer' ? 'drag to draw a trail' : 'pointer trail'}
            hint="Streams a fading trail to every screen while you drag"
            onClick={() => setTool(tool === 'pointer' ? 'select' : 'pointer')}
          />
          <p className="mono-label text-faint">
            double-tap the map at any time to flash a ping for the table
          </p>
        </div>
      </section>
    </>
  );
}
