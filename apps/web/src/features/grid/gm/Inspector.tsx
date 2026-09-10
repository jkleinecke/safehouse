/**
 * The inspector (docs/UX_MAP_BUILDER.md §3.2): the one place a wall, door,
 * zone, pin, camera or note is edited. A click on the thing — on the canvas
 * or in a list — opens it here; the tool that made it lives on the toolbar.
 * Learning one teaches all.
 *
 * Geometry edits are a call into `../geometryEdit.js` followed by one whole-
 * object `PATCH /api/scenes/:id { geometry }`; the canvas redraws from the
 * refreshed scene query, so nothing here is optimistic and nothing can
 * drift. Doors go through the door route (FR9.24), the same one a player's
 * hand on the handle uses, so opening one here is exactly what the table
 * does. Pins stay private until revealed — `visibility: 'gm'` pins are
 * stripped from player payloads SERVER-side (`sceneForViewer`), so "reveal"
 * is a real state change, not a repaint.
 */
import { useRef, useState, type ReactNode } from 'react';
import type { Camera, Door, Note, Pin, Point, Scene, Wall, Zone } from '@safehouse/contracts';
import { sceneLevels } from '@safehouse/rules';
import { fileUrl, useDoorOp, usePatchGeometry, useUploadAttachment, useWikiPages } from '../api.js';
import {
  camerasOf,
  convertWallToDoor,
  isPinLinked,
  NOTE_MAX_CHARS,
  notesOf,
  removeCamera,
  removeDoor,
  removeNote,
  removePin,
  removeWall,
  removeZone,
  updateCamera,
  updateDoor,
  updateNote,
  updatePin,
  updateWall,
  updateZone,
  type CameraPatch,
  type NotePatch,
  type PinPatch,
} from '../geometryEdit.js';
import { useGridStore } from '../store.js';
import type { GeometrySelection } from '../types.js';
import { cameraLensId } from '../useShroud.js';
import ConfirmButton from './ConfirmButton.js';
import { Empty, inputCls, Num, Row } from './ui.js';
import { metres } from './GeometryTab.js';

export interface InspectorProps {
  campaignId: string;
  scene: Scene;
  selection: GeometrySelection;
  onCenter: (x: number, y: number) => void;
}

type Geo = Scene['geometry'];
type Save = (next: Geo) => void;

const TITLES: Record<GeometrySelection['kind'], string> = {
  wall: 'Wall',
  door: 'Door',
  zone: 'Zone',
  pin: 'Pin',
  camera: 'Camera',
  note: 'Note',
};

/** A few papers to pick from; the contract takes any hex. */
const PAPERS: ReadonlyArray<{ label: string; color: string | null }> = [
  { label: 'yellow', color: null },
  { label: 'pink', color: '#f7a1c4' },
  { label: 'green', color: '#a8e6a1' },
  { label: 'blue', color: '#9fd0f5' },
];

/** Compass presets, as plan bearings: 0 is east, 90 is south. */
const FACINGS: ReadonlyArray<{ label: string; facing: number }> = [
  { label: 'N', facing: 270 },
  { label: 'E', facing: 0 },
  { label: 'S', facing: 90 },
  { label: 'W', facing: 180 },
];

const mid = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const centroid = (poly: readonly Point[]): Point =>
  poly.length === 0
    ? { x: 0, y: 0 }
    : {
        x: poly.reduce((s, p) => s + p.x, 0) / poly.length,
        y: poly.reduce((s, p) => s + p.y, 0) / poly.length,
      };

export default function Inspector({ campaignId, scene, selection, onCenter }: InspectorProps) {
  const patch = usePatchGeometry();
  const select = useGridStore((s) => s.select);
  const geo = scene.geometry;
  const save: Save = (next) => patch.mutate({ sceneId: scene.id, geometry: next });
  const close = () => select(null);
  // Deleting closes first: an inspector on a thing that no longer exists is
  // a blank box, and the ring would hang on the canvas until the refetch.
  const remove = (next: Geo) => {
    select(null);
    save(next);
  };

  const found = find(geo, selection);
  if (!found) return null;

  let subtitle: string;
  let at: Point;
  let body: ReactNode;
  switch (found.kind) {
    case 'wall':
      subtitle = `${found.item.id} · ${metres(found.item.a, found.item.b, scene.grid.unitM)}`;
      at = mid(found.item.a, found.item.b);
      body = <WallFields wall={found.item} geo={geo} save={save} remove={remove} />;
      break;
    case 'door':
      subtitle = `${found.item.id} · ${metres(found.item.a, found.item.b, scene.grid.unitM)}`;
      at = mid(found.item.a, found.item.b);
      body = <DoorFields door={found.item} sceneId={scene.id} geo={geo} save={save} remove={remove} />;
      break;
    case 'zone':
      subtitle = `${found.item.polygon.length} corners`;
      at = centroid(found.item.polygon);
      body = <ZoneFields zone={found.item} geo={geo} save={save} remove={remove} />;
      break;
    case 'pin':
      subtitle = found.item.visibility === 'public' ? 'revealed to the table' : 'private to you';
      at = found.item.at;
      body = <PinFields pin={found.item} campaignId={campaignId} geo={geo} save={save} remove={remove} />;
      break;
    case 'camera':
      subtitle = found.item.active ? 'switched on' : 'switched off';
      at = found.item.at;
      body = <CameraFields camera={found.item} scene={scene} geo={geo} save={save} remove={remove} />;
      break;
    case 'note':
      subtitle = `at ${found.item.at.x}, ${found.item.at.y}`;
      at = found.item.at;
      body = <NoteFields note={found.item} geo={geo} save={save} remove={remove} />;
      break;
  }

  return (
    <section
      data-testid="inspector"
      data-kind={selection.kind}
      data-id={selection.id}
      className="bg-raised/40 px-3 py-3"
      aria-label={`${TITLES[selection.kind]} inspector`}
    >
      <div className="flex items-center gap-2">
        <span className="mono-label text-magenta">{TITLES[selection.kind]}</span>
        <span className="mono-label min-w-0 flex-1 truncate text-faint">{subtitle}</span>
        <button
          type="button"
          className="btn px-2 py-0.5"
          title="Centre the map on it"
          onClick={() => onCenter(at.x, at.y)}
        >
          ⌖
        </button>
        <button type="button" className="btn px-2 py-0.5" title="Close (Esc)" onClick={close}>
          ✕
        </button>
      </div>
      <div className="mt-2 space-y-2">{body}</div>
      {patch.isError && <p className="mono-label text-danger">not saved — retry</p>}
    </section>
  );
}

type Found =
  | { kind: 'wall'; item: Wall }
  | { kind: 'door'; item: Door }
  | { kind: 'zone'; item: Zone }
  | { kind: 'pin'; item: Pin }
  | { kind: 'camera'; item: Camera }
  | { kind: 'note'; item: Note };

/** The selected thing in this scene's geometry, or null when it is gone (deleted, or another scene). */
export function find(geo: Geo, sel: GeometrySelection): Found | null {
  const by = <T extends { id: string }>(list: readonly T[]): T | undefined => list.find((x) => x.id === sel.id);
  switch (sel.kind) {
    case 'wall': {
      const item = by(geo.walls);
      return item ? { kind: 'wall', item } : null;
    }
    case 'door': {
      const item = by(geo.doors);
      return item ? { kind: 'door', item } : null;
    }
    case 'zone': {
      const item = by(geo.zones);
      return item ? { kind: 'zone', item } : null;
    }
    case 'pin': {
      const item = by(geo.pins);
      return item ? { kind: 'pin', item } : null;
    }
    case 'camera': {
      const item = by(camerasOf(geo));
      return item ? { kind: 'camera', item } : null;
    }
    case 'note': {
      const item = by(notesOf(geo));
      return item ? { kind: 'note', item } : null;
    }
  }
}

// ---------------------------------------------------------------------------

/** Endpoint boxes for a wall or a door: the one precise edit dragging cannot do. */
function Endpoints({ a, b, onChange }: { a: Point; b: Point; onChange: (p: { a?: Point; b?: Point }) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <Row label="from x">
        <Num value={a.x} step={0.5} onChange={(n) => onChange({ a: { ...a, x: n } })} />
      </Row>
      <Row label="from y">
        <Num value={a.y} step={0.5} onChange={(n) => onChange({ a: { ...a, y: n } })} />
      </Row>
      <Row label="to x">
        <Num value={b.x} step={0.5} onChange={(n) => onChange({ b: { ...b, x: n } })} />
      </Row>
      <Row label="to y">
        <Num value={b.y} step={0.5} onChange={(n) => onChange({ b: { ...b, y: n } })} />
      </Row>
    </div>
  );
}

/** Two clicks: the second is the confirmation (docs/UX_MAP_BUILDER.md §3.6). */
function DeleteButton({ onClick, label = 'delete' }: { onClick: () => void; label?: string }) {
  return (
    <ConfirmButton
      label={label}
      confirmLabel={`${label} — sure?`}
      onConfirm={onClick}
      className="btn py-1"
      testId="inspector-delete"
    />
  );
}

function WallFields({ wall, geo, save, remove }: { wall: Wall; geo: Geo; save: Save; remove: (g: Geo) => void }) {
  const select = useGridStore((s) => s.select);
  return (
    <>
      <Endpoints a={wall.a} b={wall.b} onChange={(p) => save(updateWall(geo, wall.id, p))} />
      <div className="flex gap-2">
        <button
          type="button"
          className="btn flex-1 py-1"
          title="Same segment, but a door: it opens, shuts and locks"
          onClick={() => {
            // The door takes a new id, so the inspector follows it there.
            const next = convertWallToDoor(geo, wall.id);
            const door = next.doors[next.doors.length - 1];
            save(next);
            select(door ? { kind: 'door', id: door.id } : null);
          }}
        >
          make it a door
        </button>
        <DeleteButton onClick={() => remove(removeWall(geo, wall.id))} />
      </div>
    </>
  );
}

function DoorFields({
  door,
  sceneId,
  geo,
  save,
  remove,
}: {
  door: Door;
  sceneId: string;
  geo: Geo;
  save: Save;
  remove: (g: Geo) => void;
}) {
  const doorOp = useDoorOp(sceneId);
  return (
    <>
      <div className="flex gap-2">
        <button
          type="button"
          className="btn flex-1 py-1"
          aria-pressed={door.open}
          data-testid="door-open"
          onClick={() => doorOp.mutate({ doorId: door.id, op: door.open ? 'close' : 'open' })}
        >
          {door.open ? 'shut it' : 'open it'}
        </button>
        <button
          type="button"
          className={'btn flex-1 py-1 ' + (door.locked ? 'text-warn' : '')}
          aria-pressed={door.locked}
          data-testid={`door-lock-${door.id}`}
          title={door.locked ? 'Unlock: players may open it again' : 'Lock: players cannot open it'}
          onClick={() => doorOp.mutate({ doorId: door.id, op: door.locked ? 'unlock' : 'lock' })}
        >
          {door.locked ? 'unlock' : 'lock'}
        </button>
      </div>
      <Empty>
        {door.locked
          ? 'locked — only you can open it; a player at the handle is told it will not budge'
          : 'players can open and shut it with a click, until you lock it'}
      </Empty>
      <Endpoints a={door.a} b={door.b} onChange={(p) => save(updateDoor(geo, door.id, p))} />
      <div className="flex justify-end">
        <DeleteButton onClick={() => remove(removeDoor(geo, door.id))} />
      </div>
    </>
  );
}

function ZoneFields({ zone, geo, save, remove }: { zone: Zone; geo: Geo; save: Save; remove: (g: Geo) => void }) {
  return (
    <>
      <Row label="name">
        <input
          className={inputCls}
          value={zone.name}
          aria-label="Zone name"
          placeholder="loading dock, the vault…"
          onChange={(e) => save(updateZone(geo, zone.id, { name: e.target.value }))}
        />
      </Row>
      <Row label="colour">
        <span className="flex items-center gap-2">
          <input
            type="color"
            aria-label="Zone colour"
            className="h-7 w-10 rounded border border-edge bg-deck"
            value={zone.color ?? '#1596ab'}
            onChange={(e) => save(updateZone(geo, zone.id, { color: e.target.value }))}
          />
          <span className="mono-label text-faint">only you see the name and the tint</span>
        </span>
      </Row>
      <div className="flex justify-end">
        <DeleteButton onClick={() => remove(removeZone(geo, zone.id))} />
      </div>
    </>
  );
}

function PinFields({
  pin,
  campaignId,
  geo,
  save,
  remove,
}: {
  pin: Pin;
  campaignId: string;
  geo: Geo;
  save: Save;
  remove: (g: Geo) => void;
}) {
  const pages = useWikiPages(campaignId, true);
  const upload = useUploadAttachment();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const isPublic = pin.visibility === 'public';
  const onPatch = (p: PinPatch) => save(updatePin(geo, pin.id, p));

  const attach = (file: File | undefined) => {
    if (!file) return;
    setErr(null);
    upload.mutate(file, {
      onSuccess: ({ id }) => onPatch({ attachmentId: id }),
      onError: (e: unknown) => setErr(e instanceof Error ? e.message : 'upload failed'),
    });
  };

  return (
    <>
      <Row label="label">
        <input
          className={inputCls}
          aria-label="Pin label"
          placeholder="the safe, Mr Johnson's table…"
          value={pin.label ?? ''}
          onChange={(e) => onPatch({ label: e.target.value })}
        />
      </Row>
      <Row label="codex">
        {pages.isError || !pages.data ? (
          <input
            className={inputCls}
            aria-label="Codex page id"
            placeholder="codex page id"
            value={pin.wikiPageId ?? ''}
            onChange={(e) => onPatch({ wikiPageId: e.target.value })}
          />
        ) : (
          <select
            className={inputCls}
            aria-label="Codex page"
            value={pin.wikiPageId ?? ''}
            onChange={(e) => onPatch({ wikiPageId: e.target.value || null })}
          >
            <option value="">— no page —</option>
            {pages.data.map((page) => (
              <option key={page.id} value={page.id}>
                {page.title}
              </option>
            ))}
          </select>
        )}
      </Row>
      <Row label="handout">
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
            <button type="button" className="btn py-1" onClick={() => onPatch({ attachmentId: null })}>
              unlink
            </button>
          </span>
        ) : (
          <button type="button" className="btn w-full py-1" onClick={() => fileRef.current?.click()}>
            upload a handout
          </button>
        )}
      </Row>
      <input
        ref={fileRef}
        type="file"
        className="hidden"
        onChange={(e) => {
          attach(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      {err && <p className="mono-label text-danger">{err}</p>}
      <div className="flex items-center gap-2">
        <button
          type="button"
          className={'btn flex-1 py-1 ' + (isPublic ? 'text-ok' : '')}
          aria-pressed={isPublic}
          data-testid="pin-visibility"
          title="Public pins reach player and TV screens"
          onClick={() => onPatch({ visibility: isPublic ? 'gm' : 'public' })}
        >
          {isPublic ? 'revealed — hide it' : 'private — reveal it'}
        </button>
        <DeleteButton onClick={() => remove(removePin(geo, pin.id))} />
      </div>
      {!isPinLinked(pin) && <Empty>this pin points at nothing yet</Empty>}
    </>
  );
}

function CameraFields({
  camera,
  scene,
  geo,
  save,
  remove,
}: {
  camera: Camera;
  scene: Scene;
  geo: Geo;
  save: Save;
  remove: (g: Geo) => void;
}) {
  const losTokenId = useGridStore((s) => s.losTokenId);
  const setLosTokenId = useGridStore((s) => s.setLosTokenId);
  const levels = sceneLevels(scene);
  const lensOn = losTokenId === cameraLensId(camera.id);
  const onPatch = (p: CameraPatch) => save(updateCamera(geo, camera.id, p));
  return (
    <>
      <Row label="label">
        <input
          className={inputCls}
          aria-label="Camera label"
          value={camera.label ?? ''}
          placeholder={camera.id}
          onChange={(e) => onPatch({ label: e.target.value })}
        />
      </Row>
      <Row label="facing">
        <div className="flex items-center gap-1">
          <Num
            value={camera.facing}
            min={0}
            max={360}
            step={5}
            title="degrees on the plan: 0 east, 90 south"
            onChange={(n) => onPatch({ facing: n })}
          />
          {FACINGS.map((f) => (
            <button
              key={f.label}
              type="button"
              className={
                'mono-label rounded border px-1.5 py-0.5 ' +
                (camera.facing === f.facing ? 'border-cyan text-cyan' : 'border-edge text-dim')
              }
              onClick={() => onPatch({ facing: f.facing })}
            >
              {f.label}
            </button>
          ))}
        </div>
      </Row>
      <Row label="field">
        <Num
          value={camera.fov}
          min={5}
          max={360}
          step={5}
          title="field of view in degrees; 360 is a dome"
          onChange={(n) => onPatch({ fov: n })}
        />
      </Row>
      <Row label="reach">
        <Num
          value={camera.range}
          min={1}
          max={200}
          title="how far it sees, in squares"
          onChange={(n) => onPatch({ range: n })}
        />
      </Row>
      {levels.length > 1 && (
        <Row label="floor">
          <select
            className={inputCls}
            aria-label="Camera floor"
            value={camera.level}
            onChange={(e) => onPatch({ level: Number(e.target.value) })}
          >
            {levels.map((l, i) => (
              <option key={l.name} value={i}>
                {l.name}
              </option>
            ))}
          </select>
        </Row>
      )}
      <div className="flex flex-wrap gap-1">
        <button
          type="button"
          aria-pressed={camera.active}
          className={'btn px-2 py-0.5 ' + (camera.active ? 'border-warn text-warn' : '')}
          onClick={() => onPatch({ active: !camera.active })}
          title="a camera the decker has killed, or a round has — no cone"
        >
          {camera.active ? 'switched on' : 'switched off'}
        </button>
        <button
          type="button"
          aria-pressed={lensOn}
          data-testid="camera-lens"
          className={'btn px-2 py-0.5 ' + (lensOn ? 'border-cyan text-cyan' : '')}
          onClick={() => setLosTokenId(lensOn ? null : cameraLensId(camera.id))}
          title="show the map the way this camera sees it"
        >
          {lensOn ? 'stop looking through it' : 'look through it'}
        </button>
        <DeleteButton
          label="remove"
          onClick={() => {
            if (lensOn) setLosTokenId(null);
            remove(removeCamera(geo, camera.id));
          }}
        />
      </div>
    </>
  );
}

function NoteFields({ note, geo, save, remove }: { note: Note; geo: Geo; save: Save; remove: (g: Geo) => void }) {
  const onPatch = (p: NotePatch) => save(updateNote(geo, note.id, p));
  return (
    <>
      <textarea
        className={inputCls + ' min-h-24 w-full'}
        value={note.text}
        maxLength={NOTE_MAX_CHARS}
        aria-label="note text"
        placeholder="the guard is asleep until someone shoots…"
        onChange={(e) => onPatch({ text: e.target.value })}
      />
      <Row label="width">
        <Num
          value={note.width}
          min={1}
          max={20}
          step={1}
          title="How many cells wide the note is drawn"
          onChange={(n) => onPatch({ width: n })}
        />
      </Row>
      <Row label="paper">
        <div className="flex gap-1">
          {PAPERS.map((p) => (
            <button
              key={p.label}
              type="button"
              className={'btn flex-1 py-0.5 ' + ((note.color ?? null) === p.color ? 'border-cyan text-cyan' : '')}
              onClick={() => onPatch({ color: p.color })}
            >
              {p.label}
            </button>
          ))}
        </div>
      </Row>
      <div className="flex justify-end">
        <DeleteButton onClick={() => remove(removeNote(geo, note.id))} />
      </div>
    </>
  );
}
