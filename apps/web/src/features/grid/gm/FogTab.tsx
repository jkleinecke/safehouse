/**
 * The scene's fog switch, named fog regions + staged reveals (FR9.13/9.14).
 * Fog is authoritative on the server: these buttons send `fog.reveal` and the
 * canvas redraws when `fog.updated` comes back, never optimistically.
 *
 * The switch comes first because it is the question the rest depends on. A
 * region is a REVEAL WINDOW — ground the GM can open to the table — not a
 * fogged area, and fog used to go on by itself the moment the first one was
 * drawn. A GM who wanted the table fogged had to know to draw a window
 * first; one who wanted to lay the windows out on a scene already live had
 * no way to do it without the table's map going black under them. So the
 * fog is a switch of its own, and the regions are what it lets through.
 *
 * Under the regions, the GM's other two fog tools (P6): the party's memory
 * of the map, to forget for one floor or every floor, and the square-by-square
 * brush (FR9.13), which reveals squares live, reveals them as seen before, or
 * fogs them again, on the floor being built.
 */
import { useState } from 'react';
import { fogOn, sceneFogOn, sightlinesOn, type Scene } from '@safehouse/contracts';
import { brushOnFloor, regionFashion, type BrushMark, type RegionFashion } from '@safehouse/rules';
import { usePatchScene } from '../api.js';
import type { GridCommands } from '../commands.js';
import { rectPolygon } from '../geometry.js';
import { useGridStore } from '../store.js';
import { Empty, inputCls, newId, PanelSection } from './ui.js';

/** What the switch means for the table, in the words the GM reads beside it. */
const FOG_OFF_MEANS = 'Off: players and the TV see the whole map';
const FOG_ON_MEANS = 'On: they see only revealed areas';

/**
 * What the fog switch cannot say by itself: the scene's SIGHTLINES fog it
 * whatever the switch says (`sceneFogOn`, P6). Shown beside the switch while
 * it is off and the sightlines are on, so a GM reading "Fog: off" is not
 * surprised by a table that sees only what the runners see.
 */
const FOGGED_BY_SIGHT = 'Sightlines are on: the table sees only what the runners see and have seen, whatever this switch says';

/**
 * Whether the scene is fogged by its sightlines alone: the fog switch off
 * (`fogOn` of the GM's copy) while the scene is fogged all the same
 * (`sceneFogOn`), which only sightlines do.
 */
export function foggedBySight(scene: Scene): boolean {
  return !fogOn(scene.fog) && sceneFogOn(scene);
}

/**
 * The scene's fog, on or off (`FogState.enabled`), with what each means for
 * the table.
 *
 * What it shows is `fogOn` of the GM's own copy: the switch when the GM has
 * ever flipped it, and otherwise the rule every scene had before the switch
 * existed (on once a region exists). So an old scene with regions reads On,
 * as it behaves, and one with none reads Off. Turning it off keeps every
 * region and reveal; turning it on again picks up where it was left.
 *
 * The switch is not the only thing that fogs a scene: its sightlines do too
 * (P6). While they do and the switch is off, the section says so (its hint
 * reads "sightlines", and a line under the switch explains), rather than
 * reading as an open scene.
 */
export function FogSwitch({ scene, commands }: { scene: Scene; commands: GridCommands }) {
  const on = fogOn(scene.fog);
  const bySight = foggedBySight(scene);
  const option = (value: boolean, label: string) => (
    <button
      type="button"
      aria-pressed={on === value}
      data-testid={value ? 'fog-switch-on' : 'fog-switch-off'}
      onClick={() => {
        if (on === value) return;
        if (value) commands.fogEnable(scene.id);
        else commands.fogDisable(scene.id);
      }}
      className={
        'mono-label flex-1 rounded border px-2 py-1 ' +
        (on === value ? 'border-cyan text-cyan' : 'border-edge text-dim hover:text-ink')
      }
    >
      {label}
    </button>
  );
  return (
    <PanelSection title="Fog" hint={on ? 'on' : bySight ? 'sightlines' : 'off'}>
      <div className="flex gap-1" role="group" aria-label="Fog">
        {option(false, 'Off')}
        {option(true, 'On')}
      </div>
      <p className={'text-xs ' + (on || bySight ? 'text-faint' : 'text-ink')}>{FOG_OFF_MEANS}</p>
      <p className={'text-xs ' + (on ? 'text-ink' : 'text-faint')}>{FOG_ON_MEANS}</p>
      {bySight && (
        <p className="text-xs text-cyan" data-testid="fog-by-sightlines">
          {FOGGED_BY_SIGHT}.
        </p>
      )}
    </PanelSection>
  );
}

/**
 * The switch's two meanings as one line, for a tooltip that has room for no
 * more, and the scene's sightlines when they fog it with the switch off
 * (`bySight`, `foggedBySight`).
 */
export function fogSwitchTitle(on: boolean, bySight = false): string {
  const sight = bySight ? ` ${FOGGED_BY_SIGHT}.` : '';
  return `Fog is ${on ? 'on' : 'off'} — ${FOG_OFF_MEANS}; ${FOG_ON_MEANS}.${sight} Click to turn it ${on ? 'off' : 'on'}.`;
}

/** What the sightlines switch means for the table, in the words the GM reads beside it. */
const SIGHT_OFF_MEANS = 'Off: the fog switch and your reveals decide what the table sees';
const SIGHT_ON_MEANS =
  'On: the table sees what the runners see, live, and the rooms they have seen dimmed, with nobody in them; walls, closed doors and darkness stop their eyes';

/** The sightlines switch's two meanings as one line, for a tooltip. */
export function sightlinesTitle(on: boolean): string {
  return `Sightlines are ${on ? 'on' : 'off'} — ${SIGHT_OFF_MEANS}; ${SIGHT_ON_MEANS}. Click to turn them ${on ? 'off' : 'on'}.`;
}

/**
 * Switch the scene's sightlines (`SceneVision.sight`), saved on the scene so
 * the server's sight pass and every device hear it. The patch says `sight`
 * and nothing else: the server merges it into the scene's vision, so the
 * players' dimming switch beside it is left as it is.
 */
export function useSetSightlines(scene: Scene): {
  on: boolean;
  set: (on: boolean) => void;
  pending: boolean;
  failed: boolean;
} {
  const patch = usePatchScene();
  return {
    on: sightlinesOn(scene.vision),
    set: (on: boolean) => patch.mutate({ sceneId: scene.id, patch: { vision: { sight: on ? 'on' : 'off' } } }),
    pending: patch.isPending,
    failed: patch.isError,
  };
}

/**
 * The scene's SIGHTLINES (P6; the GM, 2026-09-27), on or off, with what each
 * means for the table, beside the fog switch. On, the table sees what the
 * party's runners see, pooled: every phone and the TV the same, walls and
 * closed doors and SR5 darkness stopping their eyes, everything seen
 * remembered, dimmed, and everything else hidden, whatever the fog switch
 * says. The server works it out; nothing is computed on a phone.
 *
 * Under it, while the party remembers anything, the GM's way to take it
 * back: forget the floor in view (`level`), or every floor. What the runners
 * see right now is remembered again at once, so forgetting takes away the
 * rooms they have left, never the one they stand in.
 */
export function SightlinesSwitch({ scene, commands, level }: { scene: Scene; commands: GridCommands; level: number }) {
  const sight = useSetSightlines(scene);
  const on = sight.on;
  const option = (value: boolean, label: string) => (
    <button
      type="button"
      aria-pressed={on === value}
      data-testid={value ? 'sightlines-switch-on' : 'sightlines-switch-off'}
      disabled={sight.pending}
      onClick={() => {
        if (on !== value) sight.set(value);
      }}
      className={
        'mono-label flex-1 rounded border px-2 py-1 ' +
        (on === value ? 'border-cyan text-cyan' : 'border-edge text-dim hover:text-ink')
      }
    >
      {label}
    </button>
  );
  return (
    <PanelSection title="Sightlines" hint={on ? 'on' : 'off'}>
      <div className="flex gap-1" role="group" aria-label="Sightlines">
        {option(false, 'Off')}
        {option(true, 'On')}
      </div>
      <p className={'text-xs ' + (on ? 'text-faint' : 'text-ink')}>{SIGHT_OFF_MEANS}</p>
      <p className={'text-xs ' + (on ? 'text-ink' : 'text-faint')}>{SIGHT_ON_MEANS}</p>
      {sight.failed && <p className="mono-label text-danger">that did not save — try again</p>}
      <ForgetExplored scene={scene} commands={commands} level={level} testIdPrefix="sightlines" />
    </PanelSection>
  );
}

/**
 * Whether the party remembers anything of the map (`FogSight` explored), on
 * floor `level` or, with none named, on any floor.
 */
export function partyRemembers(scene: Scene, level?: number): boolean {
  return Object.entries(scene.fog.sight?.levels ?? {}).some(
    ([key, floor]) => (level === undefined || key === String(level)) && floor.explored !== '',
  );
}

/**
 * "Forget explored" (P6): the GM's way to take back what the party has seen,
 * for the floor in view (`level`) or every floor. Shown only while the party
 * remembers something; kept whether or not the sightlines are on, since the
 * memory is. What the runners see right now is remembered again at once
 * (sightlines unmask automatically), so forgetting takes away the rooms they
 * have left, never the one they stand in.
 *
 * In the Sightlines section (the LOS tab) and in the Fog panel, the same two
 * buttons; `testIdPrefix` tells them apart.
 */
export function ForgetExplored({
  scene,
  commands,
  level,
  testIdPrefix,
}: {
  scene: Scene;
  commands: GridCommands;
  level: number;
  testIdPrefix: string;
}) {
  if (!partyRemembers(scene)) return null;
  return (
    <div className="flex gap-1" role="group" aria-label="Forget what the party has seen">
      <button
        type="button"
        className="btn flex-1 px-2 py-0.5 text-xs"
        data-testid={`${testIdPrefix}-forget-floor`}
        disabled={!partyRemembers(scene, level)}
        title="The rooms the party has seen on this floor go back under the fog; what the runners see now stays"
        onClick={() => commands.fogForget(scene.id, level)}
      >
        Forget this floor
      </button>
      <button
        type="button"
        className="btn flex-1 px-2 py-0.5 text-xs"
        data-testid={`${testIdPrefix}-forget-all`}
        title="Every floor the party has seen goes back under the fog; what the runners see now stays"
        onClick={() => commands.fogForget(scene.id)}
      >
        Forget every floor
      </button>
    </div>
  );
}

/**
 * What the fog brush paints (FR9.13's square-by-square brush, P6), in the
 * GM's words, with what each means for the table: the three marks
 * (`FogBrushLevelSchema`). The Prep menu and the Fog panel offer the same
 * three.
 */
export const FOG_BRUSH_PAINTS: ReadonlyArray<{ paint: BrushMark; label: string; hint: string }> = [
  { paint: 'live', label: 'Reveal live', hint: 'the map and everyone on it' },
  { paint: 'explored', label: 'Reveal as seen before', hint: 'dimmed, nobody on it' },
  { paint: 'hidden', label: 'Fog again', hint: 'hidden, even in an open room' },
];

/** The brush's name as its button says it: what a drag will do. */
export function fogBrushTitle(paint: BrushMark): string {
  const label = (FOG_BRUSH_PAINTS.find((p) => p.paint === paint) ?? FOG_BRUSH_PAINTS[0]!).label;
  return `Fog brush: ${label.toLowerCase()}`;
}

/**
 * The fog brush in the Fog panel: pick what it paints, and it is in hand
 * (the Prep tool `fogbrush`); pick the same again to put it down. The strokes
 * are the map's to make (a drag over squares of the floor being built), and
 * each is one step on the undo history.
 */
function FogBrushSection({ scene, level }: { scene: Scene; level: number }) {
  const tool = useGridStore((s) => s.tool);
  const setTool = useGridStore((s) => s.setTool);
  const fogBrush = useGridStore((s) => s.fogBrush);
  const setFogBrush = useGridStore((s) => s.setFogBrush);
  const holding = tool === 'fogbrush';
  return (
    <PanelSection title="Fog brush" hint={holding ? FOG_BRUSH_PAINTS.find((p) => p.paint === fogBrush)?.label.toLowerCase() : undefined}>
      <div className="flex flex-wrap gap-1" role="group" aria-label="What the fog brush paints">
        {FOG_BRUSH_PAINTS.map(({ paint, label, hint }) => {
          const on = holding && fogBrush === paint;
          return (
            <button
              key={paint}
              type="button"
              aria-pressed={on}
              title={`${label}: ${hint}`}
              data-testid={`fog-brush-${paint}`}
              onClick={() => {
                setFogBrush(paint);
                setTool(on ? 'select' : 'fogbrush');
              }}
              className={'btn px-2 py-0.5 text-xs ' + (on ? 'border-cyan text-cyan' : 'text-dim hover:text-ink')}
            >
              {label}
            </button>
          );
        })}
      </div>
      <Empty>
        drag over squares of this floor; a painted square wins over the regions under it, never over what a runner
        sees now, and Ctrl+Z takes a stroke back
        {brushOnFloor(scene.fog.brush, level) ? ' — this floor has painted squares' : ''}
      </Empty>
    </PanelSection>
  );
}

/**
 * Where a named region stands with the table (P6): revealed LIVE (the table
 * sees it, and everyone in it), revealed as EXPLORED (seen before: shown
 * dimmed, as remembered, with nobody in it), or HIDDEN. The rule itself is
 * the rules package's (`regionFashion`), shared with the server's Fixer and
 * the scenes manager; it is re-exported here for the panels that list
 * regions.
 */
export { regionFashion };
export type { RegionFashion };

/** The text colour a region's name takes in each fashion: the map's outline colours (green live, amber seen before). */
export const FASHION_TONE: Record<RegionFashion, string> = {
  live: 'text-ok',
  explored: 'text-warn',
  hidden: 'text-ink',
};

/** A region's fashion as the GM reads it in a list. */
export const FASHION_WORD: Record<RegionFashion, string> = {
  live: 'live',
  explored: 'seen before',
  hidden: 'hidden',
};

/**
 * The GM's three choices for one region, side by side (P6; the GM,
 * 2026-09-27): Reveal live, Reveal as seen-before, Hide. The one the region
 * is already in is shown pressed and does nothing; each of the others moves
 * it there, so a room the party has left can be dropped from live to seen
 * before with one tap, and its guards leave the table's screens as it goes.
 * Nothing is optimistic: the buttons ask, and the map redraws when
 * `fog.updated` comes back.
 *
 * `compact` is for a list row (Prep's outline), where there is room for a
 * word each; the full wording is then each button's title and label.
 */
export function RegionRevealButtons({
  scene,
  regionId,
  commands,
  announce,
  compact = false,
}: {
  scene: Scene;
  regionId: string;
  commands: GridCommands;
  announce: boolean;
  compact?: boolean;
}) {
  const now = regionFashion(scene.fog, regionId);
  const choice = (to: RegionFashion, label: string, short: string, title: string, run: () => void) => (
    <button
      type="button"
      aria-pressed={now === to}
      aria-label={label}
      title={title}
      data-testid={`fog-${to}-${regionId}`}
      onClick={() => {
        if (now !== to) run();
      }}
      className={
        'btn px-2 py-0.5 text-xs ' +
        (now === to ? (to === 'hidden' ? 'border-cyan text-cyan' : `border-current ${FASHION_TONE[to]}`) : 'text-dim hover:text-ink')
      }
    >
      {compact ? short : label}
    </button>
  );
  return (
    <span className={'flex shrink-0 gap-1' + (compact ? '' : ' flex-wrap')} role="group" aria-label="Reveal">
      {choice('live', 'Reveal live', 'live', 'Players and the TV see it, and everyone in it', () =>
        commands.fogReveal(scene.id, regionId, announce, 'live'),
      )}
      {choice('explored', 'Reveal as seen-before', 'seen', 'Players and the TV see it dimmed, as remembered, with nobody in it', () =>
        commands.fogReveal(scene.id, regionId, announce, 'explored'),
      )}
      {choice('hidden', 'Hide', 'hide', 'Fog it again: the table sees nothing of it', () => commands.fogHide(scene.id, regionId))}
    </span>
  );
}

export default function FogTab({ scene, commands }: { scene: Scene; commands: GridCommands }) {
  const level = useGridStore((s) => s.activeLevel);
  const tool = useGridStore((s) => s.tool);
  const setTool = useGridStore((s) => s.setTool);
  const fogDraft = useGridStore((s) => s.fogDraft);
  const clearFogDraft = useGridStore((s) => s.clearFogDraft);
  const [name, setName] = useState('');
  const [announce, setAnnounce] = useState(true);

  const points = fogDraft?.points ?? [];

  const save = (polygon: { x: number; y: number }[]) => {
    commands.fogDefine(scene.id, {
      id: newId('fog'),
      name: name.trim() || `Region ${scene.fog.regions.length + 1}`,
      polygon,
    });
    setName('');
    clearFogDraft();
  };

  const first = points[0];
  const second = points[1];
  const canRect = points.length === 2 && first !== undefined && second !== undefined;

  return (
    <>
      <FogSwitch scene={scene} commands={commands} />
      <PanelSection title="Regions" hint={`${scene.fog.regions.length}`}>
        {scene.fog.regions.length === 0 && (
          <Empty>
            {sceneFogOn(scene)
              ? 'no regions yet — with the fog on and nothing revealed, the table sees no map at all'
              : 'no regions yet — a region is an area you can reveal to the table once the fog is on'}
          </Empty>
        )}
        <ul className="space-y-2">
          {scene.fog.regions.map((r) => {
            const fashion = regionFashion(scene.fog, r.id);
            return (
              <li key={r.id} className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className={'min-w-0 flex-1 truncate text-xs ' + FASHION_TONE[fashion]}>{r.name}</span>
                  <span className={'mono-label ' + FASHION_TONE[fashion]}>{FASHION_WORD[fashion]}</span>
                </div>
                <RegionRevealButtons scene={scene} regionId={r.id} commands={commands} announce={announce} />
              </li>
            );
          })}
        </ul>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={announce}
            onChange={(e) => setAnnounce(e.target.checked)}
          />
          <span className="mono-label">announce reveals in the log</span>
        </label>
      </PanelSection>

      <FogBrushSection scene={scene} level={level} />

      {partyRemembers(scene) && (
        <PanelSection title="Seen before" hint="the party's memory">
          <Empty>
            what the runners have seen stays on the table, dimmed, with nobody in it; forget it and it goes back under
            the fog
          </Empty>
          <ForgetExplored scene={scene} commands={commands} level={level} testIdPrefix="fog" />
        </PanelSection>
      )}

      <PanelSection title="Define region" hint={`${points.length} pts`}>
        <button
          type="button"
          className={'btn w-full py-1 ' + (tool === 'fogdef' ? 'border-cyan text-cyan' : '')}
          onClick={() => setTool(tool === 'fogdef' ? 'select' : 'fogdef')}
        >
          {tool === 'fogdef' ? 'stop clicking vertices' : 'click vertices on the map'}
        </button>
        <input
          className={inputCls}
          placeholder="east wing, the lab…"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <div className="flex gap-2">
          <button
            type="button"
            className="btn flex-1 py-1"
            disabled={points.length < 3}
            onClick={() => save(points)}
            title="Save the clicked vertices as a polygon"
          >
            save polygon
          </button>
          <button
            type="button"
            className="btn flex-1 py-1"
            disabled={!canRect}
            onClick={() => {
              if (first && second) save(rectPolygon(first, second));
            }}
            title="Two clicks = opposite corners of a rectangle"
          >
            save rect
          </button>
          <button type="button" className="btn py-1" disabled={points.length === 0} onClick={clearFogDraft}>
            clear
          </button>
        </div>
        <Empty>
          two clicks make a rectangle, three or more a polygon; while the fog is on, players see
          what is not revealed as solid and you see a 40% tint, and what is revealed as seen
          before they see dimmed with nobody in it and you see a lighter tint in an amber outline;
          you see the region outlines either way
        </Empty>
      </PanelSection>
    </>
  );
}
