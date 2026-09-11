/**
 * Create a scene: name, an optional map image, and the one number that makes
 * every distance in the app mean something — metres per square (FR9.1).
 *
 * It defaults to 1 m because that is what SR5 measures in, and it says so, so a
 * GM who uploads a floor plan drawn at 2 m squares knows where to change it.
 * The map upload is optional on purpose: a scene with no image is still a grid
 * you can put tokens on, and making the picture mandatory would block the
 * five-minute "they get jumped in an alley" scene.
 */
import { useRef, useState } from 'react';
import { blankSceneDraft, normalizeDraft, type NewSceneDraft } from './summary.js';

export interface CreateSceneSubmit extends NewSceneDraft {
  file: File | null;
  /** Activate it the moment it exists — the table is waiting. */
  activate: boolean;
}

export interface CreateSceneFormProps {
  /** Rendered large and first when the campaign has no scenes at all. */
  emptyState?: boolean;
  pending?: boolean;
  /** Upload/create failure, already stringified. */
  error?: string | null;
  onSubmit: (input: CreateSceneSubmit) => void;
}

const inputClass =
  'w-full rounded-md border border-edge bg-deck px-2.5 py-1.5 text-sm text-ink ' +
  'placeholder:text-faint focus:border-cyan focus:outline-none';

export default function CreateSceneForm({
  emptyState = false,
  pending = false,
  error = null,
  onSubmit,
}: CreateSceneFormProps) {
  const [draft, setDraft] = useState<NewSceneDraft>(blankSceneDraft);
  const [file, setFile] = useState<File | null>(null);
  const [activate, setActivate] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const clean = normalizeDraft(draft);
  const ready = clean.name.length > 0 && !pending;

  const submit = () => {
    if (!ready) return;
    onSubmit({ ...clean, file, activate });
    setDraft(blankSceneDraft());
    setFile(null);
    setActivate(false);
    if (fileRef.current) fileRef.current.value = '';
  };

  return (
    <section className="panel p-4" data-testid="create-scene">
      <div className="mono-label text-cyan">New scene</div>
      {emptyState && (
        <p className="mt-2 max-w-prose text-sm text-dim" data-testid="scenes-empty">
          A scene is one map the table plays on — a grid, an optional floor plan or phone photo,
          the light and weather, and the fog you peel back as they explore. Nothing has been
          created for this campaign yet, so the table has no map to look at. Make one here, then
          draw on it on the Map.
        </p>
      )}

      {/*
        `noValidate`, and it is load-bearing.

        The first version of this form carried `min={0.1} step={0.5}` on metres
        per square and defaulted the field to 1 — and 1 is not on that step
        ladder (0.1, 0.6, 1.1…). Chrome therefore refused to fire `submit` at
        all: a GM typed a scene name, clicked "create scene", and NOTHING
        happened, for ever, because the browser was blocking on a field they had
        never touched. The unit tests were green the whole time — they render
        this component to HTML, and constraint validation only exists in a real
        browser. It was found by clicking the button in one.

        `normalizeDraft` is the only validator here: it clamps whatever is in
        the boxes into something the server accepts, and the submit button is
        already disabled (with a title saying why) until there is a name. Native
        validation can therefore only take the form back to silent refusal, so
        it is off — and `step="any"` below keeps the spinner arrows honest.
      */}
      <form
        noValidate
        className="mt-3 grid gap-3 md:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <label className="block md:col-span-2">
          <span className="mono-label block">Name</span>
          <input
            className={inputClass}
            placeholder="Aztechnology loading dock"
            aria-label="Scene name"
            value={draft.name}
            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
          />
        </label>

        <label className="block">
          <span className="mono-label block">Metres per square</span>
          <input
            className={inputClass}
            type="number"
            min={0.1}
            step="any"
            aria-label="Metres per square"
            value={draft.unitM}
            onChange={(e) => setDraft((d) => ({ ...d, unitM: Number(e.target.value) }))}
          />
          <span className="mono-label mt-1 block text-faint">
            SR5 measures in metres — 1 m per square unless your floor plan says otherwise
          </span>
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mono-label block">Columns</span>
            <input
              className={inputClass}
              type="number"
              min={1}
              aria-label="Columns"
              value={draft.cols}
              onChange={(e) => setDraft((d) => ({ ...d, cols: Number(e.target.value) }))}
            />
          </label>
          <label className="block">
            <span className="mono-label block">Rows</span>
            <input
              className={inputClass}
              type="number"
              min={1}
              aria-label="Rows"
              value={draft.rows}
              onChange={(e) => setDraft((d) => ({ ...d, rows: Number(e.target.value) }))}
            />
          </label>
        </div>

        <label className="block md:col-span-2">
          <span className="mono-label block">Map image (optional)</span>
          <input
            ref={fileRef}
            className={inputClass + ' file:mr-3 file:rounded file:border-0 file:bg-raised file:px-2 file:py-1 file:text-xs file:text-ink'}
            type="file"
            accept="image/*"
            aria-label="Map image"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          <span className="mono-label mt-1 block text-faint">
            a floor plan, a phone photo of a hand-drawn map, or nothing at all · rotate, crop and
            contrast live on the Map&apos;s Setup tab
          </span>
        </label>

        <div className="flex flex-wrap items-center gap-3 md:col-span-2">
          <label className="flex items-center gap-2 text-xs text-dim">
            <input
              type="checkbox"
              checked={activate}
              aria-label="Put it on the table now"
              onChange={(e) => setActivate(e.target.checked)}
            />
            put it on the table now (activates for players and the TV)
          </label>
          <span className="mono-label text-faint">
            {clean.cols} × {clean.rows} squares = {round(clean.cols * clean.unitM)} ×{' '}
            {round(clean.rows * clean.unitM)} m
          </span>
          <button
            type="submit"
            className="btn btn-accent ml-auto px-3 py-1.5 disabled:cursor-not-allowed disabled:opacity-40"
            disabled={!ready}
            title={clean.name.length === 0 ? 'Give the scene a name first' : 'Create the scene'}
          >
            {pending ? 'creating…' : 'create scene'}
          </button>
        </div>
      </form>

      {error && (
        <p className="mt-2 text-xs text-danger" data-testid="create-error">
          {error}
        </p>
      )}
    </section>
  );
}

function round(n: number): string {
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}
