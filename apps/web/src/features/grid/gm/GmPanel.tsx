/**
 * GM authoring side panel for the Grid. Desktop-first by design (NG5): the
 * panel docks beside the canvas on wide screens and stacks under it on
 * narrow ones.
 *
 * Two parts (docs/UX_MAP_BUILDER.md §3.1–3.2): the current mode's tabs, and
 * above them the inspector for whatever the GM has picked on the map — a
 * wall, a door, a zone, a pin, a camera, a note. The inspector sits outside
 * the tab's scroll, so it is in view whichever tab is open and however far
 * down it is; the zone tool's drafting controls sit there for the same
 * reason.
 *
 * Scenes, Layout, Tiles and Setup are not here (2026-09-19/20). Scenes and
 * their fights are their own page; Layout was a list of what the canvas
 * already shows, and the inspector — which a click on the thing opens — was
 * the only part of it that did anything; Tiles was emptied by the toolbar
 * and the mode bar taking its palette, its set and its clear; and Setup went
 * the same way, its calibration to the gear, its floors to the floor
 * dropdown and its images to the toolbar. Build's authoring is all on the
 * map now, and this panel serves Prep and Play.
 */
import { TrashButton } from './ui.js';
import type { Scene, Token } from '@safehouse/contracts';
import type { GridCommands } from '../commands.js';
import { useGridStore, type GmTab } from '../store.js';
import { usePaintBatch } from '../api.js';
import { copySet, describeSet, eraseBodies } from '../cellSelection.js';
import { MODE_TABS } from '../hud/modes.js';
import CamerasTab from './CamerasTab.js';
import DisplayTab from './DisplayTab.js';
import EnvTab from './EnvTab.js';
import FogTab from './FogTab.js';
import Inspector from './Inspector.js';
import PrepOutline from './PrepOutline.js';
import TokenInspector from './TokenInspector.js';
import ZoneDraft from './ZoneDraft.js';
import LosTab from './LosTab.js';
import TokensTab from './TokensTab.js';

const TABS: Array<{ id: GmTab; label: string }> = [
  { id: 'tokens', label: 'Tokens' },
  { id: 'fog', label: 'Fog' },
  { id: 'cameras', label: 'Cams & notes' },
  { id: 'env', label: 'Env' },
  { id: 'los', label: 'LOS' },
  { id: 'tv', label: 'TV' },
];

export interface GmPanelProps {
  campaignId: string;
  scene: Scene;
  tokens: Token[];
  activeSceneId: string | null;
  commands: GridCommands;
  onCenter: (x: number, y: number) => void;
}

export default function GmPanel(props: GmPanelProps) {
  const tab = useGridStore((s) => s.gmTab);
  const mode = useGridStore((s) => s.mode);
  const selected = useGridStore((s) => s.selected);
  const tool = useGridStore((s) => s.tool);
  const lens = useGridStore((s) => s.losTokenId);
  const setTab = useGridStore((s) => s.setGmTab);
  const toggle = useGridStore((s) => s.toggleGmPanel);
  const select = useGridStore((s) => s.select);
  const cellSelection = useGridStore((s) => s.cellSelection);
  const setCellSelection = useGridStore((s) => s.setCellSelection);
  // Only the current mode's sections (§3.1): a GM laying a floor is not shown
  // the TV controls, and a GM running a fight is not shown calibration.
  const tabs = MODE_TABS[mode].map((id) => TABS.find((t) => t.id === id)!).filter(Boolean);
  const showTab = MODE_TABS[mode].includes(tab);

  /*
    Build has no sections: everything about a floor is done on the floor. So
    in Build the panel is the properties of what is picked on the map and
    nothing else — it appears when something is selected (or a zone is being
    drafted), and it is gone the rest of the time, giving the canvas its
    width back.
  */
  const build = mode === 'build';
  if (build && !selected && !cellSelection && tool !== 'zone') return null;

  /*
    Prep has no sections either (2026-09-25). What it places is on the
    toolbar and what it sets for the whole scene is on the mode row; the
    panel is the picked thing's properties — a token, a fog region, a
    camera, a note — and, when nothing is picked, the one list of
    everything on the floor, which is how a GM finds a hidden token or a
    region not yet revealed.
  */
  if (mode === 'prep') return <PrepPanel {...props} />;

  return (
    <aside
      data-testid="gm-panel"
      className="flex w-full shrink-0 flex-col border-t border-edge bg-panel xl:h-full xl:w-80 xl:border-l xl:border-t-0"
    >
      {build ? (
        <div className="flex items-center gap-1 border-b border-edge px-3 py-1.5">
          <span className="mono-label flex-1 text-dim">Properties</span>
          {/*
            Closing it lets go of the thing: in Build the panel IS the
            selection, so there is nothing left for it to show.
          */}
          {(selected || cellSelection) && (
            <button
              type="button"
              className="btn px-2 py-1"
              title="Deselect"
              onClick={() => {
                select(null);
                setCellSelection(null);
              }}
            >
              ✕
            </button>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-1 border-b border-edge px-2 py-1.5">
          <div className="flex min-w-0 flex-1 flex-wrap gap-1" role="tablist" aria-label="GM tools">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                onClick={() => setTab(t.id)}
                className={
                  'mono-label rounded px-2 py-1 ' +
                  (tab === t.id ? 'bg-raised text-cyan' : 'text-dim hover:text-ink')
                }
              >
                {t.label}
              </button>
            ))}
          </div>
          <button type="button" className="btn px-2 py-1" title="Close panel" onClick={toggle}>
            ✕
          </button>
        </div>
      )}

      {/*
        A zone is saved when the GM says so, not on a click, so the zone
        tool's drafting controls sit outside the tabs — in view whichever
        section is open, for as long as the tool is in hand.
      */}
      {tool === 'zone' && (
        <div className="shrink-0 border-b border-edge">
          <ZoneDraft scene={props.scene} />
        </div>
      )}

      {build && cellSelection && <SelectionInspector scene={props.scene} />}

      {selected && (
        <div
          className={
            build
              ? 'min-h-0 flex-1 overflow-y-auto'
              : 'max-h-96 shrink-0 overflow-y-auto border-b border-edge'
          }
        >
          <Inspector
            campaignId={props.campaignId}
            scene={props.scene}
            selection={selected}
            onCenter={props.onCenter}
            commands={props.commands}
          />
        </div>
      )}

      {/*
        Only a section this mode has. The tab in hand outlives a switch into
        Build (which has none), and must not draw there regardless.
      */}
      {!build && showTab && (
      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === 'los' && <LosTab scene={props.scene} tokens={props.tokens} />}
        {tab === 'tokens' && (
          <TokensTab
            campaignId={props.campaignId}
            scene={props.scene}
            tokens={props.tokens}
            onCenter={props.onCenter}
          />
        )}
        {tab === 'cameras' && <CamerasTab scene={props.scene} selected={selected} lens={lens} />}
        {tab === 'fog' && <FogTab scene={props.scene} commands={props.commands} />}
        {tab === 'env' && <EnvTab scene={props.scene} />}
        {tab === 'tv' && <DisplayTab commands={props.commands} />}
      </div>
      )}
    </aside>
  );
}

/** Prep's panel: the picked thing's properties, or everything on the floor. */
function PrepPanel(props: GmPanelProps) {
  const selected = useGridStore((s) => s.selected);
  const selectedTokenId = useGridStore((s) => s.selectedTokenId);
  const select = useGridStore((s) => s.select);
  const selectToken = useGridStore((s) => s.selectToken);
  const toggle = useGridStore((s) => s.toggleGmPanel);
  const token = props.tokens.find((t) => t.id === selectedTokenId) ?? null;
  const picked = token !== null || selected !== null;
  return (
    <aside
      data-testid="gm-panel"
      className="flex w-full shrink-0 flex-col border-t border-edge bg-panel xl:h-full xl:w-80 xl:border-l xl:border-t-0"
    >
      <div className="flex items-center gap-1 border-b border-edge px-3 py-1.5">
        <span className="mono-label flex-1 text-dim">{picked ? 'Properties' : 'On this floor'}</span>
        {picked ? (
          <button
            type="button"
            className="btn px-2 py-1"
            title="Back to everything on this floor"
            onClick={() => {
              select(null);
              selectToken(null);
            }}
          >
            ✕
          </button>
        ) : (
          <button type="button" className="btn px-2 py-1" title="Close panel" onClick={toggle}>
            ✕
          </button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {token ? (
          <TokenInspector scene={props.scene} tokens={props.tokens} token={token} onCenter={props.onCenter} />
        ) : selected ? (
          <Inspector
            campaignId={props.campaignId}
            scene={props.scene}
            selection={selected}
            onCenter={props.onCenter}
            commands={props.commands}
          />
        ) : (
          <PrepOutline scene={props.scene} tokens={props.tokens} commands={props.commands} onCenter={props.onCenter} />
        )}
      </div>
    </aside>
  );
}

/**
 * A multi-selection's properties: how much is in it, and the two things a
 * GM does to a set of squares that are not a drag — copy it, or take it out.
 * Ctrl+C and Delete do the same; the buttons are for the GM who has not
 * learnt the keys yet, which is most GMs.
 */
function SelectionInspector({ scene }: { scene: Scene }) {
  const sel = useGridStore((s) => s.cellSelection);
  const setCellSelection = useGridStore((s) => s.setCellSelection);
  const setClipboard = useGridStore((s) => s.setClipboard);
  const clipboard = useGridStore((s) => s.clipboard);
  const batch = usePaintBatch();
  if (!sel) return null;
  return (
    <section data-testid="selection-inspector" className="bg-raised/40 px-3 py-3" aria-label="Selection">
      <div className="flex items-center gap-2">
        <span className="mono-label text-magenta">Selection</span>
        <span className="mono-label min-w-0 flex-1 truncate text-faint">{describeSet(sel)}</span>
      </div>
      <div className="mt-2 flex justify-end gap-2">
        <button
          type="button"
          className="btn py-1"
          data-testid="selection-copy"
          title="Copy (Ctrl+C) — then Ctrl+V and click where it goes"
          onClick={() => {
            const clip = copySet(scene, sel);
            if (clip) setClipboard(clip);
          }}
        >
          {clipboard ? 'copy again' : 'copy'}
        </button>
        <TrashButton
          label="Delete the selection"
          testId="selection-delete"
          onClick={() => {
            const bodies = eraseBodies(scene, sel);
            setCellSelection(null);
            if (bodies.length > 0) {
              batch.mutate({
                sceneId: scene.id,
                bodies,
                label: 'delete the selection',
                restore: {
                  undo: () => useGridStore.getState().setCellSelection(sel),
                  redo: () => useGridStore.getState().setCellSelection(null),
                },
              });
            }
          }}
        />
      </div>
    </section>
  );
}
