/**
 * Token layers (FR9.26) on the map, behind the stack icon.
 *
 * A layer is a set of tokens behind one switch — hide the ambush, show it
 * when the shooting starts. That switch is thrown mid-fight, with everyone
 * looking at the table, and it lived in a panel section under the token
 * list: open the panel, find Tokens, scroll past placement, throw it. Here
 * it is one icon on the mode bar, and the menu stays open while layers are
 * flipped, because revealing the ambush and hiding the decoy is one move
 * made of two.
 *
 * Hiding is not a view: the server filters a hidden layer's tokens out of
 * what players receive, so this reaches the table. That is the whole point
 * of it, and the reason it is not the same kind of thing as a floor.
 */
import { useEffect, useRef, useState } from 'react';
import type { Scene } from '@safehouse/contracts';
import Icon from '../../../components/Icon.js';
import { usePatchScene } from '../api.js';
import {
  addLayer,
  layersOf,
  removeLayer,
  renameLayer,
  setLayerHidden,
  type TokenLayers,
} from '../tokenLayers.js';

export default function TokenLayersMenu({ scene }: { scene: Scene }) {
  const patchScene = usePatchScene();
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const boxRef = useRef<HTMLDivElement | null>(null);
  const draftRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    const away = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', key);
    };
  }, [open]);

  useEffect(() => {
    if (adding) draftRef.current?.focus();
  }, [adding]);

  useEffect(() => {
    if (!open) {
      setAdding(false);
      setDraft('');
    }
  }, [open]);

  const layers = layersOf(scene);
  const hidden = layers.filter((l) => l.hidden).length;

  const save = (next: TokenLayers) =>
    patchScene.mutate({ sceneId: scene.id, patch: { tokenLayers: [...next] } });

  const add = () => {
    save(addLayer(layers, draft));
    setDraft('');
    setAdding(false);
  };

  return (
    <div ref={boxRef} className="relative flex items-center" data-testid="token-layers-menu">
      <button
        type="button"
        data-testid="token-layers-button"
        title={
          layers.length === 0
            ? 'Token layers'
            : `${layers.length} token layer${layers.length === 1 ? '' : 's'}${hidden > 0 ? `, ${hidden} hidden` : ''}`
        }
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="btn flex min-h-9 items-center gap-1 px-2 py-1 text-[0.7rem] text-ink"
      >
        <Icon name="layers" size={16} />
        {/*
          A hidden layer has to be visible somewhere, or the GM who hid the
          ambush last session wonders where half the fight went.
        */}
        {hidden > 0 && (
          <span className="text-warn" data-testid="token-layers-hidden-count">
            {hidden}
          </span>
        )}
        <span aria-hidden className="text-[0.6rem] text-dim">
          ▾
        </span>
      </button>

      {open && (
        <div
          role="menu"
          data-testid="token-layers-open"
          className="absolute left-0 top-full z-30 mt-1 max-h-96 w-72 overflow-y-auto rounded-lg border border-edge bg-panel p-1 shadow-lg"
        >
          {adding ? (
            <form
              className="flex items-center gap-1 p-1"
              onSubmit={(e) => {
                e.preventDefault();
                add();
              }}
            >
              <input
                ref={draftRef}
                className="min-w-0 flex-1 rounded border border-edge bg-deck px-1.5 py-1 text-xs text-ink placeholder:text-faint"
                placeholder="Ambush, second wave, HTR team…"
                aria-label="new layer name"
                data-testid="layer-name"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    e.stopPropagation();
                    setAdding(false);
                    setDraft('');
                  }
                }}
              />
              <button
                type="submit"
                data-testid="layer-add"
                className="mono-label rounded border border-cyan px-2 py-1 text-cyan"
              >
                add
              </button>
            </form>
          ) : (
            <button
              type="button"
              data-testid="layer-add-open"
              onClick={() => setAdding(true)}
              className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-xs text-cyan hover:bg-raised/60"
            >
              <span aria-hidden className="w-4 text-center">
                +
              </span>
              <span>Add a layer…</span>
            </button>
          )}

          <span className="my-1 block h-px bg-edge" aria-hidden />

          {layers.length === 0 && (
            <p className="px-1.5 py-1 text-[11px] text-faint">
              A layer is a set of tokens behind one switch — hide the ambush, show it when the
              shooting starts.
            </p>
          )}

          {layers.map((layer) => (
            <div
              key={layer.id}
              data-layer={layer.id}
              data-hidden={layer.hidden ? 'yes' : 'no'}
              className="flex items-center gap-1 rounded px-1 py-0.5"
            >
              {/*
                The eye is the whole reason this is on the map: one click,
                mid-fight, and the ambush is on the players' screens.
              */}
              <button
                type="button"
                role="menuitemcheckbox"
                aria-checked={!layer.hidden}
                data-testid={`layer-toggle-${layer.id}`}
                title={layer.hidden ? 'Show every token on this layer' : 'Hide every token on this layer'}
                onClick={() => save(setLayerHidden(layers, layer.id, !layer.hidden))}
                className={
                  'shrink-0 rounded px-1 py-1 text-xs leading-none ' +
                  (layer.hidden ? 'text-warn' : 'text-cyan')
                }
              >
                <Icon name={layer.hidden ? 'visibility_off' : 'visibility'} size={16} />
              </button>
              <input
                className={
                  'min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-1 text-xs hover:border-edge focus:border-cyan focus:outline-none ' +
                  (layer.hidden ? 'text-warn' : 'text-ink')
                }
                value={layer.name}
                aria-label="layer name"
                onChange={(e) => save(renameLayer(layers, layer.id, e.target.value))}
              />
              <span className="mono-label shrink-0 text-faint">{layer.tokenIds.length}</span>
              <button
                type="button"
                className="shrink-0 rounded px-1 py-1 text-xs leading-none text-dim hover:text-danger"
                title="Delete the layer (its tokens stay on the map)"
                data-testid={`layer-remove-${layer.id}`}
                onClick={() => save(removeLayer(layers, layer.id))}
              >
                ✕
              </button>
            </div>
          ))}

          {patchScene.isError && (
            <p className="mono-label px-1.5 py-1 text-danger">layers not saved — retry</p>
          )}
        </div>
      )}
    </div>
  );
}
