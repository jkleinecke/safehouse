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
import type { Scene, Token } from '@safehouse/contracts';
import type { GridCommands } from '../commands.js';
import { useGridStore, type GmTab } from '../store.js';
import { MODE_TABS } from '../hud/modes.js';
import CamerasTab from './CamerasTab.js';
import DisplayTab from './DisplayTab.js';
import EnvTab from './EnvTab.js';
import FogTab from './FogTab.js';
import Inspector from './Inspector.js';
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
  // Only the current mode's sections (§3.1): a GM laying a floor is not shown
  // the TV controls, and a GM running a fight is not shown calibration.
  const tabs = MODE_TABS[mode].map((id) => TABS.find((t) => t.id === id)!).filter(Boolean);

  return (
    <aside
      data-testid="gm-panel"
      className="flex w-full shrink-0 flex-col border-t border-edge bg-panel xl:h-full xl:w-80 xl:border-l xl:border-t-0"
    >
      {/*
        Build has no sections left — everything about a floor is done on the
        floor now — so the strip draws only when the mode has tabs. The panel
        itself stays: the inspector and the zone draft live above the tabs,
        and both are Build work.
      */}
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

      {selected && (
        <div className="max-h-96 shrink-0 overflow-y-auto border-b border-edge">
          <Inspector
            campaignId={props.campaignId}
            scene={props.scene}
            selection={selected}
            onCenter={props.onCenter}
          />
        </div>
      )}

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
    </aside>
  );
}
