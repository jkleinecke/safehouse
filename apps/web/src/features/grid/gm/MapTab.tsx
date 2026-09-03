/**
 * Map image upload, per-image scan controls and grid calibration (FR9.1/9.2).
 *
 * Calibration is "tune cols/rows/offset until the drawn grid sits on the
 * image's own squares". The scan controls — rotate, crop, contrast/brightness
 * (Q10: hand-drawn maps arrive as phone photos) — ride on the image ref and
 * persist with the scene; see `../mapImage.ts` for the encoding.
 */
import { useRef, useState } from 'react';
import LevelsPanel from './LevelsPanel.js';
import type { Scene } from '@safehouse/contracts';
import { fileUrl, usePatchScene, useUploadAttachment } from '../api.js';
import {
  clampCrop,
  cssFilter,
  describeAdjustment,
  formatMapImageRef,
  FULL_CROP,
  isFullCrop,
  normalizeRotation,
  parseMapImageRef,
  type MapImageRef,
} from '../mapImage.js';
import { Empty, Num, PanelSection, Row } from './ui.js';

export default function MapTab({ scene }: { scene: Scene }) {
  const patch = usePatchScene();
  const upload = useUploadAttachment();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [openRef, setOpenRef] = useState<string | null>(null);

  const grid = scene.grid;
  const setGrid = (next: Partial<typeof grid>) =>
    patch.mutate({ sceneId: scene.id, patch: { grid: { ...grid, ...next } } });

  const setImages = (ids: string[]) =>
    patch.mutate({ sceneId: scene.id, patch: { mapAttachmentIds: ids } });

  const replaceAt = (index: number, ref: MapImageRef) => {
    const ids = [...scene.mapAttachmentIds];
    ids[index] = formatMapImageRef(ref);
    setImages(ids);
  };

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
        <ul className="space-y-2">
          {scene.mapAttachmentIds.map((raw, i) => {
            const ref = parseMapImageRef(raw);
            const open = openRef === raw;
            return (
              <li key={raw} className="rounded border border-edge p-2">
                <div className="flex items-center gap-2">
                  <img
                    src={fileUrl(ref.id)}
                    alt=""
                    style={{ filter: cssFilter(ref), transform: `rotate(${normalizeRotation(ref.rotateDeg)}deg)` }}
                    className="h-8 w-12 shrink-0 rounded border border-edge object-cover"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="mono-label block truncate text-faint">{ref.id}</span>
                    <span className="mono-label block truncate text-dim">
                      {describeAdjustment(ref)}
                    </span>
                  </span>
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
                    aria-pressed={open}
                    title="Rotate, crop and contrast for scans"
                    onClick={() => setOpenRef(open ? null : raw)}
                  >
                    adjust
                  </button>
                  <button
                    type="button"
                    className="btn py-1"
                    onClick={() => setImages(scene.mapAttachmentIds.filter((x) => x !== raw))}
                  >
                    remove
                  </button>
                </div>
                {open && <Adjust ref_={ref} onChange={(next) => replaceAt(i, next)} />}
              </li>
            );
          })}
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

      <PanelSection title="Floors" hint="stairs, catwalks, storeys">
        <LevelsPanel scene={scene} />
      </PanelSection>

      <PanelSection title="View" hint="how this scene is drawn — changes nothing about the rules">
        <Row label="Projection">
          <select
            value={grid.projection ?? 'topdown'}
            aria-label="Grid projection"
            data-testid="projection-select"
            className="w-full rounded border border-edge bg-deck px-2 py-1 text-sm"
            onChange={(e) => setGrid({ projection: e.target.value as 'topdown' | 'iso' })}
          >
            <option value="topdown">Top-down (plan)</option>
            <option value="iso">Isometric</option>
          </select>
        </Row>
        <p className="mt-1 text-xs text-faint">
          Isometric extrudes anything with height, so walls and cover read as solid objects
          instead of a slightly different shade of floor. Tokens, distances and line of sight
          are unchanged — this is only how the table sees it.
        </p>
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

/** Rotate / crop / contrast for one scanned image (FR9.2 photo-friendly). */
function Adjust({ ref_, onChange }: { ref_: MapImageRef; onChange: (next: MapImageRef) => void }) {
  const crop = ref_.crop ?? FULL_CROP;
  const setCrop = (patch: Partial<typeof crop>) =>
    onChange({ ...ref_, crop: clampCrop({ ...crop, ...patch }) });

  return (
    <div className="mt-2 space-y-2 border-t border-edge pt-2">
      <div className="flex items-center gap-2">
        <span className="mono-label w-20 shrink-0">Rotate</span>
        {[0, 90, 180, 270].map((deg) => (
          <button
            key={deg}
            type="button"
            aria-pressed={normalizeRotation(ref_.rotateDeg) === deg}
            className={
              'btn flex-1 py-1 ' +
              (normalizeRotation(ref_.rotateDeg) === deg ? 'border-cyan text-cyan' : '')
            }
            onClick={() => onChange({ ...ref_, rotateDeg: deg })}
          >
            {deg}°
          </button>
        ))}
      </div>

      <Row label="Contrast">
        <Num
          value={ref_.contrast}
          step={0.05}
          min={0.1}
          max={3}
          title="1 = as uploaded; pushes a faint pencil scan darker"
          onChange={(n) => onChange({ ...ref_, contrast: n })}
        />
      </Row>
      <Row label="Brightness">
        <Num
          value={ref_.brightness}
          step={0.05}
          min={0.1}
          max={3}
          onChange={(n) => onChange({ ...ref_, brightness: n })}
        />
      </Row>

      <div className="grid grid-cols-2 gap-2">
        <Row label="Crop x">
          <Num value={crop.x} step={0.01} min={0} max={1} onChange={(n) => setCrop({ x: n })} />
        </Row>
        <Row label="Crop y">
          <Num value={crop.y} step={0.01} min={0} max={1} onChange={(n) => setCrop({ y: n })} />
        </Row>
        <Row label="Crop w">
          <Num value={crop.w} step={0.01} min={0.02} max={1} onChange={(n) => setCrop({ w: n })} />
        </Row>
        <Row label="Crop h">
          <Num value={crop.h} step={0.01} min={0.02} max={1} onChange={(n) => setCrop({ h: n })} />
        </Row>
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          className="btn flex-1 py-1"
          disabled={isFullCrop(ref_.crop)}
          onClick={() => onChange({ ...ref_, crop: null })}
        >
          uncrop
        </button>
        <button
          type="button"
          className="btn flex-1 py-1"
          onClick={() => onChange({ ...ref_, rotateDeg: 0, crop: null, contrast: 1, brightness: 1 })}
        >
          reset
        </button>
      </div>
      <Empty>crop is a fraction of the source image — trim the desk around a photographed map</Empty>
    </div>
  );
}
