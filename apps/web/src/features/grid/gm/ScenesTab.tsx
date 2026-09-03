/**
 * Scene switcher + activate (FR9.1). Activating pushes the scene to every
 * player device and the table TV via `scene.activated` (§11).
 */
import { useState } from 'react';
import type { Scene } from '@safehouse/contracts';
import { useActivateScene, useCreateScene, useScenes } from '../api.js';
import { useGridStore } from '../store.js';
import { Empty, inputCls, PanelSection } from './ui.js';

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
  const setViewSceneId = useGridStore((s) => s.setViewSceneId);
  const [name, setName] = useState('');

  const list = scenes.data ?? [];

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
