/**
 * Map pins (FR9.3): drop a pin, name it, and link it to a codex page (FR5.3)
 * or a handout attachment (FR5.4). GM pins stay private until revealed —
 * `visibility: 'gm'` pins are stripped from player payloads SERVER-side
 * (`sceneForViewer`), so "reveal" here is a real state change, not a repaint.
 */
import { useRef, useState } from 'react';
import type { Pin, Scene } from '@safehouse/contracts';
import { fileUrl, usePatchGeometry, useUploadAttachment, useWikiPages } from '../api.js';
import { isPinLinked, removePin, updatePin, type PinPatch } from '../geometryEdit.js';
import { useGridStore } from '../store.js';
import { Empty, inputCls, PanelSection, Row } from './ui.js';

export interface PinsTabProps {
  campaignId: string;
  scene: Scene;
  onCenter: (x: number, y: number) => void;
}

export default function PinsTab({ campaignId, scene, onCenter }: PinsTabProps) {
  const patch = usePatchGeometry();
  const upload = useUploadAttachment();
  const tool = useGridStore((s) => s.tool);
  const setTool = useGridStore((s) => s.setTool);
  const selectedPinId = useGridStore((s) => s.selectedPinId);
  const selectPin = useGridStore((s) => s.selectPin);
  const pages = useWikiPages(campaignId, true);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [uploadFor, setUploadFor] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const geo = scene.geometry;
  const save = (next: typeof geo) => patch.mutate({ sceneId: scene.id, geometry: next });

  const attach = (file: File | undefined) => {
    const pinId = uploadFor;
    setUploadFor(null);
    if (!file || !pinId) return;
    setErr(null);
    upload.mutate(file, {
      onSuccess: ({ id }) => save(updatePin(geo, pinId, { attachmentId: id })),
      onError: (e: unknown) => setErr(e instanceof Error ? e.message : 'upload failed'),
    });
  };

  return (
    <>
      <PanelSection title="Place a pin" hint="FR9.3">
        <button
          type="button"
          aria-pressed={tool === 'pin'}
          className={'btn w-full py-1 ' + (tool === 'pin' ? 'border-cyan text-cyan' : '')}
          onClick={() => setTool(tool === 'pin' ? 'select' : 'pin')}
        >
          {tool === 'pin' ? 'stop dropping pins' : 'click the map to drop a pin'}
        </button>
        <Empty>
          with the select tool, clicking a pin head opens it here; new pins start private to you
        </Empty>
        {patch.isError && <p className="mono-label text-danger">pin not saved — retry</p>}
        {err && <p className="mono-label text-danger">{err}</p>}
      </PanelSection>

      <input
        ref={fileRef}
        type="file"
        className="hidden"
        onChange={(e) => {
          attach(e.target.files?.[0]);
          e.target.value = '';
        }}
      />

      <PanelSection title="Pins" hint={`${geo.pins.length}`}>
        {geo.pins.length === 0 && <Empty>no pins on this map yet</Empty>}
        <ul className="space-y-2">
          {geo.pins.map((pin) => (
            <PinRow
              key={pin.id}
              pin={pin}
              selected={pin.id === selectedPinId}
              pages={pages.data}
              pagesFailed={pages.isError}
              onSelect={() => selectPin(pin.id === selectedPinId ? null : pin.id)}
              onCenter={() => onCenter(pin.at.x, pin.at.y)}
              onPatch={(p) => save(updatePin(geo, pin.id, p))}
              onDelete={() => {
                if (selectedPinId === pin.id) selectPin(null);
                save(removePin(geo, pin.id));
              }}
              onAttach={() => {
                setUploadFor(pin.id);
                fileRef.current?.click();
              }}
            />
          ))}
        </ul>
      </PanelSection>
    </>
  );
}

interface PinRowProps {
  pin: Pin;
  selected: boolean;
  pages: Array<{ id: string; title: string }> | undefined;
  pagesFailed: boolean;
  onSelect: () => void;
  onCenter: () => void;
  onPatch: (patch: PinPatch) => void;
  onDelete: () => void;
  onAttach: () => void;
}

function PinRow(props: PinRowProps) {
  const { pin } = props;
  const isPublic = pin.visibility === 'public';
  return (
    <li
      className={
        'rounded border p-2 ' + (props.selected ? 'border-cyan bg-raised/60' : 'border-edge')
      }
    >
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="btn py-1"
          aria-pressed={props.selected}
          title="Highlight this pin on the map"
          onClick={props.onSelect}
        >
          {props.selected ? '◉' : '○'}
        </button>
        <input
          className={inputCls}
          aria-label={`Pin label (${pin.id})`}
          placeholder="the safe, Mr Johnson's table…"
          value={pin.label ?? ''}
          onChange={(e) => props.onPatch({ label: e.target.value })}
        />
        <button type="button" className="btn py-1" title="Centre the canvas here" onClick={props.onCenter}>
          find
        </button>
      </div>

      <div className="mt-2 space-y-2">
        <Row label="Codex">
          {props.pagesFailed || !props.pages ? (
            <input
              className={inputCls}
              aria-label={`Codex page id (${pin.id})`}
              placeholder="codex page id"
              value={pin.wikiPageId ?? ''}
              onChange={(e) => props.onPatch({ wikiPageId: e.target.value })}
            />
          ) : (
            <select
              className={inputCls}
              aria-label={`Codex page (${pin.id})`}
              value={pin.wikiPageId ?? ''}
              onChange={(e) => props.onPatch({ wikiPageId: e.target.value || null })}
            >
              <option value="">— no page —</option>
              {props.pages.map((page) => (
                <option key={page.id} value={page.id}>
                  {page.title}
                </option>
              ))}
            </select>
          )}
        </Row>

        <Row label="Handout">
          {pin.attachmentId ? (
            <span className="flex items-center gap-2">
              <a
                className="min-w-0 flex-1 truncate text-xs text-cyan underline"
                href={fileUrl(pin.attachmentId)}
                target="_blank"
                rel="noreferrer"
              >
                {pin.attachmentId}
              </a>
              <button
                type="button"
                className="btn py-1"
                onClick={() => props.onPatch({ attachmentId: null })}
              >
                unlink
              </button>
            </span>
          ) : (
            <button type="button" className="btn w-full py-1" onClick={props.onAttach}>
              upload a handout
            </button>
          )}
        </Row>

        <div className="flex items-center gap-2">
          <button
            type="button"
            className={'btn flex-1 py-1 ' + (isPublic ? 'text-ok' : '')}
            aria-pressed={isPublic}
            title="Public pins reach player and TV screens"
            onClick={() => props.onPatch({ visibility: isPublic ? 'gm' : 'public' })}
          >
            {isPublic ? 'revealed' : 'private'}
          </button>
          <button type="button" className="btn py-1 text-danger" onClick={props.onDelete}>
            delete
          </button>
        </div>
        {!isPinLinked(pin) && <Empty>this pin points at nothing yet</Empty>}
      </div>
    </li>
  );
}
