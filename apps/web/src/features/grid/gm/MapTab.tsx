/**
 * Map image upload + grid calibration (FR9.1/9.2). Calibration is "tune
 * cols/rows/offset until the drawn grid sits on the image's own squares";
 * changes are optimistic on the canvas because the scene query updates first.
 */
import { useRef, useState } from 'react';
import type { Scene } from '@safehouse/contracts';
import { fileUrl, usePatchScene, useUploadAttachment } from '../api.js';
import { Empty, Num, PanelSection, Row } from './ui.js';

export default function MapTab({ scene }: { scene: Scene }) {
  const patch = usePatchScene();
  const upload = useUploadAttachment();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const grid = scene.grid;
  const setGrid = (next: Partial<typeof grid>) =>
    patch.mutate({ sceneId: scene.id, patch: { grid: { ...grid, ...next } } });

  const setImages = (ids: string[]) =>
    patch.mutate({ sceneId: scene.id, patch: { mapAttachmentIds: ids } });

  const onFile = (file: File | undefined) => {
    if (!file) return;
    setErr(null);
    upload.mutate(file, {
      onSuccess: ({ id }) => setImages([...scene.mapAttachmentIds, id]),
      onError: (e: unknown) => setErr(e instanceof Error ? e.message : 'upload failed'),
    });
  };

  return (
    <>
      <PanelSection title="Map images" hint={`${scene.mapAttachmentIds.length}`}>
        {scene.mapAttachmentIds.length === 0 && <Empty>upload a floor plan or a scan</Empty>}
        <ul className="space-y-1">
          {scene.mapAttachmentIds.map((id, i) => (
            <li key={id} className="flex items-center gap-2">
              <img
                src={fileUrl(id)}
                alt=""
                className="h-8 w-12 shrink-0 rounded border border-edge object-cover"
              />
              <span className="mono-label min-w-0 flex-1 truncate text-faint">{id}</span>
              <button
                type="button"
                className="btn py-1"
                title="Move up in draw order"
                disabled={i === 0}
                onClick={() => {
                  const ids = [...scene.mapAttachmentIds];
                  const prev = ids[i - 1];
                  const cur = ids[i];
                  if (prev === undefined || cur === undefined) return;
                  ids[i - 1] = cur;
                  ids[i] = prev;
                  setImages(ids);
                }}
              >
                ↑
              </button>
              <button
                type="button"
                className="btn py-1"
                onClick={() => setImages(scene.mapAttachmentIds.filter((x) => x !== id))}
              >
                remove
              </button>
            </li>
          ))}
        </ul>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            onFile(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
        <button
          type="button"
          className="btn btn-accent w-full py-1"
          disabled={upload.isPending}
          onClick={() => fileRef.current?.click()}
        >
          {upload.isPending ? 'uploading…' : 'upload image'}
        </button>
        {err && <p className="mono-label text-danger">{err}</p>}
      </PanelSection>

      <PanelSection title="Calibrate" hint="1 m per square by default">
        <Row label="Columns">
          <Num value={grid.cols} min={1} onChange={(n) => setGrid({ cols: Math.max(1, Math.round(n)) })} />
        </Row>
        <Row label="Rows">
          <Num value={grid.rows} min={1} onChange={(n) => setGrid({ rows: Math.max(1, Math.round(n)) })} />
        </Row>
        <Row label="Metres">
          <Num
            value={grid.unitM}
            min={0.1}
            step={0.5}
            title="Metres per square (FR9.1)"
            onChange={(n) => setGrid({ unitM: n > 0 ? n : 1 })}
          />
        </Row>
        <Row label="Offset X">
          <Num value={grid.offset.x} step={0.05} onChange={(n) => setGrid({ offset: { ...grid.offset, x: n } })} />
        </Row>
        <Row label="Offset Y">
          <Num value={grid.offset.y} step={0.05} onChange={(n) => setGrid({ offset: { ...grid.offset, y: n } })} />
        </Row>
        <Row label="Opacity">
          <Num
            value={grid.opacity ?? 0.35}
            step={0.05}
            min={0}
            max={1}
            onChange={(n) => setGrid({ opacity: Math.max(0, Math.min(1, n)) })}
          />
        </Row>
        <p className="mono-label text-faint">
          {grid.cols}×{grid.rows} squares = {(grid.cols * grid.unitM).toFixed(0)}×
          {(grid.rows * grid.unitM).toFixed(0)} m
        </p>
      </PanelSection>
    </>
  );
}
