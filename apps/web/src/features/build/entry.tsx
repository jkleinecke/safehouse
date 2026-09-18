/**
 * The doors into the builder from the rest of the app (FR3.9, docs/CHARGEN.md
 * §6 decision 3, §8.6 "Entry points").
 *
 * Three small controls, each where its person already looks:
 *
 * - `BuildRunnerButton` — beside "new blank sheet" and "import .chum5" in
 *   `AddCharacter`, on the GM's party roster and console. It starts a draft
 *   with the street name already typed there and opens it.
 * - `PlayerBuildsCard` — on a player's home: resume a build, or start one.
 *   A player with no sheet used to be told only to ask the GM for one.
 * - `BuildsWaitingCard` — on the GM console: how many builds wait for
 *   review, one tap to the filtered list.
 *
 * Both cards listen to the review loop's events (`useBuildLive`): a GM sitting
 * on the console sees a submit arrive, and a player on their home screen sees
 * an approval or a return, without navigating away and back.
 *
 * Every one is role-gated (a GM or a player; never an observer or the table
 * TV) — as courtesy only, the server filters (Principle 4). This file and
 * `api.ts` are the only parts of `features/build/` the rest of the app may
 * import statically; the walkthrough itself stays a lazy chunk
 * (`router.chunks.test.ts`).
 */
import { Link, useNavigate } from 'react-router-dom';
import type { Role } from '@safehouse/contracts';
import { getSession } from '../../api/session.js';
import { useBuildLive, useBuilds, useCreateBuild } from './api.js';
import { BUILD_STATE_LABEL, BUILD_STATE_TONE, buildAlias, buildCounts, buildHref, buildListHref, canBuild, sortBuilds } from './lib.js';

function roleNow(): Role | null {
  return getSession()?.role ?? null;
}

export interface BuildRunnerButtonProps {
  campaignId: string;
  /** The street name typed beside the button, if any. */
  name?: string;
  className?: string;
}

/** "build a runner": start a draft (with the typed name) and open the walkthrough. GM or player only. */
export function BuildRunnerButton({ campaignId, name, className }: BuildRunnerButtonProps) {
  const navigate = useNavigate();
  const create = useCreateBuild(campaignId);
  if (!canBuild(roleNow())) return null;
  const alias = name?.trim();
  return (
    <>
      <button
        type="button"
        className={className ?? 'btn shrink-0 px-3 py-1.5'}
        data-testid="build-runner"
        disabled={create.isPending}
        title="Walk through the book's nine creation steps, checked as you go"
        onClick={() =>
          create.mutate(alias ? { alias } : {}, {
            onSuccess: (record) => navigate(buildHref(campaignId, record.id)),
          })
        }
      >
        {create.isPending ? 'starting…' : 'build a runner'}
      </button>
      {create.error && (
        <span className="basis-full text-xs text-danger" role="alert">
          {create.error instanceof Error ? create.error.message : String(create.error)}
        </span>
      )}
    </>
  );
}

/** A player's home card: their builds, or the way to start one. Players only. */
export function PlayerBuildsCard({ campaignId, hasCharacter }: { campaignId: string; hasCharacter: boolean }) {
  const isPlayer = roleNow() === 'player';
  const builds = useBuilds(campaignId, { enabled: isPlayer });
  useBuildLive(isPlayer ? campaignId : undefined);
  if (!isPlayer) return null;
  const rows = sortBuilds(builds.data?.builds ?? []).filter((b) => b.state !== 'approved');

  return (
    <div className="panel p-4" data-testid="player-builds-card">
      <div className="flex items-baseline justify-between gap-2">
        <div className="font-label text-sm uppercase tracking-widest text-cyan">Build a runner</div>
        <Link to={buildListHref(campaignId)} className="mono-label inline-flex min-h-10 items-center px-1 text-dim hover:text-cyan">
          all builds
        </Link>
      </div>
      {rows.length === 0 ? (
        <p className="mt-1 text-sm text-dim">
          {hasCharacter
            ? 'Make another runner step by step; the GM approves it before it joins the party.'
            : 'No sheet yet? Build your runner step by step, checked as you go, and send it to the GM to approve.'}
        </p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {rows.slice(0, 3).map((row) => (
            <li key={row.id} className="flex items-center gap-2">
              <Link to={buildHref(campaignId, row.id)} className="min-w-0 flex-1 truncate text-sm text-ink hover:text-cyan">
                {buildAlias(row)}
              </Link>
              <span className={`chip ${BUILD_STATE_TONE[row.state]}`}>{BUILD_STATE_LABEL[row.state]}</span>
            </li>
          ))}
        </ul>
      )}
      <Link to={buildListHref(campaignId)} className="btn mt-3 inline-flex px-3 py-1.5" data-testid="player-build-start">
        {rows.length === 0 ? 'start a new runner' : 'resume or start another'}
      </Link>
    </div>
  );
}

/** The GM console's card: builds waiting for review, and those still being made. GM only. */
export function BuildsWaitingCard({ campaignId }: { campaignId: string }) {
  const isGm = roleNow() === 'gm';
  const builds = useBuilds(campaignId, { enabled: isGm });
  useBuildLive(isGm ? campaignId : undefined);
  if (!isGm) return null;
  const counts = buildCounts(builds.data?.builds ?? []);

  return (
    <div className="panel p-4" data-testid="builds-waiting-card" data-waiting={counts.waiting}>
      <div className="flex items-baseline justify-between gap-3">
        <div className="mono-label text-cyan">Character builds</div>
        <div className="mono-label text-faint">runners in the making</div>
      </div>
      {builds.isError ? (
        <p className="mt-2 text-sm text-danger">
          {builds.error instanceof Error ? builds.error.message : 'The builds list could not be read.'}
        </p>
      ) : (
        <p className="mt-2 text-sm text-dim">
          {builds.data === undefined
            ? 'Checking for builds…'
            : counts.waiting > 0
              ? `${counts.waiting} ${counts.waiting === 1 ? 'build is' : 'builds are'} waiting for your review.`
              : counts.inProgress > 0
                ? `Nothing waiting; ${counts.inProgress} ${counts.inProgress === 1 ? 'build is' : 'builds are'} still being made.`
                : 'No builds yet. Players start one from their home screen; you can build one from the Party roster.'}
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {counts.waiting > 0 && (
          <Link to={buildListHref(campaignId, 'waiting')} className="btn btn-accent px-3 py-1.5" data-testid="builds-review-link">
            review {counts.waiting}
          </Link>
        )}
        <Link to={buildListHref(campaignId)} className="btn px-3 py-1.5" data-testid="builds-all-link">
          all builds
        </Link>
      </div>
    </div>
  );
}
