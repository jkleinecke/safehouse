/**
 * Which floor is on screen — one control on the mode bar.
 *
 * It was a row of chips on the canvas, which wrapped once a building had a
 * cellar, a ground floor, two storeys and a roof. The floor is on the
 * button's face because it is the thing a GM checks most often, and a
 * control that has to be opened to be read is not a quick way to find
 * anything.
 *
 * It carried a list of drawable layers with an eye each for a while
 * (2026-09-20); that idea was wrong and came straight back out. Whatever
 * replaces it will be built here.
 */
import { useEffect, useRef, useState } from 'react';
import type { Scene } from '@safehouse/contracts';
import { GROUND_LEVEL_NAME } from '@safehouse/rules';
import { useSetSceneLevels } from '../api.js';
import { useGridStore } from '../store.js';
import ConfirmButton from '../gm/ConfirmButton.js';

/** Cheap unique id for a new floor — the server only needs it to be stable. */
function newLevelId(): string {
  return `lvl-${Math.random().toString(36).slice(2, 9)}`;
}

/** The floors of a scene, ground first, as the chips used to list them. */
export function floorNames(scene: Scene): string[] {
  return [GROUND_LEVEL_NAME, ...(scene.levels ?? []).map((l) => l.name)];
}

export default function FloorMenu({ scene }: { scene: Scene }) {
  const activeLevel = useGridStore((s) => s.activeLevel);
  const setActiveLevel = useGridStore((s) => s.setActiveLevel);
  const save = useSetSceneLevels();

  const [open, setOpen] = useState(false);
  // The name is typed here, not in a `window.prompt`: that one native dialog
  // steals focus, and in an embedded or automated browser it returns null
  // without ever appearing — "add a floor" then did nothing and said nothing.
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const boxRef = useRef<HTMLDivElement | null>(null);
  const draftRef = useRef<HTMLInputElement | null>(null);

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

  // Opening the namer puts the cursor in it: the GM asked to type a name.
  useEffect(() => {
    if (adding) draftRef.current?.focus();
  }, [adding]);

  // A menu that closes forgets it was naming a floor.
  useEffect(() => {
    if (!open) {
      setAdding(false);
      setDraft('');
    }
  }, [open]);

  const floors = floorNames(scene);
  const here = floors[activeLevel] ?? floors[0] ?? GROUND_LEVEL_NAME;

  const addFloor = async () => {
    const upper = scene.levels ?? [];
    const name = draft.trim() || `Level ${floors.length}`;
    // Whole-list, like the levels panel: only the new one is new, the rest
    // go back exactly as they were.
    const levels = [...upper.map((l) => ({ id: l.id, name: l.name })), { id: newLevelId(), name }];
    await save.mutateAsync({ sceneId: scene.id, levels });
    // Stand on what was just built — a floor added and not opened is a floor
    // the GM has to go and find.
    setActiveLevel(levels.length);
    setDraft('');
    setAdding(false);
    setOpen(false);
  };

  /**
   * Take a storey out, and everything painted on it with it — which is why
   * it asks first. `i` counts from the ground floor, and the ground floor is
   * not in the editable list: it is `scene.tiles`, it is where every scene's
   * paint already lives, and a building with no ground floor is not one.
   */
  const removeFloor = async (i: number) => {
    const upper = scene.levels ?? [];
    // Drop the GM back a floor if they were standing on the one that just
    // went, rather than leaving them on an index that no longer exists.
    if (activeLevel >= i) setActiveLevel(Math.max(0, i - 1));
    await save.mutateAsync({
      sceneId: scene.id,
      levels: upper.filter((_, j) => j !== i - 1).map((l) => ({ id: l.id, name: l.name })),
    });
  };

  return (
    <div ref={boxRef} className="relative flex items-center" data-testid="floor-menu">
      <button
        type="button"
        data-testid="floor-button"
        title={`Floor: ${here}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="btn flex min-h-9 items-center gap-1.5 px-2 py-1 text-[0.7rem] text-ink"
      >
        <span aria-hidden>▤</span>
        <span className="max-w-28 truncate">{here}</span>
        <span aria-hidden className="text-[0.6rem] text-dim">
          ▾
        </span>
      </button>

      {open && (
        <div
          role="menu"
          data-testid="floor-open"
          className="absolute left-0 top-full z-30 mt-1 max-h-96 w-48 overflow-y-auto rounded-lg border border-edge bg-panel p-1 shadow-lg"
        >
          {/*
            First, because adding a storey is the one thing this list cannot
            already do by being read, and a GM who opened it to add a floor
            should not have to scroll past the ones that exist.
          */}
          {adding ? (
            <form
              className="flex items-center gap-1 p-1"
              onSubmit={(e) => {
                e.preventDefault();
                void addFloor();
              }}
            >
              <input
                ref={draftRef}
                className="min-w-0 flex-1 rounded border border-edge bg-deck px-1.5 py-1 text-xs text-ink placeholder:text-faint"
                placeholder={`Level ${floors.length} — catwalk, cellar…`}
                aria-label="Name for the new floor"
                data-testid="floor-name"
                value={draft}
                disabled={save.isPending}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  // Esc backs out of naming without shutting the whole menu.
                  if (e.key === 'Escape') {
                    e.stopPropagation();
                    setAdding(false);
                    setDraft('');
                  }
                }}
              />
              <button
                type="submit"
                data-testid="floor-add-save"
                disabled={save.isPending}
                className="mono-label rounded border border-cyan px-2 py-1 text-cyan disabled:opacity-40"
              >
                add
              </button>
            </form>
          ) : (
            <button
              type="button"
              data-testid="floor-add"
              onClick={() => setAdding(true)}
              className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-xs text-cyan hover:bg-raised/60"
            >
              <span aria-hidden className="w-4 text-center">
                +
              </span>
              <span>Add a floor…</span>
            </button>
          )}
          <span className="my-1 block h-px bg-edge" aria-hidden />
          {floors.map((name, i) => (
            <div key={i} className="flex items-center gap-1">
              <button
                type="button"
                role="menuitemradio"
                aria-checked={i === activeLevel}
                data-testid={`floor-${i}`}
                onClick={() => {
                  setActiveLevel(i);
                  setOpen(false);
                }}
                className={
                  'flex min-w-0 flex-1 items-center gap-2 rounded px-1.5 py-1 text-left text-xs ' +
                  (i === activeLevel ? 'bg-raised text-cyan' : 'text-ink hover:bg-raised/60')
                }
              >
                <span aria-hidden className="w-4 text-center">
                  {i === activeLevel ? '●' : '○'}
                </span>
                <span className="min-w-0 truncate">{name}</span>
              </button>
              {/*
                The ground floor has no bin: it is `scene.tiles` itself. Every
                storey above it does, and it asks first, because the paint
                goes with the floor.
              */}
              {i > 0 && (
                <ConfirmButton
                  label="🗑"
                  confirmLabel="remove?"
                  testId={`floor-remove-${i}`}
                  disabled={save.isPending}
                  title={`Remove ${name} and everything painted on it`}
                  className="shrink-0 rounded px-1.5 py-1 text-[0.7rem] leading-none disabled:opacity-40"
                  onConfirm={() => void removeFloor(i)}
                />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
