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
 */
import { useState } from 'react';
import { fogOn, type Scene } from '@safehouse/contracts';
import type { GridCommands } from '../commands.js';
import { rectPolygon } from '../geometry.js';
import { useGridStore } from '../store.js';
import { Empty, inputCls, newId, PanelSection } from './ui.js';

/** What the switch means for the table, in the words the GM reads beside it. */
const FOG_OFF_MEANS = 'Off: players and the TV see the whole map';
const FOG_ON_MEANS = 'On: they see only revealed areas';

/**
 * The scene's fog, on or off (`FogState.enabled`), with what each means for
 * the table.
 *
 * What it shows is `fogOn` of the GM's own copy: the switch when the GM has
 * ever flipped it, and otherwise the rule every scene had before the switch
 * existed (on once a region exists). So an old scene with regions reads On,
 * as it behaves, and one with none reads Off. Turning it off keeps every
 * region and reveal; turning it on again picks up where it was left.
 */
export function FogSwitch({ scene, commands }: { scene: Scene; commands: GridCommands }) {
  const on = fogOn(scene.fog);
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
    <PanelSection title="Fog" hint={on ? 'on' : 'off'}>
      <div className="flex gap-1" role="group" aria-label="Fog">
        {option(false, 'Off')}
        {option(true, 'On')}
      </div>
      <p className={'text-xs ' + (on ? 'text-faint' : 'text-ink')}>{FOG_OFF_MEANS}</p>
      <p className={'text-xs ' + (on ? 'text-ink' : 'text-faint')}>{FOG_ON_MEANS}</p>
    </PanelSection>
  );
}

/** The switch's two meanings as one line, for a tooltip that has room for no more. */
export function fogSwitchTitle(on: boolean): string {
  return `Fog is ${on ? 'on' : 'off'} — ${FOG_OFF_MEANS}; ${FOG_ON_MEANS}. Click to turn it ${on ? 'off' : 'on'}.`;
}

/**
 * Where a named region stands with the table (P6): revealed LIVE (the table
 * sees it, and everyone in it), revealed as EXPLORED (seen before: shown
 * dimmed, as remembered, with nobody in it), or HIDDEN. Read off the GM's
 * copy, where a region is in one reveal list or neither; should both ever
 * name it, live wins, as it does on the server.
 */
export type RegionFashion = 'live' | 'explored' | 'hidden';

export function regionFashion(fog: Scene['fog'], regionId: string): RegionFashion {
  if (fog.revealed.includes(regionId)) return 'live';
  if ((fog.exploredRegionIds ?? []).includes(regionId)) return 'explored';
  return 'hidden';
}

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
            {fogOn(scene.fog)
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
