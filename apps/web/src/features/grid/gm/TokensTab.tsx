/**
 * Token placement + per-token GM controls (FR9.4/9.6/9.7), and token layers
 * (FR9.26): a whole ambush behind one switch.
 *
 * Hiding a token — by its own flag or by its layer — is a server-side
 * concern: the hub stops sending its position to player/display sockets
 * entirely (Principle 4). These buttons just ask.
 */
import { useState } from 'react';
import type { Scene, Token } from '@safehouse/contracts';
import {
  useCharacters,
  useDeleteToken,
  useNpcTemplates,
  usePatchScene,
  usePatchToken,
  usePlaceToken,
} from '../api.js';
import { useGridStore } from '../store.js';
import {
  addLayer,
  assignToken,
  hiddenLayerTokenIds,
  layerOfToken,
  layersOf,
  removeLayer,
  renameLayer,
  setLayerHidden,
  type TokenLayers,
} from '../tokenLayers.js';
import { Empty, inputCls, Num, PanelSection, Row } from './ui.js';

type PlaceKind = 'character' | 'npc_template' | 'prop';

export default function TokensTab({
  campaignId,
  scene,
  tokens,
  onCenter,
}: {
  campaignId: string;
  scene: Scene;
  tokens: Token[];
  onCenter: (x: number, y: number) => void;
}) {
  const place = usePlaceToken();
  const patch = usePatchToken(scene.id);
  const remove = useDeleteToken(scene.id);
  const patchScene = usePatchScene();
  const selectedTokenId = useGridStore((s) => s.selectedTokenId);
  const selectToken = useGridStore((s) => s.selectToken);
  // The floor the GM is LOOKING at. Placing on the catwalk while hardcoding
  // level 0 dropped the new token into the warehouse below, where — one floor
  // being drawn at a time — it was invisible.
  const activeLevel = useGridStore((s) => s.activeLevel);

  const [kind, setKind] = useState<PlaceKind>('character');
  const [sourceId, setSourceId] = useState('');
  const [propName, setPropName] = useState('');
  const [size, setSize] = useState(1);
  const [newLayerName, setNewLayerName] = useState('');

  const characters = useCharacters(campaignId, kind === 'character');
  const templates = useNpcTemplates(campaignId, kind === 'npc_template');

  const center = { x: scene.grid.cols / 2, y: scene.grid.rows / 2 };
  const layers = layersOf(scene);
  const layerHidden = hiddenLayerTokenIds(layers);
  const saveLayers = (next: TokenLayers) =>
    patchScene.mutate({ sceneId: scene.id, patch: { tokenLayers: [...next] } });

  const doPlace = () => {
    const opts = kind === 'character' ? (characters.data ?? []) : (templates.data ?? []);
    const picked = opts.find((o) => o.id === sourceId);
    const name =
      kind === 'prop'
        ? propName.trim() || 'Prop'
        : ((picked as { name?: string; alias?: string } | undefined)?.name ??
          (picked as { alias?: string } | undefined)?.alias ??
          'Token');
    if (kind !== 'prop' && !sourceId) return;
    place.mutate({
      sceneId: scene.id,
      token: {
        source: kind,
        sourceId: kind === 'prop' ? null : sourceId,
        name,
        x: center.x,
        y: center.y,
        size,
        hidden: kind !== 'character',
        level: activeLevel,
        barsVisibility: kind === 'character' ? 'owner' : 'gm',
      },
    });
    setPropName('');
  };

  const selected = tokens.find((t) => t.id === selectedTokenId) ?? null;

  return (
    <>
      <PanelSection title="Place token">
        <Row label="From">
          <select
            className={inputCls}
            value={kind}
            onChange={(e) => {
              setKind(e.target.value as PlaceKind);
              setSourceId('');
            }}
          >
            <option value="character">character</option>
            <option value="npc_template">NPC template</option>
            <option value="prop">prop</option>
          </select>
        </Row>
        {kind === 'prop' ? (
          <Row label="Name">
            <input
              className={inputCls}
              value={propName}
              placeholder="Crate, van, barricade…"
              onChange={(e) => setPropName(e.target.value)}
            />
          </Row>
        ) : (
          <Row label="Source">
            <select className={inputCls} value={sourceId} onChange={(e) => setSourceId(e.target.value)}>
              <option value="">— pick —</option>
              {(kind === 'character' ? (characters.data ?? []) : (templates.data ?? [])).map((o) => (
                <option key={o.id} value={o.id}>
                  {('name' in o && o.name) || ('alias' in o && o.alias) || o.id}
                </option>
              ))}
            </select>
          </Row>
        )}
        <Row label="Size">
          <Num value={size} min={1} step={1} onChange={(n) => setSize(Math.max(1, Math.round(n)))} />
        </Row>
        <button
          type="button"
          className="btn btn-accent w-full py-1"
          disabled={place.isPending || (kind !== 'prop' && !sourceId)}
          onClick={doPlace}
        >
          place at centre
        </button>
        {kind === 'npc_template' && templates.isError && (
          <Empty>no NPC template endpoint yet — place a prop instead</Empty>
        )}
      </PanelSection>

      <PanelSection title="Layers" hint={`${layers.length}`}>
        <Empty>
          a layer is a set of tokens behind one switch — hide the ambush, show it when the shooting
          starts. A token on a hidden layer is off the players&apos; table however its own flag is set.
        </Empty>
        {layers.length === 0 && <Empty>no layers yet</Empty>}
        <ul className="space-y-1" data-testid="layer-list">
          {layers.map((layer) => (
            <li
              key={layer.id}
              data-layer={layer.id}
              data-hidden={layer.hidden ? 'yes' : 'no'}
              className={
                'flex items-center gap-1.5 rounded border px-2 py-1 ' +
                (layer.hidden ? 'border-magenta/60' : 'border-edge')
              }
            >
              <input
                className={inputCls + ' min-w-0 flex-1'}
                value={layer.name}
                aria-label="layer name"
                onChange={(e) => saveLayers(renameLayer(layers, layer.id, e.target.value))}
              />
              <span className="mono-label text-faint">{layer.tokenIds.length}</span>
              <button
                type="button"
                className={'btn px-2 py-1 ' + (layer.hidden ? 'btn-accent' : '')}
                aria-pressed={layer.hidden}
                data-testid={`layer-toggle-${layer.id}`}
                title={layer.hidden ? 'Show every token on this layer' : 'Hide every token on this layer'}
                onClick={() => saveLayers(setLayerHidden(layers, layer.id, !layer.hidden))}
              >
                {layer.hidden ? 'show' : 'hide'}
              </button>
              <button
                type="button"
                className="btn px-2 py-1"
                title="Delete the layer (its tokens stay on the map)"
                onClick={() => saveLayers(removeLayer(layers, layer.id))}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
        <div className="flex gap-1.5">
          <input
            className={inputCls + ' min-w-0 flex-1'}
            value={newLayerName}
            placeholder="Ambush, second wave, HTR team…"
            aria-label="new layer name"
            onChange={(e) => setNewLayerName(e.target.value)}
          />
          <button
            type="button"
            className="btn px-2 py-1"
            data-testid="layer-add"
            disabled={patchScene.isPending}
            onClick={() => {
              saveLayers(addLayer(layers, newLayerName));
              setNewLayerName('');
            }}
          >
            add layer
          </button>
        </div>
        {patchScene.isError && <p className="mono-label text-danger">layers not saved — retry</p>}
      </PanelSection>

      <PanelSection title="On this scene" hint={`${tokens.length}`}>
        {tokens.length === 0 && <Empty>nothing placed</Empty>}
        <ul className="space-y-1">
          {tokens.map((t) => (
            <li
              key={t.id}
              className={
                'flex items-center gap-1.5 rounded border px-2 py-1 ' +
                (t.id === selectedTokenId ? 'border-cyan' : 'border-edge')
              }
            >
              <button
                type="button"
                className="min-w-0 flex-1 truncate text-left text-xs"
                onClick={() => {
                  selectToken(t.id);
                  onCenter(t.x, t.y);
                }}
              >
                {t.name}
                {t.hidden && <span className="mono-label ml-2 text-magenta">hidden</span>}
                {!t.hidden && layerHidden.has(t.id) && (
                  <span className="mono-label ml-2 text-magenta">layer hidden</span>
                )}
              </button>
              {layers.length > 0 && (
                <select
                  className={inputCls + ' w-24'}
                  value={layerOfToken(layers, t.id)?.id ?? ''}
                  aria-label={`layer for ${t.name}`}
                  title="Which layer this token is on"
                  onChange={(e) => saveLayers(assignToken(layers, t.id, e.target.value || null))}
                >
                  <option value="">no layer</option>
                  {layers.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              )}
              <button
                type="button"
                className="btn px-2 py-1"
                title={t.hidden ? 'Reveal to players' : 'Hide from players'}
                onClick={() => patch.mutate({ tokenId: t.id, patch: { hidden: !t.hidden } })}
              >
                {t.hidden ? 'reveal' : 'hide'}
              </button>
              <button
                type="button"
                className="btn px-2 py-1"
                title="Remove from the scene"
                onClick={() => remove.mutate(t.id)}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      </PanelSection>

      {selected && (
        <PanelSection title="Selected" hint={selected.name}>
          <Row label="Size">
            <Num
              value={selected.size}
              min={1}
              onChange={(n) =>
                patch.mutate({ tokenId: selected.id, patch: { size: Math.max(1, Math.round(n)) } })
              }
            />
          </Row>
          <Row label="Bars">
            <select
              className={inputCls}
              value={selected.barsVisibility}
              onChange={(e) =>
                patch.mutate({
                  tokenId: selected.id,
                  patch: { barsVisibility: e.target.value as Token['barsVisibility'] },
                })
              }
            >
              <option value="gm">GM only</option>
              <option value="owner">owner</option>
              <option value="public">everyone</option>
            </select>
          </Row>
          <Row label="Aura m">
            <Num
              value={selected.aura?.radiusM ?? 0}
              min={0}
              step={0.5}
              title="Sustained-spell radius or spirit Force (0 = none)"
              onChange={(n) =>
                patch.mutate({
                  tokenId: selected.id,
                  patch: { aura: n > 0 ? { radiusM: n, color: selected.aura?.color } : null },
                })
              }
            />
          </Row>
        </PanelSection>
      )}
    </>
  );
}
