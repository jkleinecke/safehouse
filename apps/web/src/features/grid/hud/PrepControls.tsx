/**
 * Prep's map-wide settings, on the mode row (docs/UX_MAP_BUILDER.md §3.1).
 *
 * Three things a GM sets for the whole scene rather than for a square: the
 * environment (light, visibility, glare, wind — the modifier they compose to),
 * whose eyes the GM is looking through, and whether players see only their
 * own sightline. They were panel tabs — Env and LOS — each a page for one or
 * two controls; up here they are one click away from any tool, and the panel
 * is left for the thing that is picked.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Scene, Token } from '@safehouse/contracts';
import { environment } from '@safehouse/rules';
import { usePatchScene } from '../api.js';
import EnvTab from '../gm/EnvTab.js';
import { useGridStore } from '../store.js';
import { cameraLensId } from '../useShroud.js';

/** A button on the mode row that opens a small panel under it. */
function RowMenu({
  label,
  title,
  testId,
  width = 'w-64',
  children,
}: {
  label: ReactNode;
  title: string;
  testId: string;
  width?: string;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return undefined;
    const away = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
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
  return (
    <div ref={box} className="relative flex items-center">
      <button
        type="button"
        className="btn min-h-9 gap-1 px-2 py-1 text-xs"
        title={title}
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid={testId}
        onClick={() => setOpen((o) => !o)}
      >
        {label}
        <span aria-hidden className="text-[0.6rem] text-dim">
          ▾
        </span>
      </button>
      {open && (
        <div
          role="menu"
          className={`absolute left-0 top-full z-30 mt-1 ${width} rounded-lg border border-edge bg-panel shadow-lg`}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

/** Light, visibility, glare and wind, and the modifier they make. */
function EnvironmentMenu({ scene }: { scene: Scene }) {
  const mod = environment(scene.environment)[0] ?? null;
  return (
    <RowMenu
      testId="prep-environment"
      title="Environment — light, visibility, glare, wind"
      label={
        <>
          <span className="mono-label">Env</span>
          <span className={'tabular-nums ' + (mod && mod.value < 0 ? 'text-warn' : 'text-ok')}>
            {mod ? mod.value : '±0'}
          </span>
        </>
      }
    >
      {() => <EnvTab scene={scene} />}
    </RowMenu>
  );
}

/** Whose eyes the GM is looking through — a lens, not a limit. */
function SeeAsMenu({ scene, tokens }: { scene: Scene; tokens: readonly Token[] }) {
  const lens = useGridStore((s) => s.losTokenId);
  const setLens = useGridStore((s) => s.setLosTokenId);
  const level = useGridStore((s) => s.activeLevel);
  const cameras = (scene.geometry.cameras ?? []).filter((c) => (c.level ?? 0) === level);
  const here = tokens.filter((t) => (t.level ?? 0) === level);
  const current =
    here.find((t) => t.id === lens)?.name ??
    cameras.find((c) => cameraLensId(c.id) === lens)?.label ??
    (lens ? 'someone' : null);
  const row = (id: string | null, name: string, close: () => void, note?: string) => (
    <button
      key={id ?? 'nobody'}
      type="button"
      role="menuitemradio"
      aria-checked={lens === id}
      className={
        'flex w-full items-center gap-2 px-3 py-1 text-left text-sm hover:bg-raised ' +
        (lens === id ? 'text-cyan' : 'text-ink')
      }
      onClick={() => {
        setLens(id);
        close();
      }}
    >
      <span className="min-w-0 flex-1 truncate">{name}</span>
      {note && <span className="mono-label text-faint">{note}</span>}
    </button>
  );
  return (
    <RowMenu
      testId="prep-see-as"
      title="See the map as a token or a camera sees it"
      label={
        <>
          <span aria-hidden>👁</span>
          <span className="max-w-28 truncate">{current ?? 'Everything'}</span>
        </>
      }
    >
      {(close) => (
        <div className="max-h-80 overflow-y-auto py-1">
          {row(null, 'Everything — no lens', close)}
          {here.length > 0 && <div className="mono-label px-3 pb-0.5 pt-1.5 text-faint">Tokens</div>}
          {here.map((t) => row(t.id, t.name, close, t.hidden ? 'hidden' : undefined))}
          {cameras.length > 0 && <div className="mono-label px-3 pb-0.5 pt-1.5 text-faint">Cameras</div>}
          {cameras.map((c) => row(cameraLensId(c.id), c.label ?? c.id, close, c.active ? undefined : 'off'))}
        </div>
      )}
    </RowMenu>
  );
}

/** Whether each player sees only what their own runner can. Saved on the scene, so their devices hear it. */
function PlayerSightToggle({ scene }: { scene: Scene }) {
  const patch = usePatchScene();
  const on = scene.vision?.playersSeeOwnSight ?? false;
  return (
    <button
      type="button"
      aria-pressed={on}
      data-testid="prep-player-sight"
      disabled={patch.isPending}
      title={on ? 'Players see only their own sightline — click to show them the whole map' : 'Players see the whole map — click to limit each to their own sightline'}
      onClick={() => patch.mutate({ sceneId: scene.id, patch: { vision: { playersSeeOwnSight: !on } } })}
      className={'btn min-h-9 gap-1 px-2 py-1 text-xs ' + (on ? 'border-cyan text-cyan' : 'text-dim')}
    >
      <span className="mono-label">Players</span>
      <span>{on ? 'own sight' : 'whole map'}</span>
    </button>
  );
}

export default function PrepControls({ scene, tokens }: { scene: Scene; tokens: readonly Token[] }) {
  return (
    <div className="flex items-center gap-1.5" role="group" aria-label="Scene settings">
      <EnvironmentMenu scene={scene} />
      <SeeAsMenu scene={scene} tokens={tokens} />
      <PlayerSightToggle scene={scene} />
    </div>
  );
}
