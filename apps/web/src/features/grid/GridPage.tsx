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
  usePatchScene,
  useScene,
  useSceneTokens,
  useScenes,
} from './api.js';
import { GridCommands } from './commands.js';
import { rollScatter } from './geometry.js';
import GmPanel from './gm/GmPanel.js';
import MeasurePanel from './hud/MeasurePanel.js';
import Toolbar from './hud/Toolbar.js';
import {
  actingTokenId,
  barsByToken,
  draggableTokenIds,
  movementFrom,
  rangeReadout,
  rangedWeapons,
  type Viewer,
} from './projection.js';
import { useGridStore } from './store.js';
import type { RulerState, StageApi, StageCallbacks, StageSceneState } from './types.js';
import { useActiveSceneId, useLiveEncounter, useMarkStream, useRemoteDrags } from './useGridLive.js';
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
  // everyone else follows the campaign's active scene.
  const activeSceneId =
    liveActiveSceneId ?? scenesQuery.data?.find((s) => s.state === 'active')?.id ?? null;
  const sceneId = (isGm ? store.viewSceneId : null) ?? activeSceneId;

  const sceneQuery = useScene(sceneId);
  const tokensQuery = useSceneTokens(sceneId);
  useGridLiveSync(sceneId);

  const scene: Scene | null = sceneQuery.data ?? null;
  const tokens: Token[] = useMemo(() => tokensQuery.data ?? [], [tokensQuery.data]);
  const encounter = useLiveEncounter();
  const drags = useRemoteDrags();
  const patchScene = usePatchScene();

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

  const draggableIds = useMemo(() => draggableTokenIds(tokens, viewer), [tokens, viewer]);
  const bars = useMemo(() => barsByToken(encounter, tokens, viewer), [encounter, tokens, viewer]);
  const actingId = useMemo(() => actingTokenId(encounter), [encounter]);

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

  const stageState: StageSceneState | null = useMemo(() => {
    if (!scene) return null;
    return {
      scene,
      tokens,
      role: viewer.role,
      draggableIds,
      bars,
      actingTokenId: actingId,
      selectedTokenId: store.selectedTokenId,
      tool: store.tool,
      snapEnabled: store.snapEnabled,
      aoe: store.aoe,
      scatter: store.scatter,
      fogDraft: store.fogDraft,
    };
  }, [
    scene,
    tokens,
    viewer.role,
    draggableIds,
    bars,
    actingId,
    store.selectedTokenId,
    store.tool,
    store.snapEnabled,
    store.aoe,
    store.scatter,
    store.fogDraft,
  ]);

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
        const doors = scene.geometry.doors.map((d) =>
          d.id === doorId ? { ...d, open: !d.open } : d,
        );
        patchScene.mutate({
          sceneId: scene.id,
          patch: { geometry: { ...scene.geometry, doors } },
        });
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
    }),
    [commands, scene, isGm, patchScene],
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
