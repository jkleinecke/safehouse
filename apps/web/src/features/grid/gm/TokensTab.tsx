/**
 * Token placement + per-token GM controls (FR9.4/9.6/9.7).
 * Hiding a token is a server-side concern: the hub stops sending its position
 * to player/display sockets entirely (Principle 4) — this button just asks.
 */
import { useState } from 'react';
import type { Scene, Token } from '@safehouse/contracts';
import { useCharacters, useDeleteToken, useNpcTemplates, usePatchToken, usePlaceToken } from '../api.js';
import { useGridStore } from '../store.js';
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
  const selectedTokenId = useGridStore((s) => s.selectedTokenId);
  const selectToken = useGridStore((s) => s.selectToken);

  const [kind, setKind] = useState<PlaceKind>('character');
  const [sourceId, setSourceId] = useState('');
  const [propName, setPropName] = useState('');
  const [size, setSize] = useState(1);

  const characters = useCharacters(campaignId, kind === 'character');
  const templates = useNpcTemplates(campaignId, kind === 'npc_template');

  const center = { x: scene.grid.cols / 2, y: scene.grid.rows / 2 };

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
        level: 0,
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
              </button>
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
