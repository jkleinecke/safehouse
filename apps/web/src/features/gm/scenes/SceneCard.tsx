/**
 * One scene, as a card in the manager.
 *
 * Pure presentation: every mutation is a callback the page owns, so this file
 * renders to markup in a test without a QueryClient and without a server.
 *
 * The card answers, without a click: what does this map look like, how big is a
 * square, how many figures are standing on it, which fog regions exist and
 * which are open, what the weather is doing to the dice — and whether the table
 * is looking at this one right now. Everything that needs a canvas under the
 * cursor (walls, painting fog, dragging tokens) is one link away and the card
 * says so, because a GM who cannot tell which screen owns which job goes
 * hunting.
 */
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { Scene } from '@safehouse/contracts';
import { fileUrl } from './api.js';
import { cssFilter, normalizeRotation, parseMapImageRef } from '../../grid/mapImage.js';
import EnvironmentEditor from './EnvironmentEditor.js';
import {
  archiveBlockedReason,
  deleteWarning,
  describeGeometry,
  describeGrid,
  envSummaryText,
  type EnvAxis,
  type SceneSummary,
} from './summary.js';

export type SceneBusy = 'activate' | 'duplicate' | 'archive' | 'delete' | 'rename' | 'save' | null;

export interface SceneCardProps {
  scene: Scene;
  summary: SceneSummary;
  /** Deep link to this scene's canvas. */
  gridHref: string;
  busy?: SceneBusy;
  /** Non-null while the name is being edited. */
  renameDraft?: string | null;
  confirmingDelete?: boolean;
  error?: string | null;
  onActivate: () => void;
  onOpenInGrid: () => void;
  onStartRename: () => void;
  onRenameDraft: (next: string) => void;
  onCommitRename: () => void;
  onCancelRename: () => void;
  onDuplicate: () => void;
  onArchive: () => void;
  onRestore: () => void;
  onAskDelete: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
  onEnvChange: (axis: EnvAxis, level: number) => void;
  onFog: (regionId: string, reveal: boolean) => void;
  onRefogAll: () => void;
  /** GM-only prep text (`Scene.notes`) — edited here or nowhere. */
  notesValue: string;
  notesDirty: boolean;
  onNotesDraft: (next: string) => void;
  onSaveNotes: () => void;
}

const inputClass =
  'w-full rounded-md border border-edge bg-deck px-2 py-1 text-sm text-ink ' +
  'placeholder:text-faint focus:border-cyan focus:outline-none';

/** Disabled buttons must LOOK disabled — the theme's .btn does not do it. */
const btn = 'btn px-3 py-1.5 disabled:cursor-not-allowed disabled:opacity-40';

function Meta({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span className="mono-label text-faint">{label}</span>
      <span className="text-xs text-ink">{children}</span>
    </span>
  );
}

export default function SceneCard(props: SceneCardProps) {
  const { scene, summary, busy = null, renameDraft = null, confirmingDelete = false } = props;
  const archiveBlocked = archiveBlockedReason(summary);
  const anyBusy = busy !== null;

  return (
    <article
      data-testid="scene-card"
      data-scene-id={scene.id}
      data-scene-state={summary.isLive ? 'live' : summary.isArchived ? 'archived' : 'draft'}
      className={
        'panel flex flex-col gap-3 p-3' +
        (summary.isLive ? ' border-ok/60' : '') +
        (summary.isArchived ? ' opacity-70' : '')
      }
    >
      {/* --- identity ------------------------------------------------------ */}
      <div className="flex items-start gap-3">
        <Thumbnail summary={summary} />
        <div className="min-w-0 flex-1">
          {renameDraft !== null ? (
            <div className="flex items-center gap-2">
              <input
                className={inputClass}
                aria-label={`Rename ${scene.name}`}
                value={renameDraft}
                autoFocus
                onChange={(e) => props.onRenameDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') props.onCommitRename();
                  if (e.key === 'Escape') props.onCancelRename();
                }}
              />
              <button
                type="button"
                className={btn}
                disabled={renameDraft.trim().length === 0 || busy === 'rename'}
                onClick={props.onCommitRename}
              >
                save
              </button>
              <button type="button" className={btn} onClick={props.onCancelRename}>
                cancel
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="truncate text-sm font-semibold text-ink">{scene.name}</h3>
              {summary.isLive && (
                <span className="chip border-ok/50 text-ok" data-testid="live-badge">
                  live · on the table
                </span>
              )}
              {summary.isArchived && <span className="chip text-faint">archived</span>}
            </div>
          )}

          <div className="mt-1.5 flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <Meta label="grid">{describeGrid(summary)}</Meta>
          </div>
          <div className="mt-1 flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <Meta label="tokens">
              {summary.tokens === null ? (
                <span className="text-dim">counting…</span>
              ) : (
                <span data-testid="token-count">
                  {summary.tokens.hidden > 0
                    ? `${summary.tokens.total} · ${summary.tokens.hidden} hidden`
                    : String(summary.tokens.total)}
                </span>
              )}
            </Meta>
            <Meta label="fog">
              <span data-testid="fog-count">
                {summary.fog.length === 0
                  ? 'no regions'
                  : `${summary.fogRevealed}/${summary.fog.length} revealed`}
              </span>
            </Meta>
            <Meta label="map">
              {summary.mapCount === 0
                ? 'none uploaded'
                : `${summary.mapCount} image${summary.mapCount === 1 ? '' : 's'}`}
            </Meta>
            <Meta label="drawn">{describeGeometry(summary)}</Meta>
            <Meta label="env">
              <span data-testid="env-chip">
                {summary.env.clear
                  ? envSummaryText(summary.env)
                  : `${envSummaryText(summary.env)} (${summary.env.value} to every pool)`}
              </span>
            </Meta>
          </div>
        </div>
      </div>

      {/* --- the two things a GM does from a list --------------------------- */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={btn + ' btn-accent'}
          disabled={summary.isLive || anyBusy}
          onClick={props.onActivate}
          title={
            summary.isLive
              ? 'Already on the table'
              : 'Push this scene to every player device and the TV'
          }
        >
          {summary.isLive ? 'on the table' : busy === 'activate' ? 'activating…' : 'activate'}
        </button>
        <Link
          to={props.gridHref}
          onClick={props.onOpenInGrid}
          className={btn}
          data-testid="open-in-grid"
          title="Draw walls, paint fog and place tokens on the canvas"
        >
          open in Grid ↗
        </Link>
        <span className="mono-label text-faint">
          walls, fog painting and tokens are canvas work — this screen is the list
        </span>
      </div>

      {/* --- environment (FR9.11) ------------------------------------------ */}
      <details open={summary.isLive} className="rounded-md border border-edge p-2">
        <summary className="mono-label cursor-pointer text-cyan">
          {summary.env.clear
            ? 'environment · clear'
            : `environment · ${summary.env.value} to every pool`}
        </summary>
        <div className="mt-2">
          <EnvironmentEditor
            sceneId={scene.id}
            env={scene.environment}
            readout={summary.env}
            saving={busy === 'save'}
            disabled={summary.isArchived}
            onChange={props.onEnvChange}
          />
        </div>
      </details>

      {/* --- fog regions (FR9.14) ------------------------------------------ */}
      {summary.fog.length > 0 && (
        <details className="rounded-md border border-edge p-2" data-testid="fog-regions">
          <summary className="mono-label cursor-pointer text-cyan">
            {`fog regions · ${summary.fogRevealed}/${summary.fog.length} revealed`}
          </summary>
          <ul className="mt-2 space-y-1">
            {summary.fog.map(({ region, revealed }) => (
              <li key={region.id} className="flex items-center gap-2" data-region-id={region.id}>
                <span
                  className={'chip ' + (revealed ? 'border-ok/50 text-ok' : 'text-faint')}
                  data-region-state={revealed ? 'revealed' : 'hidden'}
                >
                  {revealed ? 'open' : 'fogged'}
                </span>
                <span className="min-w-0 flex-1 truncate text-xs text-ink">{region.name}</span>
                <button
                  type="button"
                  className={btn + ' py-1'}
                  disabled={anyBusy}
                  onClick={() => props.onFog(region.id, !revealed)}
                  title={
                    revealed
                      ? 'Fog this region back over for players and the TV'
                      : 'Reveal this region to players and the TV now'
                  }
                >
                  {revealed ? 'hide' : 'reveal'}
                </button>
              </li>
            ))}
          </ul>
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              className={btn + ' py-1'}
              disabled={anyBusy}
              onClick={props.onRefogAll}
              title="Re-fog the whole scene, including anything painted freehand"
            >
              re-fog everything
            </button>
            {summary.freehandReveals > 0 && (
              <span className="mono-label text-faint">
                {`+ ${summary.freehandReveals} painted reveal${
                  summary.freehandReveals === 1 ? '' : 's'
                }`}
              </span>
            )}
          </div>
          <p className="mono-label mt-2 text-faint">
            regions are painted and named on the canvas — revealing one is instant at the table
          </p>
        </details>
      )}

      {/* --- GM notes: prep text with nowhere else to live ------------------ */}
      <details className="rounded-md border border-edge p-2" data-testid="scene-notes">
        <summary className="mono-label cursor-pointer text-cyan">
          {scene.notes && scene.notes.trim().length > 0 ? 'GM notes · written' : 'GM notes · empty'}
        </summary>
        <textarea
          className={inputClass + ' mt-2 min-h-24 font-mono text-xs'}
          aria-label={`GM notes for ${scene.name}`}
          placeholder="What they hear before they see it. Where the guards actually are. Read-aloud text."
          value={props.notesValue}
          onChange={(e) => props.onNotesDraft(e.target.value)}
        />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={btn + ' py-1'}
            disabled={!props.notesDirty || busy === 'save'}
            onClick={props.onSaveNotes}
          >
            {busy === 'save' ? 'saving…' : 'save notes'}
          </button>
          <span className="mono-label text-faint">
            GM only — the server strips notes out of every player and TV payload
          </span>
        </div>
      </details>

      {/* --- housekeeping --------------------------------------------------- */}
      <div className="flex flex-wrap items-center gap-2 border-t border-edge pt-2">
        <button type="button" className={btn + ' py-1'} disabled={anyBusy} onClick={props.onStartRename}>
          rename
        </button>
        <button
          type="button"
          className={btn + ' py-1'}
          disabled={anyBusy}
          onClick={props.onDuplicate}
          title="Copy the map, calibration, environment, geometry and fog regions into a new scene"
        >
          {busy === 'duplicate' ? 'duplicating…' : 'duplicate'}
        </button>
        {summary.isArchived ? (
          <button type="button" className={btn + ' py-1'} disabled={anyBusy} onClick={props.onRestore}>
            restore
          </button>
        ) : (
          <button
            type="button"
            className={btn + ' py-1'}
            disabled={anyBusy || archiveBlocked !== null}
            onClick={props.onArchive}
            title={archiveBlocked ?? 'Keep it, hide it from the working list'}
          >
            archive
          </button>
        )}
        <button
          type="button"
          className={btn + ' py-1 ml-auto border-danger/50 text-danger'}
          disabled={anyBusy}
          onClick={props.onAskDelete}
        >
          delete
        </button>
      </div>

      {archiveBlocked && !summary.isArchived && (
        <p className="mono-label text-faint">{archiveBlocked}</p>
      )}

      {confirmingDelete && (
        <div
          className="rounded-md border border-danger/50 bg-danger/10 p-2.5"
          data-testid="delete-confirm"
        >
          <p className="text-xs text-danger">{deleteWarning(summary)}</p>
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              className={btn + ' py-1 border-danger/60 text-danger'}
              disabled={busy === 'delete'}
              onClick={props.onConfirmDelete}
            >
              {busy === 'delete' ? 'deleting…' : 'delete permanently'}
            </button>
            <button type="button" className={btn + ' py-1'} onClick={props.onCancelDelete}>
              keep it
            </button>
          </div>
        </div>
      )}

      {props.error && (
        <p className="text-xs text-danger" data-testid="scene-error">
          {props.error}
        </p>
      )}
    </article>
  );
}

/** Map preview, honest when there is no map yet. */
function Thumbnail({ summary }: { summary: SceneSummary }) {
  if (!summary.mapRef) {
    return (
      <div
        className="grid h-16 w-24 shrink-0 place-items-center rounded border border-dashed border-edge bg-deck text-center"
        data-testid="no-map"
      >
        <span className="mono-label text-faint">no map</span>
      </div>
    );
  }
  const ref = parseMapImageRef(summary.mapRef);
  return (
    <img
      src={fileUrl(ref.id)}
      alt={`${summary.name} map`}
      data-testid="scene-thumbnail"
      style={{
        filter: cssFilter(ref),
        transform: `rotate(${normalizeRotation(ref.rotateDeg)}deg)`,
      }}
      className="h-16 w-24 shrink-0 rounded border border-edge object-cover"
    />
  );
}
