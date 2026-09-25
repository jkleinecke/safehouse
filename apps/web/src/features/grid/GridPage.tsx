/**
 * /c/:campaignId/grid — the tactical scene canvas (DESIGN.md M9, P2 scope).
 *
 * This file is the wiring: it resolves which scene is on screen, projects
 * server + live state into `StageSceneState`, and routes stage callbacks to WS
 * commands. All rendering lives in the lazily-imported `stage/` chunk.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { Scene, Token } from '@safehouse/contracts';
import {
  GROUND_LEVEL_NAME,
  VISION_MODE_LABELS,
  deriveCharacter,
  levelTiles,
  objectCoverage,
  propCoverage,
  tileById,
} from '@safehouse/rules';
import { useMyCharacterId } from '../../api/campaigns.js';
import { ApiError } from '../../api/client.js';
import { getSession } from '../../api/session.js';
import { getLiveSocket } from '../../live/socket.js';
import {
  fileUrl,
  useDeleteToken,
  useDoorOp,
  useGridLiveSync,
  usePatchGeometry,
  usePatchScene,
  usePatchToken,
  useRefetchOnReconnect,
  useScene,
  useSceneTokens,
  useScenes,
  usePaintBatch,
  usePaintTiles,
  useTilesets,
  useActivateScene,
  tileDefsFrom,
  TileStrokeBuffer,
} from './api.js';
import { GridCommands } from './commands.js';
import { metersBetween, metricsFor, rollScatter } from './geometry.js';
import {
  addCamera,
  addDoor,
  addNote,
  addPin,
  addWall,
  convertWallToDoor,
  removeDoor,
  removeWall,
  tileDoorOpen,
} from './geometryEdit.js';
import GmPanel from './gm/GmPanel.js';
import ContextMenu from './hud/ContextMenu.js';
import { contextMenuItems, type ContextMenuActions, type ContextMenuInput } from './hud/contextMenuItems.js';
import MeasurePanel from './hud/MeasurePanel.js';
import PlayRail from './hud/PlayRail.js';
import { availableModes, clampMode } from './hud/eyes.js';
import ModeBar from './hud/ModeBar.js';
import FloorMenu from './hud/FloorMenu.js';
import MapImageButton from './hud/MapImageButton.js';
import TokenLayersMenu from './hud/TokenLayersMenu.js';
import PlacingGroup from './hud/PlacingGroup.js';
import TilesetBar from './hud/TilesetBar.js';
import Toolbar, { ViewControls } from './hud/Toolbar.js';
import { useGridShortcuts } from './hud/useGridShortcuts.js';
import { composeStageState, resolveSceneId } from './hydration.js';
import { useCharacter } from '../sheet/api.js';
import {
  movementFrom,
  rangeReadout,
  rangedWeapons,
  type Viewer,
} from './projection.js';
import { autoTileFor, topLayerAt } from './autoPlace.js';
import { roomPlan, roomTileIds } from './roomFill.js';
import { useCameraCones } from './useCameraCones.js';
import { useShroud } from './useShroud.js';
import { stairAdvice, useStairOffer } from './useStairs.js';
import { historyFor, useHistory } from './history.js';
import { useGridStore } from './store.js';
import {
  boxSelect,
  moveSelection,
  pasteBodies,
  pastedSet,
  setOfObject,
  tilesetOf,
  toggleObject,
} from './cellSelection.js';
import { objectForSelection, parsePaintedId, pickPainted } from './paintedObjects.js';
import {
  type ContextMenuRequest,
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
        <div className="mono-label text-cyan">Map</div>
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
  // Isometric is how the table is meant to see the map: a player's screen
  // opens on it whatever the scene is saved as (the GM's opens on the scene's
  // own setting, which is where rooms get built). Only a view — they can flip.
  useEffect(() => {
    if (!isGm && useGridStore.getState().viewProjection === 'scene') {
      useGridStore.getState().setViewProjection('iso');
    }
  }, [isGm]);
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
  // The scene a GM was staging can go away under them — deleted from another
  // device, or by hand through the API. Falling back to the live scene beats
  // "Scene unavailable" with no way out but a reload, because the panel that
  // holds "follow the live scene" is not drawn without a scene.
  const viewSceneGone = sceneQuery.isError && store.viewSceneId !== null;
  const { setViewSceneId } = store;
  useEffect(() => {
    if (viewSceneGone) setViewSceneId(null);
  }, [viewSceneGone, setViewSceneId]);
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
  // Stable across renders, so the stage callbacks can hold it without going stale.
  const paintMutate = paintTiles.mutate;
  // A move, paste or delete of a multi-selection: a request per layer, one
  // undo step (`usePaintBatch`).
  const paintBatch = usePaintBatch().mutate;
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
  // Squares the furniture laid in the stroke under way covers: the brush
  // steps over them, so a dragged desk brush lays desks side by side rather
  // than a desk on every square it crosses.
  const strokeCovered = useRef(new Set<string>());


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
  // The eyes the viewer may look through (docs/VISION.md §4.5): a player's
  // own sheet decides; the GM sees every mode the canvas can draw.
  const ownCharacter = useCharacter(isGm ? null : myCharacterId);
  const eyes = useMemo(
    () => availableModes(isGm, ownCharacter.data?.sheet ?? null),
    [isGm, ownCharacter.data?.sheet],
  );
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
  // Where a stair painted here could lead — only while the stairs are in
  // hand, which is the only time it answers anything.
  const stairs =
    scene && store.mode === 'build' && store.tileCategory === 'stairs'
      ? stairAdvice(scene, store.activeLevel)
      : null;
  const patchToken = usePatchToken(sceneId);
  const patchScene = usePatchScene();

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
   * This screen's plan/iso choice is a view, not an edit: it overrides the
   * grid's projection on the way to the canvas and nowhere else, so everyone
   * else keeps their own view — the GM lays rooms out in plan while a player
   * watches in iso, or the other way round.
   */
  const viewScene = useMemo(() => {
    if (!scene || store.viewProjection === 'scene') return scene;
    if (scene.grid.projection === store.viewProjection) return scene;
    return { ...scene, grid: { ...scene.grid, projection: store.viewProjection } };
  }, [scene, store.viewProjection]);

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
  useGridShortcuts(isGm, 1 + (scene?.levels?.length ?? 0), scene?.id ?? null, scene ?? null);
  // Undo and redo for the toolbar (`history.ts`): the next step each way, for
  // the scene on screen, and whether one is in flight.
  const historyPast = useHistory((s) => s.past);
  const historyFuture = useHistory((s) => s.future);
  const historyBusy = useHistory((s) => s.busy);
  const steps = useMemo(
    () => historyFor(scene?.id),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [historyPast, historyFuture, scene?.id],
  );

  const stageState: StageSceneState | null = useMemo(
    () => {
      const composed = composeStageState({
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
      });
      // Building: painted walls, doors and furniture are picked up and
      // dragged rather than used. Nowhere else — a painted door in Play is
      // a door, and clicking it opens it.
      const building = isGm && store.mode === 'build';
      return composed
        ? {
            ...composed,
            paintEdit: building,
            cellSelection: building ? store.cellSelection : null,
            pasting: building && store.pasting ? store.clipboard : null,
          }
        : composed;
    },
    [
      isGm,
      store.mode,
      store.cellSelection,
      store.pasting,
      store.clipboard,
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
  const activateScene = useActivateScene();
  const apiRef = useRef<StageApi | null>(null);
  // The context menu (UX proposal 4.1): the stage says what was right-clicked
  // and where; the page decides the verbs and draws the list.
  const [menu, setMenu] = useState<ContextMenuRequest | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const deleteToken = useDeleteToken(scene?.id);
  const navigate = useNavigate();

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
        const key = `${col},${row}`;
        // Furniture covers as many squares as it is big (rules: footprint.ts).
        const floor = levelTiles(scene, st.activeLevel);
        const unitM = scene.grid.unitM ?? 1;
        const covering = floor
          ? objectCoverage(floor.object, unitM, (v) => tileById(floor.tilesetId, v)?.prop).get(key)
          : undefined;
        const prop = placing === null ? undefined : tileById(st.tilesetId, placing)?.prop;
        if (!erase && prop !== undefined) {
          // Not inside a piece already standing here, nor one laid earlier in
          // this stroke; a piece's own square it may replace.
          if ((covering !== undefined && covering !== key) || strokeCovered.current.has(key)) return;
          for (const k of propCoverage(prop, col, row, unitM)) strokeCovered.current.add(k);
        }
        // The eraser on any square a piece covers takes the piece.
        if (erase && covering !== undefined && covering !== key) {
          strokeRef.current?.add(scene.id, st.tilesetId, covering, null, st.activeLevel, 'object');
          return;
        }
        // The eraser takes the top thing out of the square — a prop first,
        // then the wall, then the floor — one pass per layer, never the lot.
        const top = erase ? topLayerAt(floor, key) : undefined;
        if (erase && top === null) return;
        strokeRef.current?.add(
          scene.id,
          st.tilesetId,
          key,
          placing,
          st.activeLevel,
          top === undefined || top === null || top === 'all' ? undefined : top,
        );
      },
      onTileStrokeEnd: () => {
        strokeCovered.current.clear();
        strokeRef.current?.flush();
      },
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
        // One step in the history: a room is two strokes, floor then walls,
        // and one Ctrl+Z should take the whole room.
        const history = useHistory.getState();
        history.beginGroup(sceneId, mode === 'room' ? 'draw a room' : 'fill an area');
        void (async () => {
          try {
            await send(plan.floor, floorId);
            if (plan.walls.length > 0 && wallId !== null) await send(plan.walls, wallId);
          } catch {
            setTileNotice('that room did not save — draw it again');
          } finally {
            history.endGroup();
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
      onSelectClear: () => {
        const s = useGridStore.getState();
        s.select(null);
        s.setCellSelection(null);
      },
      onContextMenu: (request) => setMenu(request),
      // -- Multi-selection, copy and paste (Build) ----------------------------
      onBoxSelect: (a, b, everything) => {
        if (!scene) return;
        const s = useGridStore.getState();
        // A box over nothing painted lets go, like a click on open floor.
        const sel = boxSelect(scene, s.activeLevel, a, b, everything);
        s.setCellSelection(sel);
        if (!sel) s.select(null);
        else s.openGmPanel();
      },
      onPaintedToggle: (id) => {
        if (!scene) return;
        const s = useGridStore.getState();
        const parsed = parsePaintedId(id);
        const obj = parsed ? pickPainted(scene, s.activeLevel, parsed.cell, parsed.layer) : null;
        if (!obj) return;
        // A single object already selected joins the set first, so Shift+
        // clicking a second wall means "these two", not "only the second".
        let base = s.cellSelection;
        if (!base && s.selected?.kind === 'painted') {
          const first = objectForSelection(scene, s.activeLevel, s.selected.id);
          if (first) base = setOfObject(first, s.activeLevel);
        }
        const next = toggleObject(base, obj, s.activeLevel);
        if (next) s.setCellSelection(next);
        else {
          s.setCellSelection(null);
          s.select(null);
        }
        s.openGmPanel();
      },
      onCellSelectionMove: (dc, dr) => {
        if (!scene || !isGm) return;
        const s = useGridStore.getState();
        const sel = s.cellSelection;
        if (!sel) return;
        // Its walls stretch the walls they meet, as one wall does.
        const move = moveSelection(scene, sel, dc, dr);
        if (move.bodies.length === 0) return;
        const store0 = useGridStore.getState;
        paintBatch(
          {
            sceneId: scene.id,
            bodies: move.bodies,
            label: 'move the selection',
            // Undo takes the selection back to where the squares went back to.
            restore: {
              undo: () => store0().setCellSelection(sel),
              redo: () => store0().setCellSelection(move.sel),
            },
          },
          // Keep hold of what moved, and what grew out of it.
          { onSuccess: () => useGridStore.getState().setCellSelection(move.sel) },
        );
      },
      onPaste: (at) => {
        if (!scene || !isGm) return;
        const s = useGridStore.getState();
        const clip = s.clipboard;
        s.setPasting(false);
        const tilesetId = tilesetOf(scene, s.activeLevel);
        if (!clip || !tilesetId) return;
        const bodies = pasteBodies(clip, at, s.activeLevel, tilesetId);
        if (bodies.length === 0) return;
        const landed = pastedSet(clip, at, s.activeLevel);
        paintBatch(
          {
            sceneId: scene.id,
            bodies,
            label: 'paste',
            // An undone paste has nothing left to hold on to.
            restore: {
              undo: () => useGridStore.getState().setCellSelection(null),
              redo: () => useGridStore.getState().setCellSelection(landed),
            },
          },
          // What was just pasted is what is selected: a paste is usually
          // followed by a nudge into place.
          { onSuccess: () => useGridStore.getState().setCellSelection(landed) },
        );
      },
      // -- Painted walls, doors and furniture (Build) -------------------------
      onPaintedSelect: (id) => {
        const s = useGridStore.getState();
        s.select({ kind: 'painted', id });
        s.openGmPanel();
      },
      // One drag, one request, one undo step: the delta erases where it was
      // and paints where it went, in a single stroke the history can reverse.
      onPaintedEdit: (delta, anchorId, tilesetId) => {
        if (!scene || !isGm) return;
        const s0 = useGridStore.getState();
        const level = s0.activeLevel;
        const was = s0.selected;
        paintMutate(
          {
            sceneId: scene.id,
            tilesetId,
            level,
            paint: delta.paint,
            erase: delta.erase,
            layer: delta.layer,
            // Undo takes the ring back to the wall it moved back to.
            restore: {
              undo: () => useGridStore.getState().select(was),
              redo: () => useGridStore.getState().select({ kind: 'painted', id: anchorId }),
            },
          },
          {
            // Keep hold of what was moved: the old anchor may now be empty
            // floor, and a GM who slid a wall wants to slide it again.
            onSuccess: () => useGridStore.getState().select({ kind: 'painted', id: anchorId }),
          },
        );
      },
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
    [commands, scene, isGm, patchGeometry, tilesets, doorOp, showDoorNotice, paintMutate, paintBatch],
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

  // The verbs behind the context menu are the mutations the panel tabs and
  // the inspector already call — the menu is a shorter road to them, not a
  // second set of rules.
  const menuActions: ContextMenuActions = {
    ping: (x, y) => commands.ping(x, y),
    focus: (x, y) => callbacks.onFocus(x, y),
    centerOn: (x, y) => api?.centerOn(x, y),
    rangeBetween: (from, to) => {
      if (!scene) return;
      const m = metricsFor(scene.grid);
      const s = useGridStore.getState();
      s.setTool('ruler');
      s.setRuler({
        from: { x: from.x, y: from.y },
        to: { x: to.x, y: to.y },
        meters: metersBetween(m, from, to),
        fromTokenId: from.id,
      });
    },
    openSheet: (characterId) => navigate(`/c/${campaignId}/sheet/${characterId}`),
    setHidden: (tokenId, hidden) => patchToken.mutate({ tokenId, patch: { hidden } }),
    removeToken: (tokenId) => deleteToken.mutate(tokenId),
    doorOp: (input) => doorOp.mutate(input, { onError: showDoorNotice }),
    pinHere: (x, y) => callbacks.onPinPlace?.(x, y),
    noteHere: (x, y) => callbacks.onNotePlace?.(x, y),
    cameraHere: (x, y) => callbacks.onCameraPlace?.(x, y),
    placeTokenHere: (x, y) => {
      const s = useGridStore.getState();
      // Half-square precision: the centre of the cell the GM pointed at.
      s.setPlaceAt({ x: Math.floor(x) + 0.5, y: Math.floor(y) + 0.5 });
      s.setGmTab('tokens');
      s.openGmPanel();
    },
    revealRegion: (regionId) => {
      if (scene) commands.fogReveal(scene.id, regionId, true);
    },
    hideRegion: (regionId) => {
      if (scene) commands.fogHide(scene.id, regionId);
    },
    wallToDoor: (wallId) => {
      if (scene) patchGeometry.mutate({ sceneId: scene.id, geometry: convertWallToDoor(scene.geometry, wallId) });
    },
    removeWall: (wallId) => {
      if (scene) patchGeometry.mutate({ sceneId: scene.id, geometry: removeWall(scene.geometry, wallId) });
    },
    removeDoor: (doorId) => {
      if (scene) patchGeometry.mutate({ sceneId: scene.id, geometry: removeDoor(scene.geometry, doorId) });
    },
    // One square out of a painted wall: the run it was in becomes two, each
    // of which can then be selected and slid on its own.
    breakWall: (cell, level) => {
      if (!scene) return;
      const tilesetId = levelTiles(scene, level)?.tilesetId;
      if (!tilesetId) return;
      // What was selected may have been the run just cut in two; its anchor
      // could now be the gap. Let go rather than ring half a wall.
      const s = useGridStore.getState();
      if (s.selected?.kind === 'painted') s.select(null);
      paintMutate({ sceneId: scene.id, tilesetId, level, paint: {}, erase: [cell], layer: 'structure' });
    },
  };
  // The canvas draws for the chosen eyes; a mode the sheet stops granting
  // falls back to normal rather than lingering as a thermal view.
  const viewMode = clampMode(store.viewMode, eyes);
  useEffect(() => {
    api?.setViewMode(viewMode);
  }, [api, viewMode]);

  const menuRole: ContextMenuInput['role'] =
    viewer.role === 'gm' || viewer.role === 'player' ? viewer.role : 'observer';
  const menuItems =
    menu && scene
      ? contextMenuItems({
          role: menuRole,
          target: menu.target,
          grid: menu.grid,
          scene,
          tokens,
          selectedTokenId: store.selectedTokenId,
          myCharacterId: myCharacterId ?? null,
          actions: menuActions,
          ...(isGm ? { mode: store.mode } : {}),
        })
      : [];
  const menuAbout = (() => {
    if (!menu) return '';
    const t = menu.target;
    if (t.kind === 'token') return tokens.find((k) => k.id === t.id)?.name ?? 'token';
    if (t.kind === 'door' || t.kind === 'tileDoor') return 'the door';
    if (t.kind === 'wall') return 'the wall';
    return `square ${Math.floor(menu.grid.x)}, ${Math.floor(menu.grid.y)}`;
  })();

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
    return <EmptyState title="No device token" body="Scan the GM's join QR to reach the Map." />;
  }
  if (!sceneId) {
    return (
      <EmptyState
        title="No active scene"
        body={
          isGm
            ? 'Create a scene on the Scenes page, then open it on the Map.'
            : 'The GM has not put a scene on the table yet.'
        }
      />
    );
  }
  if (sceneQuery.isError) {
    return <EmptyState title="Scene unavailable" body="The server did not return this scene." />;
  }

  return (
    /*
      The header first — the mode row with that mode's tools attached under
      it — then the map and its panels below. Build · Prep · Play change what
      everything else offers, so they get the full width and nothing shares
      their row (docs/UX_MAP_BUILDER.md §3.1); the tools follow directly
      beneath, where the choice that produced them is still in view.
    */
    <div className="flex h-full min-h-[70dvh] w-full flex-col">
      <header className="z-20 flex shrink-0 flex-col">
        {isGm && (
          <ModeBar
            mode={store.mode}
            onMode={store.setMode}
            scene={
              <span className="chip max-w-56 bg-panel/90 text-ink" data-testid="scene-chip">
                <span className="truncate">{scene?.name ?? '…'}</span>
                {scene && scene.id !== activeSceneId && <span className="text-warn">staging</span>}
              </span>
            }
            floor={scene ? <FloorMenu scene={scene} /> : undefined}
            // Tokens are prep work — placed with the scene's encounter, not
            // while the floor they stand on is being laid.
            tokenLayers={scene && store.mode !== 'build' ? <TokenLayersMenu scene={scene} /> : undefined}
            live={!!scene && scene.id === activeSceneId}
            tileset={store.mode === 'build' && scene ? <TilesetBar scene={scene} /> : undefined}
            history={{
              undoLabel: steps.undo?.label ?? null,
              redoLabel: steps.redo?.label ?? null,
              busy: historyBusy,
              onUndo: () => void useHistory.getState().undo(),
              onRedo: () => void useHistory.getState().redo(),
            }}
          />
        )}
        <Toolbar
          isGm={isGm}
          mode={store.mode}
          tool={store.tool}
          onTool={store.setTool}
          // What is being placed, each subject carrying the tile it lays:
          // Build mode's first step, and only a GM building has it.
          placing={isGm ? <PlacingGroup /> : undefined}
          mapImage={isGm && scene ? <MapImageButton scene={scene} /> : undefined}
        />
      </header>
      <div className="flex min-h-0 w-full flex-1 flex-col xl:flex-row">
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
          What is left on the canvas: the view controls and the notices, in one
          column down the top-right. The tools moved into the header, so
          nothing here can be covered by a tool row that grew — a chip that is
          visible and unclickable is the worst of both, the GM reads the offer
          and nothing happens.
        */}
        <div className="pointer-events-none absolute inset-x-3 top-3 z-10 flex flex-wrap items-start justify-end gap-2 sm:flex-nowrap">
          <div className="flex min-w-0 max-w-full shrink flex-col items-end gap-1.5">
            <div className="flex flex-wrap items-center justify-end gap-1.5">
              <ViewControls
                // No panel toggle in Build: there the panel follows the
                // selection, and a button that opens it empty does nothing.
                isGm={isGm && store.mode !== 'build'}
                snapEnabled={store.snapEnabled}
                gmPanelOpen={store.gmPanelOpen}
                // The GM sets the scene's own projection — the table follows
                // it. A player sets their own screen, which is the only thing
                // they can change; the two never meant the same thing and now
                // there is one control each rather than one of each.
                projection={viewScene?.grid.projection ?? 'topdown'}
                projectionTitle={isGm ? 'How the table draws this scene' : 'How this screen draws the map'}
                onProjection={
                  scene
                    ? (projection) => {
                        if (isGm) {
                          patchScene.mutate({
                            sceneId: scene.id,
                            patch: { grid: { ...scene.grid, projection } },
                          });
                        } else {
                          store.setViewProjection(projection);
                        }
                      }
                    : undefined
                }
                onToggleSnap={store.toggleSnap}
                onToggleGmPanel={store.toggleGmPanel}
                onZoom={(f) => api?.zoomBy(f)}
                onFit={() => api?.fitScene()}
              />
            </div>
            {/*
              Putting the scene on the table, where the scene's own name is.
              It used to head a checklist of Map / Grid / Walls / Fog chips,
              which read as filters rather than as steps, and sat beside a
              "✓ on the table" chip that said the same thing the Live chip
              now says once, on the mode bar (2026-09-20).
            */}
            {isGm && scene && campaignId && scene.id !== activeSceneId && (
              <button
                type="button"
                data-testid="activate-scene"
                disabled={activateScene.isPending}
                title="Push this scene to every player device and the TV"
                onClick={() =>
                  activateScene.mutate(scene.id, {
                    onSuccess: () => {
                      setFocusNotice('scene pushed to the table');
                      window.setTimeout(() => setFocusNotice(null), 2400);
                    },
                  })
                }
                className="chip pointer-events-auto border-cyan bg-panel/90 text-cyan disabled:opacity-50"
              >
                put on the table →
              </button>
            )}
            {focusNotice && <span className="chip bg-panel/90 text-cyan">{focusNotice}</span>}
            {/*
              Eyes (docs/VISION.md §4.5): the modes this viewer can look
              through. A player whose runner has only normal sight gets no
              switch at all — there is nothing to switch to.
            */}
            {eyes.length > 1 && (
              <div
                className="pointer-events-auto flex items-center gap-1"
                data-testid="eyes-switch"
              >
                <span className="chip bg-panel/90 text-faint" aria-hidden>
                  eyes
                </span>
                {/*
                  One control with a current value, not a row of chips that
                  grew with every cyberware option: a runner with thermo,
                  low-light and ultrasound had four to read across.
                */}
                <select
                  aria-label="Eyes"
                  data-testid="eyes-select"
                  title="Which eyes you are looking through"
                  value={viewMode}
                  onChange={(e) => store.setViewMode(e.target.value as typeof viewMode)}
                  className="min-h-8 rounded border border-edge bg-panel/90 px-1.5 py-0.5 text-[0.7rem] text-ink"
                >
                  {eyes.map((m) => (
                    <option key={m} value={m}>
                      {VISION_MODE_LABELS[m]}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {!store.playRailOpen && (isGm ? store.mode === 'play' : true) && (
              <button
                type="button"
                data-testid="play-rail-open"
                className="chip pointer-events-auto hidden bg-panel/90 text-dim hover:text-ink md:inline-flex"
                title="The initiative tracker and the session log, beside the map"
                onClick={store.togglePlayRail}
              >
                tracker · log
              </button>
            )}
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
            {tileNotice && (
              <span data-testid="tile-notice" className="chip bg-panel/90 text-danger">
                {tileNotice}
              </span>
            )}
            {/*
              Where a stair here could lead — and, on a one-floor scene, that
              it can lead nowhere at all, which is the difference between a
              dead tool and a missing floor. Only while the stairs are in
              hand, which is the only time it is an answer to anything.
            */}
            {isGm && stairs && (
              <span
                data-testid="stair-advice"
                className={'chip max-w-80 bg-panel/90 ' + (stairs.up || stairs.down ? 'text-dim' : 'text-warn')}
              >
                {stairs.text}
              </span>
            )}
          </div>
        </div>

        {menu && menuItems.length > 0 && (
          <ContextMenu
            x={menu.screen.x}
            y={menu.screen.y}
            about={menuAbout}
            items={menuItems}
            onClose={closeMenu}
          />
        )}

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

      {/*
        The fight rail (UX proposal 4.1): the tracker over the log, beside
        the canvas, for the GM in Play mode and for every player. The GM
        panel keeps Build and Prep; a fight is run from here.
      */}
      {campaignId && scene && store.playRailOpen && (isGm ? store.mode === 'play' : true) && (
        <PlayRail campaignId={campaignId} onCollapse={store.togglePlayRail} />
      )}

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
    </div>
  );
}
