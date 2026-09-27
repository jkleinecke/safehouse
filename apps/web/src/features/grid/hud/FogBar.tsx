/**
 * The GM's fog bar (the GM, 2026-09-27): every fog control in one row, in
 * Prep and in Play, under the tools.
 *
 *   Fog  Party sight  |  Brush  [what it paints]  Size  |  Fog everything  See as players
 *
 * The GM asked for it in so many words: "press a button and shroud the entire
 * map in a fog, then reveal parts myself with a resizable brush or let the
 * players do it with their sightlines, and at any time see what the players
 * can see". The fog used to be a switch on Prep's mode row, the sightlines a
 * second one beside it and again in the LOS tab, the brush a split menu on
 * Prep's toolbar with a Fog panel nobody could reach, forgetting two buttons
 * in the LOS tab, and seeing as the party one line in two different
 * dropdowns. Nobody could tell which of them to press first. Now there is one
 * place per control, in the order a GM uses them:
 *
 * - **Fog** is the master switch: on, the players and the TV see only what
 *   is revealed, and nothing at all until something is. Off, they see the
 *   whole map, whatever else is set: the party's sightlines fog a scene too
 *   (`sceneFogOn`), so turning the fog off turns them off with it, and
 *   turning them on turns the fog on. "Fog: off" never means a table that
 *   sees only what the runners see.
 * - **Party sight** is the scene's sightlines (`SceneVision.sight`): the
 *   table sees what the runners see, live, and the rooms they have seen,
 *   dimmed. The server works it out after every move.
 * - **Brush**, its paint and its size: the round brush (`fogBar.ts`), picked
 *   up and put down here, painting revealed, revealed as seen before, or fog
 *   again, 1 to 10 squares across; `[` and `]` size it while it is in hand,
 *   and a ring on the map shows it under the pointer.
 * - **Fog everything** starts over, as one op on the server (`refog`): the
 *   fog on, every reveal hidden, the brush cleared and the party's memory
 *   forgotten, so the map is dark again but for what the runners see now.
 *   It takes two presses (`ConfirmButton`), since nothing puts it back.
 * - **See as players** is the party lens (`PARTY_LENS`): the map exactly as
 *   the phones and the TV show it: their opaque fog, their dimmed ground
 *   seen before, their tokens (`stage3d/masks.ts` `drawsTableView`). While
 *   it is on the button reads "Back to GM view", as the mockup had it, and
 *   the map says so too, with its own button to go back (`GridPage`).
 *
 * The named reveal areas the old toolbar drew are not here: they are kept,
 * listed and revealed from Prep's list (`PrepOutline`), where the Fixer's
 * suggestions put them too.
 *
 * Under the buttons, or beside them where there is room, one sentence says
 * what the table sees now (`fogBarHint`). The row wraps: on a narrow window
 * each group moves down whole rather than the bar scrolling sideways.
 */
import { fogOn, sightlinesOn, type Scene } from '@safehouse/contracts';
import type { BrushMark } from '@safehouse/rules';
import { usePatchScene } from '../api.js';
import type { GridCommands } from '../commands.js';
import { FOG_BRUSH_MAX, FOG_BRUSH_MIN, FOG_BRUSH_MODES, fogBarHint, seeAsPlayersLabel } from '../fogBar.js';
import ConfirmButton from '../gm/ConfirmButton.js';
import { useGridStore } from '../store.js';
import { PARTY_LENS } from '../useShroud.js';
import { toolTitle } from './Toolbar.js';

/**
 * Switch the scene's sightlines (`SceneVision.sight`), saved on the scene so
 * the server's sight pass and every device hear it. The patch says `sight`
 * and nothing else: the server merges it into the scene's vision, so the
 * players' dimming switch (Prep's mode row, the LOS tab) is left as it is.
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
 * A switch on the bar: its name, and on or off after it; or, with
 * `showState` false, a name that says itself what a press does.
 */
function Toggle({
  on,
  label,
  title,
  testId,
  disabled,
  onClick,
  icon,
  showState = true,
}: {
  on: boolean;
  label: string;
  title: string;
  testId: string;
  disabled?: boolean;
  onClick: () => void;
  icon?: string;
  showState?: boolean;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      data-testid={testId}
      disabled={disabled}
      title={title}
      onClick={onClick}
      className={
        'btn min-h-9 shrink-0 gap-1.5 px-2 py-1 text-xs disabled:opacity-50 ' +
        (on ? 'border-cyan text-cyan shadow-glow-cyan' : 'text-dim hover:text-ink')
      }
    >
      {icon && <span aria-hidden>{icon}</span>}
      <span className="mono-label text-inherit">{label}</span>
      {showState && <span>{on ? 'on' : 'off'}</span>}
    </button>
  );
}

/** The gap between two groups: a line where the row is wide, nothing where it has wrapped. */
function Divider() {
  return <span className="mx-1 hidden h-6 w-px shrink-0 bg-edge sm:block" aria-hidden />;
}

export default function FogBar({ scene, commands }: { scene: Scene; commands: GridCommands }) {
  const tool = useGridStore((s) => s.tool);
  const setTool = useGridStore((s) => s.setTool);
  const paint = useGridStore((s) => s.fogBrush);
  const setPaint = useGridStore((s) => s.setFogBrush);
  const size = useGridStore((s) => s.fogBrushSize);
  const setSize = useGridStore((s) => s.setFogBrushSize);
  const lens = useGridStore((s) => s.losTokenId);
  const setLens = useGridStore((s) => s.setLosTokenId);
  const sight = useSetSightlines(scene);

  const switchOn = fogOn(scene.fog);
  // Fogged for the table: the switch, or the party's sight, which fogs a
  // scene whatever the switch says (`sceneFogOn`, read off the GM's copy).
  const fogged = switchOn || sight.on;
  const holding = tool === 'fogbrush';
  const asPlayers = lens === PARTY_LENS;

  const setFog = (on: boolean) => {
    if (on) {
      commands.fogEnable(scene.id);
      return;
    }
    // Off means the table sees the whole map, so the party's sight, which
    // would keep it fogged, goes off with the switch.
    if (switchOn) commands.fogDisable(scene.id);
    if (sight.on) sight.set(false);
  };
  const setSight = (on: boolean) => {
    sight.set(on);
    // The party's sight is a way through the fog, so it needs the fog: on,
    // it turns the fog on, and turning it off again leaves the fog as it is
    // rather than opening the whole map.
    if (on && !switchOn) commands.fogEnable(scene.id);
  };
  const pick = (next: BrushMark) => {
    setPaint(next);
    // Choosing what to paint is choosing to paint: the brush comes to hand.
    setTool('fogbrush');
  };

  return (
    <div
      role="toolbar"
      aria-label="Fog"
      data-testid="fog-bar"
      className="flex w-full min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1.5 border-b border-edge bg-panel px-3 py-1.5"
    >
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="What the table sees">
        <Toggle
          on={fogged}
          label="Fog"
          testId="fog-bar-fog"
          title={
            fogged
              ? 'The players and the TV see only what is revealed. Press to show them the whole map.'
              : 'The players and the TV see the whole map. Press to hide it all under the fog.'
          }
          onClick={() => setFog(!fogged)}
        />
        <Toggle
          on={sight.on}
          label="Party sight"
          testId="fog-bar-sight"
          disabled={sight.pending}
          title={
            sight.on
              ? 'The table sees what the runners see, and the rooms they have seen, dimmed. Press to stop.'
              : 'Let the runners reveal the map: the table sees what they see, and remembers what they have seen.'
          }
          onClick={() => setSight(!sight.on)}
        />
      </div>

      <Divider />

      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Fog brush">
        <button
          type="button"
          aria-pressed={holding}
          data-testid="fog-bar-brush"
          title={holding ? `${toolTitle('fogbrush')}: press to put it down` : `${toolTitle('fogbrush')}: drag on the map to paint the fog`}
          onClick={() => setTool(holding ? 'select' : 'fogbrush')}
          className={
            'btn min-h-9 shrink-0 gap-1.5 px-2 py-1 text-xs ' +
            (holding ? 'border-cyan text-cyan shadow-glow-cyan' : 'text-dim hover:text-ink')
          }
        >
          <span aria-hidden>▦</span>
          <span className="mono-label text-inherit">Brush</span>
        </button>
        <select
          aria-label="What the brush paints"
          data-testid="fog-bar-paint"
          title={FOG_BRUSH_MODES.find((m) => m.paint === paint)?.hint}
          value={paint}
          onChange={(e) => pick(e.target.value as BrushMark)}
          className="min-h-9 shrink-0 rounded border border-edge bg-deck px-1.5 py-1 text-xs text-ink"
        >
          {FOG_BRUSH_MODES.map((m) => (
            <option key={m.paint} value={m.paint}>
              {m.label}
            </option>
          ))}
        </select>
        <label className="flex shrink-0 items-center gap-1.5" title="Brush size in squares; [ and ] change it while the brush is in hand">
          <span className="mono-label">Size</span>
          <input
            type="range"
            min={FOG_BRUSH_MIN}
            max={FOG_BRUSH_MAX}
            step={1}
            value={size}
            aria-label="Brush size in squares"
            data-testid="fog-bar-size"
            onChange={(e) => setSize(Number(e.target.value))}
            className="w-24 accent-cyan"
          />
          <span className="w-5 text-right text-xs tabular-nums text-ink" aria-hidden>
            {size}
          </span>
        </label>
      </div>

      <Divider />

      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Start over and check">
        <ConfirmButton
          label="Fog everything"
          confirmLabel="Fog everything?"
          testId="fog-bar-refog"
          title="Start over: hide every reveal, clear the brush and forget what the party has seen. What the runners see now stays."
          className="btn min-h-9 shrink-0 px-2 py-1 text-xs"
          onConfirm={() => commands.fogRefog(scene.id)}
        />
        <Toggle
          on={asPlayers}
          // The mockup's words: while the lens is on, the button says how to leave it.
          label={seeAsPlayersLabel(asPlayers)}
          showState={false}
          icon="👁"
          testId="fog-bar-see-as-players"
          title={
            asPlayers
              ? 'You see the map as the phones and the TV do. Press to go back to your own view.'
              : 'See the map exactly as the phones and the TV show it.'
          }
          onClick={() => setLens(asPlayers ? null : PARTY_LENS)}
        />
      </div>

      <p className="min-w-60 flex-1 basis-60 text-xs text-dim" data-testid="fog-bar-hint" aria-live="polite">
        {sight.failed ? 'Party sight did not save; try again.' : fogBarHint({ fog: fogged, sight: sight.on, brush: holding ? { paint, size } : null, asPlayers })}
      </p>
    </div>
  );
}
