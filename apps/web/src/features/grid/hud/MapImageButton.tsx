/**
 * The scene's map images: upload one, and adjust the ones already there.
 *
 * A scanned or hand-drawn floor plan is the other way to get a map (FR9.1) —
 * the half that is not painted — so it belongs beside the tools that paint,
 * not in a panel section. The face uploads; the caret opens what is already
 * uploaded, where a phone photo of a hand-drawn map gets rotated, cropped
 * and pushed darker (Q10), reordered, or taken off again.
 *
 * The adjustments ride on the image ref and persist with the scene; see
 * `../mapImage.ts` for the encoding.
 */
import { useEffect, useRef, useState } from 'react';
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
import { Empty, Num, Row } from '../gm/ui.js';
import HudButton from './HudButton.js';

export default function MapImageButton({ scene }: { scene: Scene }) {
  const patch = usePatchScene();
  const upload = useUploadAttachment();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [openRef, setOpenRef] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);

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

  const images = scene.mapAttachmentIds;

  const setImages = (ids: string[]) =>
    patch.mutate({ sceneId: scene.id, patch: { mapAttachmentIds: ids } });

  const replaceAt = (index: number, ref: MapImageRef) => {
    const ids = [...images];
    ids[index] = formatMapImageRef(ref);
    setImages(ids);
  };

  const onFile = (file: File | undefined) => {
    if (!file) return;
    setErr(null);
    upload.mutate(file, {
      onSuccess: ({ id }) => setImages([...images, id]),
      onError: (e: unknown) => setErr(e instanceof Error ? e.message : 'upload failed'),
    });
  };

  return (
    <div ref={boxRef} className="relative flex items-center">
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
      <HudButton
        title={upload.isPending ? 'Uploading…' : 'Upload a map image'}
        testId="upload-image"
        disabled={upload.isPending}
        onClick={() => fileRef.current?.click()}
        className={images.length > 0 ? 'rounded-r-none' : ''}
      >
        <span aria-hidden className="block w-5 text-center text-base leading-none">
          {upload.isPending ? '…' : '🖼'}
        </span>
      </HudButton>

      {/* Nothing uploaded, nothing to open. */}
      {images.length > 0 && (
        <button
          type="button"
          data-testid="map-images-menu"
          title={`${images.length} map image${images.length === 1 ? '' : 's'}`}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className="btn -ml-px rounded-l-none px-1 py-1.5 text-[0.6rem] text-dim"
        >
          <span aria-hidden>▾</span>
        </button>
      )}

      {err && (
        <span className="mono-label ml-1.5 max-w-40 truncate text-danger" data-testid="upload-error">
          {err}
        </span>
      )}

      {open && (
        <div
          role="menu"
          data-testid="map-images-open"
          className="absolute left-0 top-full z-30 mt-1 max-h-96 w-72 overflow-y-auto rounded-lg border border-edge bg-panel p-2 shadow-lg"
        >
          <ul className="space-y-2">
            {images.map((raw, i) => {
              const ref = parseMapImageRef(raw);
              const shown = openRef === raw;
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
                      <span className="mono-label block truncate text-dim">{describeAdjustment(ref)}</span>
                    </span>
                    <button
                      type="button"
                      className="btn py-1"
                      title="Move up in draw order"
                      disabled={i === 0}
                      onClick={() => {
                        const ids = [...images];
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
                      aria-pressed={shown}
                      title="Rotate, crop and contrast for scans"
                      onClick={() => setOpenRef(shown ? null : raw)}
                    >
                      adjust
                    </button>
                    <button
                      type="button"
                      className="btn py-1"
                      title="Take this image off the scene"
                      onClick={() => setImages(images.filter((x) => x !== raw))}
                    >
                      remove
                    </button>
                  </div>
                  {shown && <Adjust ref_={ref} onChange={(next) => replaceAt(i, next)} />}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
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
