/**
 * Floors (FR9.22) — add a catwalk, a first storey, a sub-basement.
 *
 * Lives in the Map tab beside the grid's dimensions, because that is what it
 * is: a fact about the shape of the building rather than a thing you paint.
 *
 * The GROUND floor is not in the editable list and cannot be removed. It is
 * `scene.tiles`, it is where every existing scene's paint already lives, and a
 * building with no ground floor is not a building. Everything above it is an
 * ordinary list the GM can add to, rename and cut back.
 *
 * Removing a floor takes its paint with it, so it asks first — the same
 * courtesy the tileset switch gets, and for the same reason: it is the one
 * click here that destroys work.
 */
import { useState } from 'react';
import type { Scene } from '@safehouse/contracts';
import { GROUND_LEVEL_NAME } from '@safehouse/rules';
import { useSetSceneLevels } from '../api.js';
import { useGridStore } from '../store.js';

export interface LevelsPanelProps {
  scene: Scene;
}

/** Cheap unique id for a new floor — the server only needs it to be stable. */
function newLevelId(): string {
  return `lvl-${Math.random().toString(36).slice(2, 9)}`;
}

export default function LevelsPanel({ scene }: LevelsPanelProps) {
  const activeLevel = useGridStore((s) => s.activeLevel);
  const setActiveLevel = useGridStore((s) => s.setActiveLevel);
  const save = useSetSceneLevels();
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState('');

  const upper = scene.levels ?? [];
  // The ground floor is implicit; the list the GM edits is everything above it.
  const names = [GROUND_LEVEL_NAME, ...upper.map((l) => l.name)];

  const write = async (levels: { id: string; name: string }[]) => {
    setBusy(true);
    try {
      await save.mutateAsync({ sceneId: scene.id, levels });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div data-testid="levels-panel">
      <div className="mono-label text-dim">Floors</div>
      <div className="mt-1 flex flex-col gap-1">
        {names.map((name, i) => {
          const active = i === activeLevel;
          return (
            <div key={i} className="flex items-center gap-1">
              <button
                type="button"
                data-level-index={i}
                aria-pressed={active}
                onClick={() => setActiveLevel(i)}
                className={
                  'flex-1 rounded border px-2 py-1 text-left text-xs ' +
                  (active ? 'border-cyan text-cyan' : 'border-edge text-ink hover:border-dim')
                }
              >
                {name}
              </button>
              {i > 0 && (
                <button
                  type="button"
                  data-testid={`remove-level-${i}`}
                  disabled={busy}
                  title="Remove this floor and everything painted on it"
                  onClick={() => {
                    if (!window.confirm(`Remove “${name}” and everything painted on it?`)) return;
                    // Drop the GM back a floor if they were standing on the one
                    // that just went, rather than leaving them on an index that
                    // no longer exists.
                    if (activeLevel >= i) setActiveLevel(Math.max(0, i - 1));
                    void write(upper.filter((_, j) => j !== i - 1).map((l) => ({ id: l.id, name: l.name })));
                  }}
                  className="mono-label rounded border border-edge px-2 py-1 text-danger disabled:opacity-40"
                >
                  ×
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/*
        The name is typed here, not in a browser prompt. `window.prompt` was
        the one native dialog in a panel where everything else is inline, and
        in an embedded or automated browser it returns null without ever
        appearing — "add a floor" then did nothing and said nothing.
      */}
      <form
        className="mt-1 flex gap-1"
        onSubmit={(e) => {
          e.preventDefault();
          const name = draft.trim() || `Level ${names.length}`;
          const next = [
            ...upper.map((l) => ({ id: l.id, name: l.name })),
            { id: newLevelId(), name },
          ];
          setDraft('');
          void write(next).then(() => setActiveLevel(next.length));
        }}
      >
        <input
          className="min-w-0 flex-1 rounded border border-edge bg-deck px-2 py-1 text-xs text-ink placeholder:text-faint"
          placeholder={`Level ${names.length} — catwalk, mezzanine, cellar…`}
          aria-label="Name for the new floor"
          value={draft}
          disabled={busy}
          onChange={(e) => setDraft(e.target.value)}
        />
        <button
          type="submit"
          data-testid="add-level"
          disabled={busy}
          className="mono-label rounded border border-edge px-2 py-1 text-dim disabled:opacity-40"
        >
          add a floor
        </button>
      </form>
      <p className="mt-1 text-xs text-faint">
        Painting, sight and cover all apply to the floor you have selected. Tokens carry their own
        floor, so half the party can be upstairs.
      </p>
    </div>
  );
}
