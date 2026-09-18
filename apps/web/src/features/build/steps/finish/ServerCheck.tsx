/**
 * The server's own check of the build, beside this page's (FR3.9,
 * docs/CHARGEN.md §8.6 "check is fetched before submit and on the Finish
 * step").
 *
 * The walkthrough validates in the browser on every tap, which is what makes
 * the rail instant — but Submit and approval are the server's to refuse, and
 * the server checks the row it holds, with the engine it was built with. So
 * the Finish step shows that check too: loading while it is read, the error
 * in words when it cannot be, a line saying the two agree when they do, and —
 * when they do not — which findings only the server has and which only this
 * page has, each with its step and page. The usual reason is honest and
 * short-lived (an edit that has not saved yet), so the line says so and
 * offers the refresh rather than alarming anyone.
 *
 * Which face shows is `checkFace` (pure, in `checklist.ts`); this is its
 * markup.
 */
import { useId } from 'react';
import type { BuildStep, Issue } from '@safehouse/contracts';
import { RefChip } from '../../../gm/books/RefChip.js';
import { stepMeta } from '../meta.js';
import type { BuildActions } from '../types.js';
import { checkFace, plural } from './checklist.js';

export interface ServerCheckProps {
  check: BuildActions['check'];
  /** This page's issues (`allIssues`). */
  local: readonly Issue[];
  onGoTo: (step: BuildStep) => void;
  /** Whose screen: a player is told the server checks again before submitting; a GM reviewing is past that. */
  audience?: 'player' | 'review';
  testId?: string;
}

function DiffList({ title, issues, onGoTo, testId }: { title: string; issues: readonly Issue[]; onGoTo: (step: BuildStep) => void; testId: string }) {
  if (issues.length === 0) return null;
  return (
    <div className="mt-2" data-testid={testId}>
      <h3 className="mono-label text-dim">{title}</h3>
      <ul className="mt-1 space-y-1.5">
        {issues.map((issue, i) => (
          <li key={`${issue.code}-${issue.path ?? ''}-${i}`} className="flex flex-wrap items-center gap-1.5 text-sm text-ink" data-issue={issue.code} data-severity={issue.severity}>
            <span>
              <span className="sr-only">{issue.severity}: </span>
              {issue.message}
            </span>
            <button
              type="button"
              className="chip text-dim hover:text-cyan pointer-coarse:min-h-10"
              onClick={() => onGoTo(issue.step)}
              aria-label={`step ${issue.step} — go to ${stepMeta(issue.step).title}`}
            >
              step {issue.step}
            </button>
            <RefChip refValue={issue.ref} className="pointer-coarse:min-h-10" />
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function ServerCheck({ check, local, onGoTo, audience = 'player', testId = 'finish-server-check' }: ServerCheckProps) {
  const headingId = useId();
  const { face, diff } = checkFace(check, local);
  const errors = check.data ? check.data.issues.filter((i) => i.severity === 'error').length : 0;
  const gm = check.data ? check.data.issues.filter((i) => i.severity === 'approval').length : 0;
  const refreshing = check.loading && face !== 'loading';

  return (
    <section aria-labelledby={headingId} className="panel p-3 sm:p-4" data-testid={testId} data-face={face} aria-busy={check.loading}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={headingId} className="text-base font-semibold text-ink">
          The server&apos;s check
        </h2>
        <button
          type="button"
          className={`btn px-3 py-1.5 ${check.loading ? 'cursor-wait opacity-60' : ''}`}
          onClick={() => {
            if (!check.loading) check.refresh();
          }}
          {...(check.loading ? { 'aria-disabled': 'true' as const } : {})}
          data-testid={`${testId}-refresh`}
          data-print-hide=""
        >
          {check.loading ? 'checking…' : face === 'idle' ? 'check now' : 'check again'}
        </button>
      </div>

      {face === 'idle' && (
        <p className="mt-1.5 text-sm text-dim">
          The server has not checked this build yet.{audience === 'player' ? ' It checks again before anything is submitted.' : ''}
        </p>
      )}
      {face === 'loading' && (
        <p className="mt-1.5 text-sm text-dim" role="status">
          Checking the saved build on the server…
        </p>
      )}
      {face === 'error' && (
        <p className="mt-1.5 text-sm text-danger" role="alert">
          The server&apos;s check could not be read: {check.error}
        </p>
      )}
      {face === 'agrees' && (
        <p className="mt-1.5 text-sm text-ok" role="status">
          <span aria-hidden>● </span>
          The server agrees with this page: {errors === 0 ? 'nothing to fix' : `${plural(errors, 'thing', 'things')} to fix`}
          {gm > 0 ? `, ${plural(gm, 'item', 'items')} for the GM` : ''}.
          {refreshing ? ' Checking again…' : ''}
        </p>
      )}
      {face === 'differs' && diff && (
        <div className="mt-1.5">
          <p className="text-sm text-warn" role="status">
            The server&apos;s check differs from this page&apos;s. It checks the last saved copy, so an edit that has not saved yet is
            the usual reason — check again once it saves.{refreshing ? ' Checking again…' : ''}
          </p>
          <DiffList title="Only the server finds" issues={diff.onlyServer} onGoTo={onGoTo} testId={`${testId}-only-server`} />
          <DiffList title="Only this page finds" issues={diff.onlyLocal} onGoTo={onGoTo} testId={`${testId}-only-local`} />
        </div>
      )}
    </section>
  );
}
