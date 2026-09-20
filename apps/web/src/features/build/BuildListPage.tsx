/**
 * `/c/:campaignId/build` — every runner in the making (FR3.9, docs/CHARGEN.md
 * §4.4 "a build can be closed and resumed", §6 decision 3, §8.6).
 *
 * A player sees their own builds, each with its state, and "start a new
 * runner". The GM sees every build in the campaign with its owner's name
 * (from the device list, the only place a user id has a name) and a
 * "waiting for review" filter, which is where the console's "builds waiting"
 * card lands (`?filter=waiting`). An observer or the table TV is told that
 * builds are made by players and the GM, and sent home.
 *
 * A half-made runner lives here and nowhere else until approval: the party
 * roster only ever lists characters (§4.3), so this page is how a draft is
 * found again.
 *
 * A build this version of the app can no longer read (an old draft after the
 * record's schema tightened) comes from the server as a stub — its columns
 * and a flag. It cannot be opened, but it still counts against its owner's
 * open builds and still waits on the GM, so it is listed with its state and
 * a delete button under the same who-and-when rules as any build; before,
 * the list only counted such rows, and nothing in the app could remove one.
 *
 * A build last saved at another creation level or on another priority table
 * than the campaign's now says so on its row: the GM changed the settings
 * since, and the walkthrough will check the build against the new ones when
 * it is opened (`settingsDrift`).
 */
import { useId, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { ChargenSettings, Role, UnreadableBuildDto } from '@safehouse/contracts';
import { getSession } from '../../api/session.js';
import { useDevices } from '../gm/home/api.js';
import { ownerOptions } from '../gm/home/PartyPanel.js';
import { ErrorNote, inputClass, SectionTitle, Spinner } from '../gm/ui.js';
import { useBuildLive, useBuilds, useChargenSettings, useCreateBuild, useDeleteBuild, type BuildRecord } from './api.js';
import {
  BUILD_STATE_LABEL,
  BUILD_STATE_TONE,
  buildAlias,
  buildCounts,
  buildHref,
  canBuild,
  filterBuilds,
  isEditableState,
  isListFilter,
  priorityLine,
  sortBuilds,
  toStep,
  type BuildListFilter,
} from './lib.js';
import { settingsDrift } from './settings/chargenSettings.js';
import { stepMeta } from './steps/meta.js';

export interface BuildListViewProps {
  campaignId: string;
  role: Role | null;
  userId?: string;
  builds: BuildRecord[] | undefined;
  loading: boolean;
  error: unknown;
  unreadable: number;
  /** Rows the server could not read as a build, by their columns (deletable, never openable). */
  stubs?: readonly UnreadableBuildDto[];
  /** Owner user id → name (GM only). */
  owners: ReadonlyMap<string, string>;
  filter: BuildListFilter;
  onFilter: (filter: BuildListFilter) => void;
  onCreate: (alias: string) => void;
  creating: boolean;
  createError: unknown;
  onDelete: (buildId: string) => void;
  deletingId: string | null;
  deleteError: unknown;
  /**
   * The campaign's creation level and table, when read — a row saved under
   * another one says the settings changed since (`settingsDrift`).
   */
  settings?: Pick<ChargenSettings, 'level' | 'table'> | undefined;
}

/** Whether this device may delete a build: its owner while it is editable, the GM before approval. */
export function canDelete(role: Role | null, userId: string | undefined, row: Pick<BuildRecord, 'state' | 'ownerUserId'>): boolean {
  if (row.state === 'approved') return false;
  if (role === 'gm') return true;
  return role === 'player' && isEditableState(row.state) && (userId === undefined || userId === row.ownerUserId);
}

function BuildRow({
  campaignId,
  row,
  owner,
  isGm,
  deletable,
  deleting,
  onDelete,
  settings,
}: {
  campaignId: string;
  row: BuildRecord;
  owner: string | null;
  isGm: boolean;
  deletable: boolean;
  deleting: boolean;
  onDelete: () => void;
  settings: Pick<ChargenSettings, 'level' | 'table'> | undefined;
}) {
  const step = toStep(row.build.step);
  const alias = buildAlias(row);
  const drift = settingsDrift(row.build, row.state, settings);
  return (
    <li
      className="rounded-md border border-edge bg-deck p-3"
      data-build-row={row.id}
      data-state={row.state}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Link
          to={buildHref(campaignId, row.id)}
          className="min-w-0 flex-1 truncate text-base font-semibold text-ink hover:text-cyan"
          data-testid="build-open-link"
        >
          {alias}
        </Link>
        <span className={`chip ${BUILD_STATE_TONE[row.state]}`} data-testid="build-state-chip">
          {BUILD_STATE_LABEL[row.state]}
        </span>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-dim">
        {isGm && <span data-testid="build-owner">by {owner ?? 'an unlisted device'}</span>}
        <span>priorities {priorityLine(row.build)}</span>
        {row.build.metatype && <span>{row.build.metatype}</span>}
        <span>
          at step {step}, {stepMeta(step).title}
        </span>
        <span className="text-faint">updated {row.updatedAt.slice(0, 10)}</span>
      </div>
      {drift && (
        <p className="mt-1.5 text-xs text-warn" data-testid="build-settings-drift">
          {drift}
        </p>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Link to={buildHref(campaignId, row.id)} className={`btn px-3 py-1 ${row.state === 'submitted' && isGm ? 'btn-accent' : ''}`}>
          {row.state === 'submitted' && isGm ? 'review' : isEditableState(row.state) ? 'resume' : 'open'}
        </Link>
        {deletable && <DeleteControl label={`the build for ${alias}`} deleting={deleting} onDelete={onDelete} />}
      </div>
    </li>
  );
}

/** A delete that asks once more before it goes. */
function DeleteControl({ label, deleting, onDelete }: { label: string; deleting: boolean; onDelete: () => void }) {
  const [armed, setArmed] = useState(false);
  return armed ? (
    <>
      <button
        type="button"
        className="btn px-3 py-1 text-danger"
        disabled={deleting}
        onClick={onDelete}
        aria-label={`Delete ${label} for good`}
      >
        {deleting ? 'deleting…' : 'yes, delete'}
      </button>
      <button type="button" className="btn px-3 py-1" onClick={() => setArmed(false)}>
        keep it
      </button>
    </>
  ) : (
    <button type="button" className="btn px-3 py-1 text-dim" onClick={() => setArmed(true)} aria-label={`Delete ${label}`}>
      delete
    </button>
  );
}

/** A row the server could not read: what is known of it, and — for who may — a way to remove it. */
function StubRow({
  row,
  owner,
  isGm,
  deletable,
  deleting,
  onDelete,
}: {
  row: UnreadableBuildDto;
  owner: string | null;
  isGm: boolean;
  deletable: boolean;
  deleting: boolean;
  onDelete: () => void;
}) {
  const label = `the unreadable build from ${row.updatedAt.slice(0, 10)}`;
  return (
    <li className="rounded-md border border-dashed border-warn/40 bg-deck p-3" data-build-stub={row.id} data-state={row.state}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1 text-sm text-dim">A build this version of the app cannot open</span>
        <span className={`chip ${BUILD_STATE_TONE[row.state]}`}>{BUILD_STATE_LABEL[row.state]}</span>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-dim">
        {isGm && <span>by {owner ?? 'an unlisted device'}</span>}
        <span className="text-faint">updated {row.updatedAt.slice(0, 10)}</span>
      </div>
      {deletable && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <DeleteControl label={label} deleting={deleting} onDelete={onDelete} />
        </div>
      )}
    </li>
  );
}

export function BuildListView(props: BuildListViewProps) {
  const { campaignId, role, builds, filter } = props;
  const [alias, setAlias] = useState('');
  const stubsTitleId = useId();
  const isGm = role === 'gm';

  if (!canBuild(role)) {
    return (
      <div className="p-6">
        <div className="panel mx-auto max-w-md p-6 text-center" data-testid="builds-not-for-role">
          <div className="mono-label text-cyan">Builds</div>
          <p className="mt-2 text-sm text-dim">
            Runners are built by the players and the GM. This device joined to watch, so there is nothing to make here.
          </p>
          <Link to={`/c/${campaignId}`} className="btn mt-4 inline-flex px-3 py-1.5">
            back to the campaign
          </Link>
        </div>
      </div>
    );
  }

  const rows = sortBuilds(builds ?? []);
  const stubs = isGm && filter === 'waiting' ? (props.stubs ?? []).filter((s) => s.state === 'submitted') : (props.stubs ?? []);
  const counts = buildCounts(rows);
  const shown = isGm ? filterBuilds(rows, filter) : rows;

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 pb-8 sm:p-6" data-testid="build-list-page">
      <div>
        <SectionTitle>Builds</SectionTitle>
        <p className="mt-1 text-sm text-dim">
          A runner built step by step through the book's nine steps, checked as you go, then sent to the GM for approval.
          A build that is not finished waits here until you come back to it.
        </p>
      </div>

      <form
        className="panel flex flex-wrap items-end gap-2 p-3"
        data-testid="start-build"
        onSubmit={(e) => {
          e.preventDefault();
          props.onCreate(alias.trim());
        }}
      >
        <label className="min-w-0 flex-1">
          <span className="mono-label block">Street name (optional)</span>
          <input
            className={`${inputClass} mt-1`}
            value={alias}
            onChange={(e) => setAlias(e.target.value)}
            aria-label="New runner's street name"
          />
        </label>
        <button type="submit" className="btn btn-accent shrink-0 px-3 py-1.5" disabled={props.creating}>
          {props.creating ? 'starting…' : 'start a new runner'}
        </button>
        <div className="basis-full">
          <ErrorNote error={props.createError} />
        </div>
      </form>

      {isGm && (
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Which builds to show">
          {(['all', 'waiting'] as const).map((f) => (
            <button
              key={f}
              type="button"
              className={`chip pointer-coarse:min-h-10 ${filter === f ? 'border-cyan text-cyan' : 'text-dim'}`}
              aria-pressed={filter === f}
              data-filter={f}
              onClick={() => props.onFilter(f)}
            >
              {f === 'all' ? `all (${rows.length})` : `waiting for review (${counts.waiting})`}
            </button>
          ))}
        </div>
      )}

      {props.loading && <Spinner label="loading builds" />}
      <ErrorNote error={props.error} />
      <ErrorNote error={props.deleteError} />
      {props.unreadable > 0 && (
        <p className="text-xs text-warn">
          {props.unreadable} {props.unreadable === 1 ? 'build' : 'builds'} could not be read by this version of the app.
        </p>
      )}
      {stubs.length > 0 && (
        <section aria-labelledby={stubsTitleId} data-testid="build-stubs">
          <h2 id={stubsTitleId} className="mono-label text-warn">
            Builds that can no longer be opened
          </h2>
          <p className="mt-1 text-xs text-dim">
            These were saved by an older version of the builder and no longer read as a runner. They still count as open
            builds; delete one to clear it away.
          </p>
          <ul className="mt-2 space-y-2">
            {stubs.map((stub) => (
              <StubRow
                key={stub.id}
                row={stub}
                owner={props.owners.get(stub.ownerUserId) ?? null}
                isGm={isGm}
                deletable={canDelete(role, props.userId, stub)}
                deleting={props.deletingId === stub.id}
                onDelete={() => props.onDelete(stub.id)}
              />
            ))}
          </ul>
        </section>
      )}

      {!props.loading && builds && shown.length === 0 && stubs.length === 0 && (
        <div className="rounded-md border border-dashed border-edge-bright bg-deck/40 p-5 text-center" data-testid="builds-empty">
          <div className="mono-label text-cyan">
            {isGm && filter === 'waiting' ? 'Nothing waiting for review' : 'No builds yet'}
          </div>
          <p className="mx-auto mt-2 max-w-md text-sm text-dim">
            {isGm && filter === 'waiting'
              ? 'When a player submits a runner it appears here for you to approve or return with a note.'
              : 'Give the runner a street name above, or leave it blank, and start; the walkthrough takes it from there.'}
          </p>
        </div>
      )}

      {shown.length > 0 && (
        <ul className="space-y-2" data-testid="build-list">
          {shown.map((row) => (
            <BuildRow
              key={row.id}
              campaignId={campaignId}
              row={row}
              owner={props.owners.get(row.ownerUserId) ?? null}
              isGm={isGm}
              deletable={canDelete(role, props.userId, row)}
              deleting={props.deletingId === row.id}
              onDelete={() => props.onDelete(row.id)}
              settings={props.settings}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

export default function BuildListPage() {
  const { campaignId } = useParams<{ campaignId: string }>();
  const navigate = useNavigate();
  const [search, setSearch] = useSearchParams();
  const session = getSession();
  const role = session?.role ?? null;
  const isGm = role === 'gm';
  const builds = useBuilds(campaignId, { enabled: canBuild(role) });
  // Only for the rows' "settings changed" hint; a list that cannot read them shows none.
  const chargen = useChargenSettings(canBuild(role) ? campaignId : undefined);
  // Owner names come from the device list, which only a GM may read.
  const devices = useDevices(isGm ? (campaignId ?? '') : '');
  const create = useCreateBuild(campaignId ?? '');
  const remove = useDeleteBuild(campaignId ?? '');
  useBuildLive(campaignId);
  if (!campaignId) return null;

  const raw = search.get('filter');
  const filter: BuildListFilter = isListFilter(raw) ? raw : 'all';
  const owners = new Map(ownerOptions(devices.data ?? []).map((o) => [o.userId, o.label]));

  return (
    <BuildListView
      campaignId={campaignId}
      role={role}
      {...(session?.userId ? { userId: session.userId } : {})}
      builds={builds.data?.builds}
      loading={builds.isPending && canBuild(role)}
      error={builds.error}
      unreadable={builds.data?.unreadable ?? 0}
      stubs={builds.data?.stubs ?? []}
      owners={owners}
      filter={filter}
      onFilter={(f) => setSearch(f === 'all' ? {} : { filter: f }, { replace: true })}
      onCreate={(alias) =>
        create.mutate(alias ? { alias } : {}, {
          onSuccess: (record) => navigate(buildHref(campaignId, record.id)),
        })
      }
      creating={create.isPending}
      createError={create.error}
      onDelete={(id) => remove.mutate(id)}
      deletingId={remove.isPending ? (remove.variables ?? null) : null}
      deleteError={remove.error}
      settings={chargen.data}
    />
  );
}
