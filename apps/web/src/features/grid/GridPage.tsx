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
import { GROUND_LEVEL_NAME, deriveCharacter } from '@safehouse/rules';
import { useMyCharacterId } from '../../api/campaigns.js';
import { ApiError } from '../../api/client.js';
import { getSession } from '../../api/session.js';
import { getLiveSocket } from '../../live/socket.js';
import {
  fileUrl,
  useCharacter,
  useDoorOp,
  useGridLiveSync,
  usePatchGeometry,
  usePatchToken,
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
import { addCamera, addDoor, addNote, addPin, addWall, tileDoorOpen } from './geometryEdit.js';
import GmPanel from './gm/GmPanel.js';
import MeasurePanel from './hud/MeasurePanel.js';
import Toolbar, { ViewControls } from './hud/Toolbar.js';
import { useGridShortcuts } from './hud/useGridShortcuts.js';
import { composeStageState, resolveSceneId } from './hydration.js';
import {
  movementFrom,
  rangeReadout,
  rangedWeapons,
  type Viewer,
} from './projection.js';
import { autoTileFor } from './autoPlace.js';
import { roomPlan, roomTileIds } from './roomFill.js';
import { useCameraCones } from './useCameraCones.js';
import { useShroud } from './useShroud.js';
import { useStairOffer } from './useStairs.js';
import { useGridStore } from './store.js';
import {
  TILE_TOOLS,
  type RulerState,
  type StageApi,
  type StageCallbacks,
  type StageSceneState,
} from './types.js';
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
  const doorOp = useDoorOp(scene?.id);
  const paintTiles = usePaintTiles();
  const { data: tilesets } = useTilesets();

  /** The palette the canvas paints with (FR9.2) — see `tileDefsFrom`. */
  const tileDefs = useMemo(() => (tilesets ? tileDefsFrom(tilesets) : null), [tilesets]);

  /**
   * Stroke buffer: filled per cell by the pointer, sent as one request when the
   * stroke ends. See `TileStrokeBuffer` for what it is defending against.
   */
  const [tileNotice, setTileNotice] = useState<string | null>(null);
  // What the door said back (FR9.24): "that door is locked" is the whole point.
  const [doorNotice, setDoorNotice] = useState<string | null>(null);
  const showDoorNotice = useCallback((e: unknown) => {
    setDoorNotice(e instanceof ApiError && e.code === 'door_locked' ? 'that door is locked' : 'the door did not move');
    window.setTimeout(() => setDoorNotice(null), 2000);
  }, []);
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
    if (!isGm || (!TILE_TOOLS.includes(store.tool) && store.tool !== 'tile-erase')) return null;
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
    // The scene's own setting (FR9.16), so every player device hears the
    // GM's switch the moment it flips rather than never.
    enabledForPlayers: scene?.vision?.playersSeeOwnSight ?? false,
  });

  /**
   * Taking the stairs. Offered only when the SELECTED token is standing on a
   * flight that leads somewhere real, so the button never appears for stairs
   * the GM sketched before building the floor above.
   */
  const selectedToken = useMemo(
    () => tokens.find((t) => t.id === store.selectedTokenId),
    [tokens, store.selectedTokenId],
  );
  const stairOffer = useStairOffer(scene, selectedToken, tilesets);
  const patchToken = usePatchToken(sceneId);

  const takeStairs = useCallback(() => {
    if (!stairOffer || selectedToken === undefined) return;
    // The token and the VIEW move together. One floor is drawn at a time, so
    // changing the level without following it makes the runner vanish — and
    // the GM's only clue is a token that stopped existing.
    patchToken.mutate(
      { tokenId: selectedToken.id, patch: { level: stairOffer.target } },
      { onSuccess: () => store.setActiveLevel(stairOffer.target) },
    );
  }, [stairOffer, selectedToken, patchToken, store]);

  /**
   * The scene as THIS screen draws it.
   *
   * The GM's plan/iso choice is a view, not an edit: it overrides the grid's
   * projection on the way to the canvas and nowhere else, so the table keeps
   * seeing the scene the way it is saved while the GM lays rooms out in plan.
   */
  const viewScene = useMemo(() => {
    if (!scene || !isGm || store.viewProjection === 'scene') return scene;
    if (scene.grid.projection === store.viewProjection) return scene;
    return { ...scene, grid: { ...scene.grid, projection: store.viewProjection } };
  }, [scene, isGm, store.viewProjection]);

  /**
   * Which floor this screen shows.
   *
   * The GM picks. A PLAYER follows their own runner: which storey to draw is
   * the GM's decision, and the GM makes it by moving the token — so when
   * Torque takes the stairs, Torque's phone goes up with him, and there is no
   * floor control on it to get lost with. A device with no runner on this
   * scene sees the ground.
   */
  const viewLevel = useMemo(() => {
    if (isGm) return store.activeLevel;
    const mine = tokens.find((t) => t.source === 'character' && t.sourceId === myCharacterId);
    return mine?.level ?? 0;
  }, [isGm, store.activeLevel, tokens, myCharacterId]);

  // What the GM's cameras cover on this floor (FR9.23). Null for players,
  // whose scene carries no cameras to begin with.
  const cameraCones = useCameraCones(scene, isGm, viewLevel);
  // Single-key tools and 1–9 for floors (docs/UX_MAP_BUILDER.md §3.3).
  useGridShortcuts(isGm, 1 + (scene?.levels?.length ?? 0));

  const stageState: StageSceneState | null = useMemo(
    () =>
      composeStageState({
        scene: viewScene,
        tokens,
        viewer,
        encounter,
        selectedTokenId: store.selectedTokenId,
        tool: store.tool,
        snapEnabled: store.snapEnabled,
        aoe: store.aoe,
        scatter: store.scatter,
        fogDraft: store.fogDraft,
        selection: store.selected,
        cameraCones,
        shroud,
        level: viewLevel,
      }),
    [
      viewScene,
      tokens,
      viewer,
      encounter,
      store.selectedTokenId,
      store.tool,
      store.snapEnabled,
      store.aoe,
      store.scatter,
      store.fogDraft,
      store.selected,
      cameraCones,
      shroud,
      viewLevel,
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
        if (!scene) return;
        const door = scene.geometry.doors.find((d) => d.id === doorId);
        if (!door) return;
        // A player's hand on the handle goes to the server, which knows the
        // lock (FR9.24); the GM's goes the same way, so there is one path —
        // and for the GM the door opens in the inspector too, where the lock
        // is one click away (docs/UX_MAP_BUILDER.md §3.2).
        if (isGm) useGridStore.getState().select({ kind: 'door', id: doorId });
        doorOp.mutate({ doorId, op: door.open ? 'close' : 'open' }, { onError: showDoorNotice });
      },
      onTileDoorToggle: (cell, level) => {
        if (!scene) return;
        const open = tileDoorOpen(scene, level, cell);
        doorOp.mutate({ cell, level, op: open ? 'close' : 'open' }, { onError: showDoorNotice });
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
        if (placed) s.select({ kind: 'pin', id: placed.id });
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
            level: st.activeLevel,
          });
          if (picked === null) return;
          placing = picked.tileId;
        }

        setTileNotice(null);
        strokeRef.current?.add(scene.id, st.tilesetId, `${col},${row}`, placing, st.activeLevel);
      },
      onTileStrokeEnd: () => strokeRef.current?.flush(),
      // -- room / area rectangles (FR9.2) -----------------------------------
      // Two requests, floor then walls, because a cell holds one tile per
      // request and a room's edge cells need both: floor in the ground layer
      // so the room is not a ring around a hole, and a wall standing on it.
      // Awaited in order — each is a read-modify-write of the layer, and two
      // in flight would lose each other's cells.
      onTileRect: (c0, r0, c1, r1, mode) => {
        if (!scene || !isGm) return;
        const st = useGridStore.getState();
        const set = (tilesets ?? []).find((t) => t.id === st.tilesetId);
        if (!set) return;
        const { floorId, wallId } = roomTileIds(set.tiles, st.tileId);
        if (floorId === null) {
          setTileNotice('this set has no ground tile to fill with');
          return;
        }
        const plan = roomPlan(c0, r0, c1, r1, mode);
        // Anything the brush still holds lands first, so a stroke and a room
        // drawn in quick succession arrive in the order they were made.
        strokeRef.current?.flush();
        const sceneId = scene.id;
        const level = st.activeLevel;
        const send = (keys: readonly string[], tileId: string) =>
          paintRef.current({
            sceneId,
            tilesetId: st.tilesetId,
            level,
            paint: Object.fromEntries(keys.map((k) => [k, tileId])),
            erase: [],
            clear: false,
          });
        setTileNotice(null);
        void (async () => {
          try {
            await send(plan.floor, floorId);
            if (plan.walls.length > 0 && wallId !== null) await send(plan.walls, wallId);
          } catch {
            setTileNotice('that room did not save — draw it again');
          }
        })();
      },
      // -- the inspector (docs/UX_MAP_BUILDER.md §3.2): a click on a thing opens
      // it in the panel, whichever tab is showing; a click on nothing closes it.
      onPinSelect: (pinId) => {
        const s = useGridStore.getState();
        s.select({ kind: 'pin', id: pinId });
        s.openGmPanel();
      },
      onWallSelect: (wallId) => {
        const s = useGridStore.getState();
        s.select({ kind: 'wall', id: wallId });
        s.openGmPanel();
      },
      onZoneSelect: (zoneId) => {
        const s = useGridStore.getState();
        s.select({ kind: 'zone', id: zoneId });
        s.openGmPanel();
      },
      onSelectClear: () => useGridStore.getState().select(null),
      // -- Security cameras (FR9.23) -----------------------------------------
      onCameraPlace: (x, y) => {
        if (!scene || !isGm) return;
        // Mounted on the floor the GM is looking at, facing the way a GM
        // most often wants first: toward the bottom of the screen.
        const geometry = addCamera(scene.geometry, { x, y }, { level: useGridStore.getState().activeLevel });
        const placed = geometry.cameras?.[geometry.cameras.length - 1];
        patchGeometry.mutate({ sceneId: scene.id, geometry });
        const s = useGridStore.getState();
        if (placed) s.select({ kind: 'camera', id: placed.id });
        s.openGmPanel();
      },
      onCameraSelect: (cameraId) => {
        const s = useGridStore.getState();
        s.select({ kind: 'camera', id: cameraId });
        s.openGmPanel();
      },
      // -- GM notes (FR9.25) -------------------------------------------------
      onNotePlace: (x, y) => {
        if (!scene || !isGm) return;
        const geometry = addNote(scene.geometry, { x, y });
        const placed = geometry.gmNotes?.[geometry.gmNotes.length - 1];
        patchGeometry.mutate({ sceneId: scene.id, geometry });
        const s = useGridStore.getState();
        if (placed) s.select({ kind: 'note', id: placed.id });
        s.openGmPanel();
      },
      onNoteSelect: (noteId) => {
        const s = useGridStore.getState();
        s.select({ kind: 'note', id: noteId });
        s.openGmPanel();
      },
    }),
    [commands, scene, isGm, patchGeometry, tilesets, doorOp, showDoorNotice],
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

  // Flipping between plan and isometric moves every world coordinate — the
  // same room lands somewhere else on screen — so the camera refits rather
  // than leaving the GM staring at the empty corner the old view was over.
  //
  // Only on a FLIP, though: keyed on the projection alone, this also fired
  // when a scene switch changed it, against a stage that was already torn
  // down for the new scene — and `fitScene` on a disposed renderer is a
  // crash that takes the whole page with it.
  const viewKey = `${viewScene?.id ?? ''}|${viewScene?.grid.projection ?? 'topdown'}`;
  const lastViewKey = useRef(viewKey);
  useEffect(() => {
    const prev = lastViewKey.current;
    lastViewKey.current = viewKey;
    const [prevScene, prevProjection] = prev.split('|');
    const [nextScene, nextProjection] = viewKey.split('|');
    if (prevScene === nextScene && prevProjection !== nextProjection) api?.fitScene();
  }, [api, viewKey]);

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

        {/*
          ONE top row, so the tools and the notices cannot overlap. They used to
          position themselves independently — left-3 and right-3 of the same
          corner — which worked until the tool row grew enough to reach across
          and cover the notices. A chip that is visible and unclickable is the
          worst of both: the GM can read the offer and nothing happens.
        */}
        <div className="pointer-events-none absolute inset-x-3 top-3 z-10 flex items-start justify-between gap-2">
          <Toolbar isGm={isGm} mode={store.mode} tool={store.tool} onMode={store.setMode} onTool={store.setTool} />

          <div className="flex shrink-0 flex-col items-end gap-1.5">
            <div className="flex items-center gap-1.5">
              <ViewControls
                isGm={isGm}
                snapEnabled={store.snapEnabled}
                gmPanelOpen={store.gmPanelOpen}
                viewProjection={store.viewProjection}
                sceneProjection={scene?.grid.projection ?? 'topdown'}
                onView={store.setViewProjection}
                onToggleSnap={store.toggleSnap}
                onToggleGmPanel={store.toggleGmPanel}
                onZoom={(f) => api?.zoomBy(f)}
                onFit={() => api?.fitScene()}
              />
              <span className="chip pointer-events-auto bg-panel/90 text-ink">
              {scene?.name ?? '…'}
              {scene && scene.id !== activeSceneId && (
                <span className="text-warn">staging</span>
              )}
              </span>
            </div>
            {/*
              Which floor is on screen, right on the canvas. The Map tab has the
              full list, but a GM two tabs away from it had no way to tell the
              catwalk from the warehouse below except by what was painted on
              it — and an empty new floor is painted with nothing.
            */}
            {isGm && scene && (scene.levels ?? []).length > 0 && (
              <div
                className="pointer-events-auto flex flex-wrap justify-end gap-1"
                role="group"
                aria-label="Floor on screen"
                data-testid="floor-chips"
              >
                {[GROUND_LEVEL_NAME, ...(scene.levels ?? []).map((l) => l.name)].map(
                  (name, i) => (
                    <button
                      key={i}
                      type="button"
                      aria-pressed={i === store.activeLevel}
                      onClick={() => store.setActiveLevel(i)}
                      className={
                        'chip bg-panel/90 ' +
                        (i === store.activeLevel ? 'border-cyan text-cyan' : 'text-dim')
                      }
                    >
                      {name}
                    </button>
                  ),
                )}
              </div>
            )}
            {focusNotice && <span className="chip bg-panel/90 text-cyan">{focusNotice}</span>}
            {doorNotice && (
              <span data-testid="door-notice" className="chip bg-panel/90 text-warn">
                {doorNotice}
              </span>
            )}
            {isGm && stairOffer && selectedToken && (
              <button
                type="button"
                data-testid="take-stairs"
                disabled={patchToken.isPending}
                onClick={takeStairs}
                className="chip pointer-events-auto bg-panel/90 text-cyan disabled:opacity-50"
              >
                {selectedToken.name} takes the stairs {stairOffer.direction} to{' '}
                {stairOffer.targetName}
              </button>
            )}
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
