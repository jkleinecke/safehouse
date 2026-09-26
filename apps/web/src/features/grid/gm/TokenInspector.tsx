/**
 * A token's properties, in Prep's panel when one is picked (FR9.4/9.6/9.7).
 *
 * Everything the Tokens tab did to one token — hide it, put it on a layer,
 * size it, say who sees its bars, give it an aura, take it off — plus the
 * cover reading the LOS tab gave: with a lens up ("See as" on the mode row),
 * this token is the target, and the panel says what stands between them and
 * lets the GM overrule the map.
 */
import type { Scene, Token } from '@safehouse/contracts';
import { coverCall, lineOfSight, sightModelFor, type CoverLevel } from '@safehouse/rules';
import { useDeleteToken, usePatchScene, usePatchToken } from '../api.js';
import { useGridStore } from '../store.js';
import { assignToken, layerOfToken, layersOf, type TokenLayers } from '../tokenLayers.js';
import { inputCls, Num, PanelSection, Row } from './ui.js';

const COVER_CHOICES: readonly { value: CoverLevel | 'auto'; label: string }[] = [
  { value: 'auto', label: 'From the map' },
  { value: 'none', label: 'No cover' },
  { value: 'partial', label: 'Partial' },
  { value: 'full', label: 'Full — no shot' },
];

const cellOf = (t: Token) => ({ col: Math.floor(t.x), row: Math.floor(t.y) });

export default function TokenInspector({
  scene,
  tokens,
  token,
  onCenter,
}: {
  scene: Scene;
  tokens: readonly Token[];
  token: Token;
  onCenter: (x: number, y: number) => void;
}) {
  const patch = usePatchToken(scene.id);
  const remove = useDeleteToken(scene.id);
  const patchScene = usePatchScene();
  const selectToken = useGridStore((s) => s.selectToken);
  const lens = useGridStore((s) => s.losTokenId);
  const coverOverride = useGridStore((s) => s.coverOverride);
  const setCoverOverride = useGridStore((s) => s.setCoverOverride);
  const layers = layersOf(scene);
  const saveLayers = (next: TokenLayers) => patchScene.mutate({ sceneId: scene.id, patch: { tokenLayers: [...next] } });

  const viewer = tokens.find((t) => t.id === lens && t.id !== token.id) ?? null;
  const ruling = viewer
    ? (() => {
        const los = lineOfSight(cellOf(viewer), cellOf(token), sightModelFor(scene, token.level ?? 0));
        return { los, call: coverCall(los.cover, coverOverride ?? undefined) };
      })()
    : null;

  return (
    <section data-testid="token-inspector" className="bg-raised/40">
      <div className="flex items-center gap-2 px-3 pt-3">
        <span className="mono-label text-magenta">Token</span>
        <span className="min-w-0 flex-1 truncate text-sm text-ink">{token.name}</span>
        <button type="button" className="btn px-2 py-1" title="Centre on it" onClick={() => onCenter(token.x, token.y)}>
          ⌖
        </button>
      </div>
      <PanelSection title="Table">
        <div className="flex gap-2">
          <button
            type="button"
            className={'btn flex-1 py-1 ' + (token.hidden ? 'btn-accent' : '')}
            onClick={() => patch.mutate({ tokenId: token.id, patch: { hidden: !token.hidden } })}
          >
            {token.hidden ? 'reveal to players' : 'hide from players'}
          </button>
        </div>
        {layers.length > 0 && (
          <Row label="Layer">
            <select
              className={inputCls}
              value={layerOfToken(layers, token.id)?.id ?? ''}
              aria-label={`layer for ${token.name}`}
              onChange={(e) => saveLayers(assignToken(layers, token.id, e.target.value || null))}
            >
              <option value="">no layer</option>
              {layers.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </Row>
        )}
        <Row label="Size">
          <Num value={token.size} min={1} onChange={(n) => patch.mutate({ tokenId: token.id, patch: { size: Math.max(1, Math.round(n)) } })} />
        </Row>
        <Row label="Bars">
          <select
            className={inputCls}
            value={token.barsVisibility}
            onChange={(e) => patch.mutate({ tokenId: token.id, patch: { barsVisibility: e.target.value as Token['barsVisibility'] } })}
          >
            <option value="gm">GM only</option>
            <option value="owner">owner</option>
            <option value="public">everyone</option>
          </select>
        </Row>
        <Row label="Aura m">
          <Num
            value={token.aura?.radiusM ?? 0}
            min={0}
            step={0.5}
            title="Sustained-spell radius or spirit Force (0 = none)"
            onChange={(n) =>
              patch.mutate({ tokenId: token.id, patch: { aura: n > 0 ? { radiusM: n, color: token.aura?.color } : null } })
            }
          />
        </Row>
      </PanelSection>
      {ruling && viewer && (
        <PanelSection title="Cover" hint={`from ${viewer.name}`}>
          <p className="text-xs text-dim" data-testid="cover-reading">
            <span className={ruling.los.clear ? 'text-ink' : 'text-magenta'}>{ruling.call.why}</span>
            {ruling.los.blockedBy !== null && <span className="text-faint"> (behind {ruling.los.blockedBy})</span>}
          </p>
          <select
            aria-label="Cover override"
            value={coverOverride ?? 'auto'}
            onChange={(e) => setCoverOverride(e.target.value === 'auto' ? null : (e.target.value as CoverLevel))}
            className={inputCls}
          >
            {COVER_CHOICES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
          {ruling.call.overridden && <p className="text-xs text-magenta">Your call overrides the map. The roll will say so.</p>}
        </PanelSection>
      )}
      <div className="flex justify-end px-3 pb-3">
        <button
          type="button"
          className="btn py-1 text-danger"
          onClick={() => {
            selectToken(null);
            remove.mutate(token.id);
          }}
        >
          remove from the scene
        </button>
      </div>
    </section>
  );
}
