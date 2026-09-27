/**
 * Prep's map-wide settings, on the mode row (docs/UX_MAP_BUILDER.md §3.1).
 *
 * The things a GM sets for the whole scene rather than for a square: the
 * environment (light, visibility, glare, wind — the modifier they compose to),
 * whose eyes the GM is looking through, whether the scene's fog is on,
 * whether its sightlines are, and whether each player's map is dimmed
 * outside their own runner's sightline — and one lens of the GM's own, the
 * light map. They were panel tabs — Env, Fog and LOS — each a page for one or
 * two controls; up here they are one click away from any tool, and the panel
 * is left for the thing that is picked.
 *
 * The fog and the dimming sit side by side and are worded apart on purpose.
 * Only the fog HIDES: while it is on, the players and the TV see nothing but
 * the revealed areas. The dimming only darkens — the map under it stays
 * readable — and a GM who flipped it expecting it to hide the map watched the
 * table go on seeing everything. The sightlines sit between them, because
 * they hide too (P6): with them on, the table sees what the party's runners
 * see and have seen, whatever the fog switch says, and the fog switch says so.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { fogOn, type Scene, type Token } from '@safehouse/contracts';
import { environment } from '@safehouse/rules';
import { usePatchScene } from '../api.js';
import type { GridCommands } from '../commands.js';
import EnvTab from '../gm/EnvTab.js';
import { foggedBySight, fogSwitchTitle, sightlinesTitle, useSetSightlines } from '../gm/FogTab.js';
import { useGridStore } from '../store.js';
import { cameraLensId, PARTY_LENS } from '../useShroud.js';

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

/**
 * Whose eyes the GM is looking through — a lens, not a limit. The party's
 * (P6) is the table's own view: the squares every phone and the TV see live
 * on this floor, and only the tokens they are shown (`useShroud`
 * `PARTY_LENS`).
 */
function SeeAsMenu({ scene, tokens }: { scene: Scene; tokens: readonly Token[] }) {
  const lens = useGridStore((s) => s.losTokenId);
  const setLens = useGridStore((s) => s.setLosTokenId);
  const level = useGridStore((s) => s.activeLevel);
  const cameras = (scene.geometry.cameras ?? []).filter((c) => (c.level ?? 0) === level);
  const here = tokens.filter((t) => (t.level ?? 0) === level);
  const current =
    (lens === PARTY_LENS ? 'The party' : undefined) ??
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
          {row(PARTY_LENS, 'The party — what the table sees', close)}
          {here.length > 0 && <div className="mono-label px-3 pb-0.5 pt-1.5 text-faint">Tokens</div>}
          {here.map((t) => row(t.id, t.name, close, t.hidden ? 'hidden' : undefined))}
          {cameras.length > 0 && <div className="mono-label px-3 pb-0.5 pt-1.5 text-faint">Cameras</div>}
          {cameras.map((c) => row(cameraLensId(c.id), c.label ?? c.id, close, c.active ? undefined : 'off'))}
        </div>
      )}
    </RowMenu>
  );
}

/**
 * The scene's fog switch (`FogState.enabled`): on, the players and the TV see
 * only the revealed areas; off, they see the whole map, and every region and
 * reveal is kept for when it goes on again. What it shows is `fogOn` of the
 * GM's copy, so a scene whose switch was never flipped reads as it behaves.
 * The Fog tab has the same switch with its two meanings spelt out
 * (`FogSwitch`); here they are the tooltip.
 *
 * With the switch off and the scene's sightlines on, the scene is fogged all
 * the same (`sceneFogOn`), and the button says so: "off · sightlines", in the
 * fog's colour, with the reason in its tooltip. The switch itself still
 * reads off, because it is.
 */
function FogToggle({ scene, commands }: { scene: Scene; commands: GridCommands }) {
  const on = fogOn(scene.fog);
  const bySight = foggedBySight(scene);
  return (
    <button
      type="button"
      aria-pressed={on}
      data-testid="prep-fog"
      data-fogged-by={bySight ? 'sightlines' : undefined}
      title={fogSwitchTitle(on, bySight)}
      onClick={() => (on ? commands.fogDisable(scene.id) : commands.fogEnable(scene.id))}
      className={'btn min-h-9 gap-1 px-2 py-1 text-xs ' + (on ? 'border-cyan text-cyan' : bySight ? 'text-cyan' : 'text-dim')}
    >
      <span className="mono-label">Fog</span>
      <span>{on ? 'on' : bySight ? 'off · sightlines' : 'off'}</span>
    </button>
  );
}

/**
 * The scene's sightlines (`SceneVision.sight`, P6), next to the fog switch:
 * on, the table sees what the party's runners see, pooled, and remembers
 * what they have seen, whatever the fog switch says. Saved on the scene, so
 * the server's sight pass and every device hear it. The LOS tab has the same
 * switch with its meanings spelt out and the way to forget
 * (`SightlinesSwitch`); here they are the tooltip.
 */
function SightlinesToggle({ scene }: { scene: Scene }) {
  const sight = useSetSightlines(scene);
  const on = sight.on;
  return (
    <button
      type="button"
      aria-pressed={on}
      data-testid="prep-sightlines"
      disabled={sight.pending}
      title={sightlinesTitle(on)}
      onClick={() => sight.set(!on)}
      className={'btn min-h-9 gap-1 px-2 py-1 text-xs ' + (on ? 'border-cyan text-cyan' : 'text-dim')}
    >
      <span className="mono-label">Sightlines</span>
      <span>{on ? 'on' : 'off'}</span>
    </button>
  );
}

/**
 * Whether each player's map is dimmed outside what their own runner can see.
 * Saved on the scene, so their devices hear it.
 *
 * It DARKENS; it does not hide. The scrim it lays is a partial one, the map
 * under it stays readable, and a player whose runner has no token on the
 * scene gets no scrim at all. It used to read "Players: own sight", and a GM
 * who turned it on to keep a map from the table saw the table go on reading
 * the whole map. Hiding is the fog's job, and the tooltip says so.
 */
function PlayerSightToggle({ scene }: { scene: Scene }) {
  const patch = usePatchScene();
  const on = scene.vision?.playersSeeOwnSight ?? false;
  return (
    <button
      type="button"
      aria-pressed={on}
      data-testid="prep-player-sight"
      disabled={patch.isPending}
      title={
        on
          ? "Each player's map is dimmed outside their own runner's sightline — darkens only; use Fog to hide. Click to stop dimming."
          : "Dim each player's map outside their own runner's sightline — darkens only; use Fog to hide."
      }
      onClick={() => patch.mutate({ sceneId: scene.id, patch: { vision: { playersSeeOwnSight: !on } } })}
      className={'btn min-h-9 gap-1 px-2 py-1 text-xs ' + (on ? 'border-cyan text-cyan' : 'text-dim')}
    >
      <span className="mono-label">Dim outside own sight</span>
      <span>{on ? 'on' : 'off'}</span>
    </button>
  );
}

/**
 * The GM's light map (docs/VISION.md §4.1): the floor washed darker where it
 * is darker, so the shadows a runner could use are plain before the fight.
 * On this screen only, not saved — a lens, like "See as".
 */
function LightMapToggle() {
  const on = useGridStore((s) => s.showLightMap);
  const setOn = useGridStore((s) => s.setShowLightMap);
  return (
    <button
      type="button"
      aria-pressed={on}
      data-testid="prep-light-map"
      title={on ? 'Hide the light map' : 'Light map — shade each square by how lit it is (only you see it)'}
      onClick={() => setOn(!on)}
      className={'btn min-h-9 gap-1 px-2 py-1 text-xs ' + (on ? 'border-cyan text-cyan' : 'text-dim')}
    >
      <span aria-hidden>✹</span>
      <span className="mono-label">Light map</span>
    </button>
  );
}

export default function PrepControls({
  scene,
  tokens,
  commands,
}: {
  scene: Scene;
  tokens: readonly Token[];
  commands: GridCommands;
}) {
  return (
    <div className="flex items-center gap-1.5" role="group" aria-label="Scene settings">
      <EnvironmentMenu scene={scene} />
      <SeeAsMenu scene={scene} tokens={tokens} />
      <FogToggle scene={scene} commands={commands} />
      <SightlinesToggle scene={scene} />
      <PlayerSightToggle scene={scene} />
      <LightMapToggle />
    </div>
  );
}
