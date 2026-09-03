/**
 * /c/:campaignId/grid — the tactical scene canvas (DESIGN.md M9, P2 scope).
 *
 * This file is the wiring: it resolves which scene is on screen, projects
 * server + live state into `StageSceneState`, and routes stage callbacks to WS
 * commands. All rendering lives in the lazily-imported `stage/` chunk.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import type { Scene, Token } from '@safehouse/contracts';
import { deriveCharacter } from '@safehouse/rules';
import { useMyCharacterId } from '../../api/campaigns.js';
import { getSession } from '../../api/session.js';
import { getLiveSocket } from '../../live/socket.js';
import {
  fileUrl,
  useCharacter,
  useGridLiveSync,
  usePatchGeometry,
  useRefetchOnReconnect,
  useScene,
  useSceneTokens,
  useScenes,
  usePaintTiles,
  useTilesets,
  tileDefsFrom,
  TileStrokeBuffer,
} from './api.js';
import { GridCommands } from './commands.js';
import { rollScatter } from './geometry.js';
import { addDoor, addPin, addWall, toggleDoor } from './geometryEdit.js';
import GmPanel from './gm/GmPanel.js';
import MeasurePanel from './hud/MeasurePanel.js';
import Toolbar from './hud/Toolbar.js';
import { composeStageState, resolveSceneId } from './hydration.js';
import {
  movementFrom,
  rangeReadout,
  rangedWeapons,
  type Viewer,
} from './projection.js';
import { autoTileFor } from './autoPlace.js';
import { useShroud } from './useShroud.js';
import { useGridStore } from './store.js';
import type { RulerState, StageApi, StageCallbacks, StageSceneState } from './types.js';
import {
  useActiveSceneId,
  useFocusStream,
  useHydratedEncounter,
  useMarkStream,
  useRemoteDrags,
} from './useGridLive.js';
import { useStage } from './useStage.js';

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex h-full min-h-[50dvh] items-center justify-center p-6">
      <div className="panel max-w-sm p-6 text-center">
        <div className="mono-label text-cyan">Grid</div>
        <h1 className="mt-2 text-base font-semibold">{title}</h1>
        <p className="mt-1 text-sm text-dim">{body}</p>
      </div>
    </div>
  );
}

export default function GridPage() {
  const { campaignId } = useParams<{ campaignId: string }>();
  const session = getSession();
  const myCharacterId = useMyCharacterId(campaignId);
  const viewer: Viewer = useMemo(
    () => ({
      role: session?.role ?? 'observer',
      userId: session?.userId,
      characterId: myCharacterId ?? undefined,
    }),
    [session?.role, session?.userId, myCharacterId],
  );
  const isGm = viewer.role === 'gm';

  const store = useGridStore();
  const liveActiveSceneId = useActiveSceneId();
  const scenesQuery = useScenes(campaignId);

  // Which scene is on screen: the GM may stage another privately (FR9.1);
  // everyone else follows the campaign's active scene. LIVE-1 — the REST scene
  // list is the cold-start answer, so a refresh mid-session still lands on the
  // right map instead of waiting for the next `scene.activated`.
  const { activeSceneId, sceneId } = useMemo(
    () =>
      resolveSceneId({
        isGm,
        viewSceneId: store.viewSceneId,
        liveActiveSceneId,
        scenes: scenesQuery.data,
      }),
    [isGm, store.viewSceneId, liveActiveSceneId, scenesQuery.data],
  );

  const sceneQuery = useScene(sceneId);
  const tokensQuery = useSceneTokens(sceneId);
  useGridLiveSync(sceneId);
  useRefetchOnReconnect(campaignId, sceneId);

  const scene: Scene | null = sceneQuery.data ?? null;
  const tokens: Token[] = useMemo(() => tokensQuery.data ?? [], [tokensQuery.data]);
  // Hydrated from REST, then merged with live `encounter.updated` (LIVE-1):
  // the acting-token glow and condition bars survive a page refresh.
  const encounter = useHydratedEncounter(campaignId, sceneId);
  const drags = useRemoteDrags();
  const patchGeometry = usePatchGeometry();
  const paintTiles = usePaintTiles();
  const { data: tilesets } = useTilesets();

  /** The palette the canvas paints with (FR9.2) — see `tileDefsFrom`. */
  const tileDefs = useMemo(() => (tilesets ? tileDefsFrom(tilesets) : null), [tilesets]);

  /**
   * Stroke buffer: filled per cell by the pointer, sent as one request when the
   * stroke ends. See `TileStrokeBuffer` for what it is defending against.
   */
  const [tileNotice, setTileNotice] = useState<string | null>(null);
  const paintRef = useRef(paintTiles.mutateAsync);
  paintRef.current = paintTiles.mutateAsync;
  const strokeRef = useRef<TileStrokeBuffer | null>(null);
  if (!strokeRef.current) {
    strokeRef.current = new TileStrokeBuffer({
      send: (body) => paintRef.current(body),
      onError: () => setTileNotice('that stroke did not save — paint it again'),
    });
  }
  // A stroke still buffered when the GM navigates away is work they did.
  useEffect(() => () => strokeRef.current?.dispose(), []);

  /**
   * The floor-wipe warning, on the canvas rather than in the panel.
   *
   * The server replaces the ENTIRE painted layer when a stroke arrives under a
   * different tileset (`plugins/scenes.ts` — there is no merge across sets and
   * no confirmation). `TilesTab` says so, but only while the Tiles tab is
   * open, and both the selected set and the paint tool outlive the panel: a GM
   * who closes the panel and keeps painting could wipe a scene's floor with one
   * click and never see the sentence. It follows the tool now, so it is on
   * screen exactly when the next stroke is the destructive one.
   */
  const tileWipeWarning = useMemo(() => {
    if (!isGm || (store.tool !== 'tile' && store.tool !== 'tile-erase')) return null;
    const painted = scene?.tiles;
    if (!painted || painted.tilesetId === store.tilesetId) return null;
    const count = Object.keys(painted.cells).length;
    if (count === 0) return null;
    return `painting now replaces ${count} cells painted with “${painted.tilesetId}”`;
  }, [isGm, store.tool, store.tilesetId, scene?.tiles]);

  // -- commands -------------------------------------------------------------

  const commandsRef = useRef<GridCommands | null>(null);
  if (!commandsRef.current) commandsRef.current = new GridCommands(null, null);
  const commands = commandsRef.current;

  useEffect(() => {
    if (!campaignId || !session) return;
    const socket = getLiveSocket({ campaignId, token: session.token });
    commands.bind(socket, sceneId);
  }, [campaignId, session, sceneId, commands]);

  useEffect(() => () => commandsRef.current?.dispose(), []);

  // -- projections ----------------------------------------------------------

  // Ruler source: the token the measurement started on drives walk/run + bands.
  const rulerToken = useMemo(
    () => tokens.find((t) => t.id === store.ruler?.fromTokenId) ?? null,
    [tokens, store.ruler?.fromTokenId],
  );
  const rulerCharacterId =
    rulerToken?.source === 'character' ? (rulerToken.sourceId ?? null) : null;
  const rulerCharacter = useCharacter(rulerCharacterId);
  const sheet = rulerCharacter.data?.sheet ?? null;
  const derived = useMemo(() => {
    if (!sheet) return null;
    try {
      return deriveCharacter(sheet);
    } catch {
      return null; // a half-entered sheet must never break the canvas
    }
  }, [sheet]);
  const thresholds = useMemo(() => movementFrom(derived), [derived]);
  const weapons = useMemo(() => rangedWeapons(sheet), [sheet]);
  const weapon = useMemo(
    () => weapons.find((w) => w.name === store.selectedWeapon) ?? null,
    [weapons, store.selectedWeapon],
  );
  const range = useMemo(
    () => (store.ruler ? rangeReadout(store.ruler.meters, weapon, sheet) : null),
    [store.ruler, weapon, sheet],
  );

  // Whose eyes the canvas is showing. Players see their own character's
  // sightline when the GM has switched it on for the scene; the GM sees a
  // viewpoint they pick, and by default none at all.
  const shroud = useShroud({
    scene,
    tokens,
    isGm,
    losTokenId: store.losTokenId,
    myCharacterId: myCharacterId ?? null,
    enabledForPlayers: store.losForPlayers,
  });

  const stageState: StageSceneState | null = useMemo(
    () =>
      composeStageState({
        scene,
        tokens,
        viewer,
        encounter,
        selectedTokenId: store.selectedTokenId,
        tool: store.tool,
        snapEnabled: store.snapEnabled,
        aoe: store.aoe,
        scatter: store.scatter,
        fogDraft: store.fogDraft,
        selectedPinId: store.selectedPinId,
        shroud,
      }),
    [
      scene,
      tokens,
      viewer,
      encounter,
      store.selectedTokenId,
      store.tool,
      store.snapEnabled,
      store.aoe,
      store.scatter,
      store.fogDraft,
      store.selectedPinId,
      shroud,
    ],
  );

  // -- stage callbacks ------------------------------------------------------

  const [focusNotice, setFocusNotice] = useState<string | null>(null);
  const apiRef = useRef<StageApi | null>(null);

  const callbacks: StageCallbacks = useMemo(
    () => ({
      onTokenMove: (id, x, y) => commands.move(id, x, y),
      onTokenDrag: (id, x, y) => commands.drag(id, x, y),
      onSelectToken: (id) => useGridStore.getState().selectToken(id),
      onPing: (x, y) => commands.ping(x, y),
      onPointer: (x, y) => commands.pointer(x, y),
      onRuler: (r: RulerState | null) => useGridStore.getState().setRuler(r),
      onDoorToggle: (doorId) => {
        if (!scene || !isGm) return;
        patchGeometry.mutate({ sceneId: scene.id, geometry: toggleDoor(scene.geometry, doorId) });
      },
      onAoePlace: (x, y) => {
        const s = useGridStore.getState();
        s.setAoe({ center: { x, y }, radiusM: s.aoeRadiusM });
      },
      onFogVertex: (x, y) => useGridStore.getState().addFogVertex(x, y),
      onFocus: (x, y) => {
        commands.focus(x, y);
        apiRef.current?.centerOn(x, y);
        setFocusNotice('focus pushed to the table');
        window.setTimeout(() => setFocusNotice(null), 1800);
      },
      // -- GM geometry authoring (FR9.2/9.3) --------------------------------
      onSegmentDraw: (kind, a, b) => {
        if (!scene || !isGm) return;
        const geometry =
          kind === 'door' ? addDoor(scene.geometry, a, b) : addWall(scene.geometry, a, b);
        if (geometry === scene.geometry) return; // degenerate drag, nothing drawn
        patchGeometry.mutate({ sceneId: scene.id, geometry });
      },
      onPinPlace: (x, y) => {
        if (!scene || !isGm) return;
        const geometry = addPin(scene.geometry, { x, y });
        const placed = geometry.pins[geometry.pins.length - 1];
        patchGeometry.mutate({ sceneId: scene.id, geometry });
        const s = useGridStore.getState();
        if (placed) s.selectPin(placed.id);
        s.setGmTab('pins');
        s.openGmPanel();
      },
      // -- tile painting (FR9.2) --------------------------------------------
      // Both halves are buffered: the coalescer knows which scene and which
      // tileset a cell was painted under, so nothing is submitted under a set
      // the GM has since switched away from.
      onTilePaint: (col, row, erase) => {
        if (!scene || !isGm) return;
        const st = useGridStore.getState();

        // Auto (`tileId === null`) is the DEFAULT, so this cannot bail out on
        // an empty selection any more — that is the mode where the click means
        // "you decide". `autoTileFor` answers from the square: what ground is
        // under it, whether a wall adjoins it, what is already there.
        //
        // It can still answer null, and that is a real answer rather than a
        // failure: Decor on ground no prop declares should place nothing,
        // instead of standing a fire hydrant somewhere it makes no sense.
        let placing: string | null = null;
        if (!erase) {
          const picked = autoTileFor({
            scene,
            tilesets: tilesets ?? [],
            tilesetId: st.tilesetId,
            category: st.tileCategory,
            tileId: st.tileId,
            col,
            row,
          });
          if (picked === null) return;
          placing = picked.tileId;
        }

        setTileNotice(null);
        strokeRef.current?.add(scene.id, st.tilesetId, `${col},${row}`, placing);
      },
      onTileStrokeEnd: () => strokeRef.current?.flush(),
      onPinSelect: (pinId) => {
        const s = useGridStore.getState();
        s.selectPin(pinId);
        s.setGmTab('pins');
        s.openGmPanel();
      },
    }),
    [commands, scene, isGm, patchGeometry, tilesets],
  );

  const urlFor = useCallback((id: string) => fileUrl(id), []);
  const { hostRef, api, loading, error } = useStage({
    state: stageState,
    callbacks,
    urlFor,
    thresholds,
    drags,
  });
  apiRef.current = api;

  /**
   * Hand the canvas the served palette. The dependency on `api` is the whole
   * point of this effect.
   *
   * It used to be keyed `[tilesets, scene?.id]` and to call through `apiRef`,
   * which is assigned during render from a handle that arrives asynchronously
   * (`useStage` dynamically imports the pixi chunk). On a cold load the last
   * run was the one where the scene id first appeared — the import had not
   * resolved, the ref was still null, and `setTileDefs` was a silent no-op,
   * after which neither dep ever changed again. The stage kept an empty
   * palette, `drawTiles` skipped every cell for want of a definition, and the
   * painted floor appeared only if the GM switched scenes and came back.
   */
  useEffect(() => {
    if (api && tileDefs) api.setTileDefs(tileDefs);
  }, [api, tileDefs]);

  // Leaving the ruler drops its line from the canvas as well as the readout.
  useEffect(() => {
    if (store.tool !== 'ruler') api?.clearRuler();
  }, [api, store.tool]);

  // Remote ephemeral marks: flash, trail, or recentre once (FR9.15).
  useMarkStream(sceneId, (kind, x, y) => {
    const stage = apiRef.current;
    if (!stage) return;
    if (kind === 'pointer') stage.trail(x, y);
    else if (kind === 'focus') stage.centerOn(x, y);
    else stage.flashPing(x, y);
  });

  // …and the persisted route for the same gesture (FR9.15/FR9.21).
  useFocusStream(sceneId, (x, y) => apiRef.current?.centerOn(x, y));

  const onScatter = useCallback(() => {
    const s = useGridStore.getState();
    if (!s.aoe || !scene) return;
    const out = rollScatter({
      from: s.aoe.center,
      dice: s.scatterDice,
      netHits: s.scatterNetHits,
      unitM: scene.grid.unitM,
    });
    s.setScatter({ from: s.aoe.center, to: out.to, meters: out.meters, summary: out.summary });
  }, [scene]);

  // -- render ---------------------------------------------------------------

  if (!campaignId || !session) {
    return <EmptyState title="No device token" body="Scan the GM's join QR to reach the Grid." />;
  }
  if (!sceneId) {
    return (
      <EmptyState
        title="No active scene"
        body={
          isGm
            ? 'Create a scene and activate it from the GM panel to put a map on the table.'
            : 'The GM has not put a scene on the table yet.'
        }
      />
    );
  }
  if (sceneQuery.isError) {
    return <EmptyState title="Scene unavailable" body="The server did not return this scene." />;
  }

  return (
    <div className="flex h-full min-h-[70dvh] w-full flex-col xl:flex-row">
      <div className="relative min-h-[52dvh] flex-1 overflow-hidden bg-ground">
        <div ref={hostRef} className="absolute inset-0" />

        {(loading || !scene) && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center">
            <span className="mono-label animate-pulse text-cyan">loading canvas</span>
          </div>
        )}
        {error && (
          <div className="absolute inset-x-3 top-3 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
            {error}
          </div>
        )}

        <Toolbar
          isGm={isGm}
          tool={store.tool}
          snapEnabled={store.snapEnabled}
          gmPanelOpen={store.gmPanelOpen}
          onTool={store.setTool}
          onToggleSnap={store.toggleSnap}
          onToggleGmPanel={store.toggleGmPanel}
          onZoom={(f) => api?.zoomBy(f)}
          onFit={() => api?.fitScene()}
        />

        <div className="pointer-events-none absolute right-3 top-3 flex flex-col items-end gap-1.5">
          <span className="chip pointer-events-auto bg-panel/90 text-ink">
            {scene?.name ?? '…'}
            {scene && scene.id !== activeSceneId && (
              <span className="text-warn">staging</span>
            )}
          </span>
          {focusNotice && <span className="chip bg-panel/90 text-cyan">{focusNotice}</span>}
          {tileWipeWarning && (
            <span data-testid="tile-wipe-warning" className="chip bg-panel/90 text-magenta">
              {tileWipeWarning}
            </span>
          )}
          {tileNotice && (
            <span data-testid="tile-notice" className="chip bg-panel/90 text-danger">
              {tileNotice}
            </span>
          )}
        </div>

        <MeasurePanel
          tool={store.tool}
          ruler={store.ruler}
          unitM={scene?.grid.unitM ?? 1}
          thresholds={thresholds}
          weapons={weapons}
          selectedWeapon={store.selectedWeapon}
          onSelectWeapon={store.selectWeapon}
          range={range}
          onApplyMod={(value, label) =>
            store.setPendingRollMod({ value, label, sourceKind: 'range', ts: Date.now() })
          }
          pending={store.pendingRollMod}
          onClearMod={() => store.setPendingRollMod(null)}
          aoe={store.aoe}
          aoeRadiusM={store.aoeRadiusM}
          onAoeRadius={store.setAoeRadiusM}
          scatter={store.scatter}
          scatterDice={store.scatterDice}
          scatterNetHits={store.scatterNetHits}
          onScatterDice={store.setScatterDice}
          onScatterNetHits={store.setScatterNetHits}
          onScatter={onScatter}
          onClearAoe={() => store.setAoe(null)}
        />
      </div>

      {isGm && store.gmPanelOpen && scene && campaignId && (
        <GmPanel
          campaignId={campaignId}
          scene={scene}
          tokens={tokens}
          activeSceneId={activeSceneId}
          commands={commands}
          onCenter={(x, y) => api?.centerOn(x, y)}
        />
      )}
    </div>
  );
}
