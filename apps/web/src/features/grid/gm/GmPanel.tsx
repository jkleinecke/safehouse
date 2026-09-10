/**
 * GM authoring side panel for the Grid (FR9.1/9.2/9.6/9.7/9.11/9.13/9.14).
 * Desktop-first by design (NG5): the panel docks beside the canvas on wide
 * screens and stacks under it on narrow ones.
 */
import type { Scene, Token } from '@safehouse/contracts';
import type { GridCommands } from '../commands.js';
import { useGridStore, type GmTab } from '../store.js';
import { MODE_TABS } from '../hud/modes.js';
import CamerasTab from './CamerasTab.js';
import DisplayTab from './DisplayTab.js';
import EnvTab from './EnvTab.js';
import FogTab from './FogTab.js';
import GeometryTab from './GeometryTab.js';
import MapTab from './MapTab.js';
import NotesTab from './NotesTab.js';
import PinsTab from './PinsTab.js';
import ScenesTab from './ScenesTab.js';
import TilesTab from './TilesTab.js';
import LosTab from './LosTab.js';
import TokensTab from './TokensTab.js';

const TABS: Array<{ id: GmTab; label: string }> = [
  { id: 'scenes', label: 'Scenes' },
  { id: 'map', label: 'Map' },
  { id: 'tiles', label: 'Tiles' },
  { id: 'tokens', label: 'Tokens' },
  { id: 'geo', label: 'Geo' },
  { id: 'pins', label: 'Pins' },
  { id: 'cameras', label: 'Cams' },
  { id: 'notes', label: 'Notes' },
  { id: 'fog', label: 'Fog' },
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
  const setTab = useGridStore((s) => s.setGmTab);
  const toggle = useGridStore((s) => s.toggleGmPanel);
  // Only the current mode's sections (docs/UX_MAP_BUILDER.md §3.1): a GM laying
  // a floor is not shown the TV controls, and a GM running a fight is not
  // shown calibration.
  const tabs = MODE_TABS[mode].map((id) => TABS.find((t) => t.id === id)!).filter(Boolean);

  return (
    <aside className="flex w-full shrink-0 flex-col border-t border-edge bg-panel xl:h-full xl:w-80 xl:border-l xl:border-t-0">
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

      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === 'scenes' && (
          <ScenesTab
            campaignId={props.campaignId}
            scene={props.scene}
            activeSceneId={props.activeSceneId}
          />
        )}
        {tab === 'map' && <MapTab scene={props.scene} />}
        {tab === 'tiles' && <TilesTab scene={props.scene} />}
        {tab === 'los' && <LosTab scene={props.scene} tokens={props.tokens} />}
        {tab === 'tokens' && (
          <TokensTab
            campaignId={props.campaignId}
            scene={props.scene}
            tokens={props.tokens}
            onCenter={props.onCenter}
          />
        )}
        {tab === 'geo' && <GeometryTab scene={props.scene} onCenter={props.onCenter} />}
        {tab === 'pins' && (
          <PinsTab campaignId={props.campaignId} scene={props.scene} onCenter={props.onCenter} />
        )}
        {tab === 'cameras' && <CamerasTab scene={props.scene} onCenter={props.onCenter} />}
        {tab === 'notes' && <NotesTab scene={props.scene} onCenter={props.onCenter} />}
        {tab === 'fog' && <FogTab scene={props.scene} commands={props.commands} />}
        {tab === 'env' && <EnvTab scene={props.scene} />}
        {tab === 'tv' && <DisplayTab commands={props.commands} />}
      </div>

    </aside>
  );
}
