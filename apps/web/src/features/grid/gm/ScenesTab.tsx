/**
 * Scene switcher + activate (FR9.1). Activating pushes the scene to every
 * player device and the table TV via `scene.activated` (§11).
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { Encounter, Scene } from '@safehouse/contracts';
import { useActivateScene, useCampaignEncounters, useCreateScene, useScenes, useStartFight } from '../api.js';
import { useGridStore } from '../store.js';
import { Empty, inputCls, PanelSection } from './ui.js';

/**
 * The fight this scene is part of, if any: the live one first, else the one
 * being prepped. A fight that is over is not "this scene's fight" any more.
 */
export function fightForScene(encounters: readonly Encounter[] | undefined, sceneId: string): Encounter | null {
  const here = (encounters ?? []).filter((e) => e.sceneId === sceneId && e.state !== 'done');
  return here.find((e) => e.state === 'live') ?? here[0] ?? null;
}

/**
 * One sentence on what players and the TV get from this scene's fog.
 *
 * Exported for its test: the three states are the whole point, and the
 * middle one — regions defined, none revealed — is the black screen.
 */
export function tableVisibility(scene: Scene): string {
  const { regions, revealed, revealedShapes } = scene.fog;
  if (regions.length === 0 && revealedShapes.length === 0) {
    return 'No fog on this scene — players and the TV see the whole map.';
  }
  const open = regions.filter((r) => revealed.includes(r.id)).length;
  if (open === 0 && revealedShapes.length === 0) {
    return 'Every fog region is hidden — players and the TV would see a black screen. Reveal one on the Fog tab before this goes live.';
  }
  return `Players see ${open} of ${regions.length} regions${revealedShapes.length > 0 ? ' plus what you have brushed open' : ''}; the rest is black to them.`;
}

export default function ScenesTab({
  campaignId,
  scene,
  activeSceneId,
}: {
  campaignId: string;
  scene: Scene;
  activeSceneId: string | null;
}) {
  const scenes = useScenes(campaignId);
  const create = useCreateScene(campaignId);
  const activate = useActivateScene();
  const encounters = useCampaignEncounters(campaignId);
  const startFight = useStartFight(campaignId);
  const setViewSceneId = useGridStore((s) => s.setViewSceneId);
  const [name, setName] = useState('');

  const list = scenes.data ?? [];
  const fight = fightForScene(encounters.data, scene.id);

  return (
    <>
      <PanelSection title="Scenes" hint={`${list.length}`}>
        {list.length === 0 && <Empty>no scenes yet</Empty>}
        <ul className="space-y-1">
          {list.map((s) => {
            const isActive = s.id === activeSceneId;
            const isViewed = s.id === scene.id;
            return (
              <li key={s.id} className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setViewSceneId(s.id)}
                  className={
                    'min-w-0 flex-1 truncate rounded border px-2 py-1 text-left text-xs ' +
                    (isViewed ? 'border-cyan text-cyan' : 'border-edge text-ink hover:border-edge-bright')
                  }
                  title={isViewed ? 'on screen' : 'stage this scene privately'}
                >
                  {s.name}
                  {isActive && <span className="mono-label ml-2 text-ok">live</span>}
                </button>
                <button
                  type="button"
                  className="btn py-1"
                  disabled={isActive || activate.isPending}
                  onClick={() => activate.mutate(s.id)}
                  title="Push this scene to players and the TV"
                >
                  {isActive ? 'live' : 'activate'}
                </button>
              </li>
            );
          })}
        </ul>
        {activeSceneId && scene.id !== activeSceneId && (
          <button
            type="button"
            className="btn w-full py-1"
            onClick={() => setViewSceneId(null)}
          >
            follow the live scene
          </button>
        )}
        {/*
          What the table would see if this scene went live right now. The one
          answer a GM cannot get from their own screen: their fog is a tint,
          the players' is a wall, and a scene with every region still hidden
          goes out as a black screen with no way to tell from here.
        */}
        <p className="text-xs text-faint" data-testid="scene-visibility">
          {tableVisibility(scene)}
        </p>
      </PanelSection>

      {/*
        FR9.10: the fight starts HERE, on the map the GM is already looking at.
        Every runner and NPC token on the scene becomes a combatant — hidden
        tokens as GM-only rows, an NPC placed from an archetype as a rolled
        body — and the tracker on the Table page takes it from there.
      */}
      <PanelSection title="Fight" hint="FR9.10">
        {fight ? (
          <>
            <p className="text-xs" data-testid="scene-fight">
              <span className="text-cyan">{fight.name}</span>{' '}
              <span className={`mono-label ${fight.state === 'live' ? 'text-ok' : 'text-faint'}`}>
                {fight.state === 'live' ? 'live' : 'prepped'}
              </span>
            </p>
            <div className="flex gap-1.5">
              <button
                type="button"
                className="btn flex-1 py-1"
                disabled={startFight.isPending}
                onClick={() => startFight.mutate({ sceneId: scene.id, encounterId: fight.id })}
                title="Tokens placed since the fight was staged join it as combatants"
              >
                add new tokens
              </button>
              <Link className="btn btn-accent flex-1 py-1 text-center" to={`/c/${campaignId}/table`}>
                open the tracker
              </Link>
            </div>
          </>
        ) : (
          <>
            <button
              type="button"
              className="btn btn-accent w-full py-1"
              data-testid="start-fight"
              disabled={startFight.isPending}
              onClick={() => startFight.mutate({ sceneId: scene.id, name: scene.name })}
            >
              start a fight from this scene’s tokens
            </button>
            <Empty>
              every runner and NPC token on this map becomes a combatant — hidden ones stay hidden — and
              the tracker on the Table page runs it from there.
            </Empty>
          </>
        )}
        {startFight.isError && <p className="mono-label text-danger">could not stage the fight — retry</p>}
      </PanelSection>

      <PanelSection title="New scene">
        <input
          className={inputCls}
          placeholder="Scene name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button
          type="button"
          className="btn btn-accent w-full py-1"
          disabled={!name.trim() || create.isPending}
          onClick={() =>
            create.mutate(
              { name: name.trim(), grid: { unitM: 1, cols: 40, rows: 30, offset: { x: 0, y: 0 }, projection: 'topdown' as const } },
              { onSuccess: (s: Scene) => { setName(''); setViewSceneId(s.id); } },
            )
          }
        >
          create
        </button>
      </PanelSection>
    </>
  );
}
