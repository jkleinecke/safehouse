/**
 * `/c/:campaignId/build/:buildId` — the walkthrough (FR3.9, docs/CHARGEN.md
 * §4.4, §8.6).
 *
 * The page is the shell around the nine step screens: a header with the
 * runner's name, the build's state and the autosave line, which scrolls away;
 * the progress strip, which stays; the step in its frame on the left; the
 * issues list and the rail on the right, each scrolling in its own share of
 * the column so what blocks Next is never below the fold of a nested scroll.
 * (On a 375 px phone the fixed bars used to take a third of the screen.) Two
 * columns from `lg`, one below. On a phone the rail would push
 * the step off the screen, so it folds into a bar pinned to the bottom of the
 * scroll area — always visible, above the home indicator — carrying what §4.4
 * calls the instant rail at phone size: the pools the step on screen spends
 * ("Skill 8"), any other pool that is overspent by name, and the count of
 * things to fix — on one line. Tapping it opens the full rail and issues in the
 * app's bottom sheet. Below `lg` the desktop aside is not rendered at all, so
 * a phone does not lay out a second rail and issues list on every tap.
 *
 * A GM on a player's open build reads it until they press "edit as GM"
 * (`useBuild`'s header says why), and is never walked through the gates.
 *
 * Everything the page shows is a prop of `BuildPageView`, so the whole shell
 * renders to static markup in a node test; `BuildPage` is the thin live
 * wrapper that owns the queries, the session and the socket. The step screen
 * is lazy (`steps/index.ts`) and gets `StepProps`.
 *
 * Not wrapped in `GmGuard`: players build their own runners, the GM reviews
 * them, and the server decides who may read or write which build.
 */
import { Suspense, useCallback, useEffect, useId, useMemo, useState, useSyncExternalStore } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import type { BuildMode, BuildStep, CharacterBuild, ChargenSettings, Role } from '@safehouse/contracts';
import { Sheet } from '../sheet/components/ui.js';
import type { BuildAnalysis } from './analysis.js';
import { useBuildLive, type BuildRecord } from './api.js';
import GmNoteBanner from './components/GmNoteBanner.js';
import IssuesList from './components/IssuesList.js';
import ProgressStrip from './components/ProgressStrip.js';
import Rail from './components/Rail.js';
import SaveIndicator from './components/SaveIndicator.js';
import StepFrame from './components/StepFrame.js';
import ActionError from './steps/finish/ActionError.js';
import {
  BUILD_STATE_LABEL,
  BUILD_STATE_TONE,
  buildAlias,
  buildListHref,
  issuesForStep,
  nextStep,
  poolBrief,
  poolRows,
  poolTiny,
  previousStep,
  reachableStep,
  splitIssues,
  stepPoolRows,
  toStep,
  type RailPoolKey,
} from './lib.js';
import type { BuildUpdater } from './session.js';
import { nextConfirmFor, stepMetaFor, stepScreen } from './steps/index.js';
import { introFor } from './steps/meta.js';
import type { BuildActions, StepProps } from './steps/types.js';
import { useBuild, useBuildActions, type GmEditSwitch, type SaveControls } from './useBuild.js';

function Notice({ title, body, campaignId }: { title: string; body: string; campaignId?: string }) {
  return (
    <div className="p-6">
      <div className="panel mx-auto max-w-md p-6 text-center" data-testid="build-notice">
        <div className="mono-label text-cyan">Build a runner</div>
        <h1 className="mt-3 text-base font-semibold text-ink">{title}</h1>
        <p className="mt-1.5 text-sm text-dim">{body}</p>
        {campaignId && (
          <Link to={buildListHref(campaignId)} className="btn mt-4 inline-flex px-3 py-1.5">
            all builds
          </Link>
        )}
      </div>
    </div>
  );
}

export interface BuildPageViewProps {
  campaignId: string;
  buildId: string;
  record: BuildRecord | null;
  build: CharacterBuild;
  settings: ChargenSettings;
  settingsFromCampaign: boolean;
  analysis: BuildAnalysis;
  mode: BuildMode;
  readOnly: boolean;
  reviewMode: boolean;
  role: Role | null;
  /** Whether this device owns the build (`useBuild`'s `isOwner`): Submit is offered to the owner only. */
  isOwner: boolean;
  save: Pick<SaveControls, 'status' | 'error' | 'retry'> & Partial<Pick<SaveControls, 'stale' | 'keepMine' | 'takeTheirs'>>;
  update: (fn: BuildUpdater) => void;
  goTo: (step: BuildStep) => void;
  setMode: (mode: BuildMode) => void;
  actions: BuildActions;
  /** A GM on a player's open build: the switch that lets them write it. Absent for everyone else. */
  gmEdit?: GmEditSwitch;
}

/**
 * The phone bar's summary: how much is left to fix, every overspent pool by
 * name ("Nuyen over by 1,200¥") except those the bar already shows for this
 * step (`shown`), what waits on the GM, and — counted apart, last — the checks
 * on steps not reached yet (`later`, the issues list's fold), so a fresh
 * build reads "1 to fix · 14 later" rather than "15 to fix". Pass the issues
 * to act on now as `analysis.issues` (`splitIssues`).
 */
export function railSummary(analysis: Pick<BuildAnalysis, 'budgets' | 'issues'>, shown: readonly RailPoolKey[] = [], later = 0): string {
  const over = poolRows(analysis.budgets).filter((r) => r.over && !shown.includes(r.key));
  const errors = analysis.issues.filter((i) => i.severity === 'error').length;
  const gm = analysis.issues.filter((i) => i.severity === 'approval').length;
  const parts = [
    errors === 0 ? 'nothing to fix' : `${errors} to fix`,
    ...over.map(poolBrief),
    ...(gm > 0 ? [`${gm} for the GM`] : []),
    ...(later > 0 ? [`${later} later`] : []),
  ];
  return parts.join(' · ');
}

/** Tailwind's `lg`: where the rail stops folding into the bottom bar. */
const WIDE_QUERY = '(min-width: 64rem)';

function subscribeWide(onChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => undefined;
  const query = window.matchMedia(WIDE_QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

function wideNow(): boolean | null {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(WIDE_QUERY).matches : null;
}

/**
 * Whether the two-column layout applies: true or false in a browser, null
 * where there is no window (a static render), in which case both the aside and
 * the bar render and the CSS breakpoints choose — the markup a first paint
 * would show anyway.
 */
export function useWideLayout(): boolean | null {
  return useSyncExternalStore(subscribeWide, wideNow, () => null);
}

export function BuildPageView(props: BuildPageViewProps) {
  const { campaignId, buildId, build, analysis, mode, readOnly, reviewMode, save, goTo, setMode, update, gmEdit } = props;
  const { settings, settingsFromCampaign, role, actions, isOwner, record } = props;
  const [railOpen, setRailOpen] = useState(false);
  const wide = useWideLayout();
  const panelId = useId();
  const drawerId = useId();
  const step = toStep(build.step);
  // The copy for this build's method: step 2's rule reads differently under Sum to Ten.
  const meta = useMemo(() => stepMetaFor(step, build.method), [step, build.method]);
  const characterId = record?.characterId ?? null;
  // Where the rail counts "to fix" from: the step on screen for someone building; everything for a reader.
  const issuesAt = readOnly || reviewMode ? toStep(9) : step;
  const split = useMemo(() => splitIssues(analysis.issues, issuesAt, build), [analysis.issues, issuesAt, build]);
  const status = analysis.steps[step - 1] ?? analysis.steps[0]!;
  // Steps and the issues list move the player through the strip's rule: a jump guided mode
  // would not allow lands on the step in the way (`reachableStep`). Next and Back keep `goTo`.
  const jumpTo = useCallback((s: BuildStep) => goTo(reachableStep(analysis.steps, s, step, mode)), [goTo, analysis.steps, step, mode]);
  const Screen = stepScreen(step);
  const back = previousStep(analysis.steps, step);
  const next = nextStep(analysis.steps, step);
  const settingsNote = settingsFromCampaign
    ? null
    : `The campaign's creation settings could not be read; these numbers use the build's own ${build.level} level.`;

  // One object per change that matters, so a memoised step screen can skip a
  // render that changed only the header (a save status, the sheet opening).
  const stepProps = useMemo<StepProps>(
    () => ({
      campaignId,
      buildId,
      characterId,
      isOwner,
      meta,
      build,
      settings,
      settingsFromCampaign,
      budgets: analysis.budgets,
      issues: issuesForStep(analysis.issues, step),
      allIssues: analysis.issues,
      status,
      steps: analysis.steps,
      eligibility: analysis.eligibility,
      preview: analysis.preview,
      ratings: analysis.ratings,
      probe: analysis.probe,
      update,
      goTo: jumpTo,
      readOnly,
      reviewMode,
      mode,
      role,
      actions,
    }),
    [
      campaignId,
      buildId,
      characterId,
      isOwner,
      meta,
      build,
      settings,
      settingsFromCampaign,
      analysis,
      step,
      status,
      update,
      jumpTo,
      readOnly,
      reviewMode,
      mode,
      role,
      actions,
    ],
  );
  const nextConfirm = useMemo(() => nextConfirmFor(status), [status]);
  const barPools = stepPoolRows(analysis.budgets, meta.pools);

  const intro = introFor(step, build.state, reviewMode);
  const rail = (
    <Rail
      budgets={analysis.budgets}
      derived={analysis.preview.derived}
      previewError={analysis.preview.error}
      settingsNote={settingsNote}
    />
  );
  // What blocks Next first, then the pools.
  const issuesList = (
    <IssuesList
      issues={analysis.issues}
      current={issuesAt}
      build={build}
      approvals={build.approvals}
      onGoTo={(s) => {
        setRailOpen(false);
        jumpTo(s);
      }}
    />
  );

  return (
    <div className="min-h-full" data-testid="build-page" data-build={buildId} data-step={step} data-mode={mode}>
      <div className="border-b border-edge bg-deck" data-testid="build-header">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1 sm:px-4">
          <Link to={buildListHref(campaignId)} className="mono-label inline-flex min-h-10 items-center pr-1 text-dim hover:text-cyan">
            ← builds
          </Link>
          <span className="min-w-0 truncate text-sm font-semibold text-ink" data-testid="build-alias">
            {buildAlias({ build })}
          </span>
          <span className={`chip ${BUILD_STATE_TONE[build.state]}`} data-testid="build-state" data-state={build.state}>
            {reviewMode ? 'review' : BUILD_STATE_LABEL[build.state]}
          </span>
          <SaveIndicator
            status={save.status}
            error={save.error}
            readOnly={readOnly}
            onRetry={save.retry}
            {...(save.stale && save.keepMine && save.takeTheirs ? { stale: { onKeepMine: save.keepMine, onTakeTheirs: save.takeTheirs } } : {})}
          />
          {gmEdit?.available && (
            <div className="ml-auto flex flex-wrap items-center gap-2">
              {gmEdit.on && (
                <span className="text-xs text-magenta" data-testid="gm-edit-note">
                  your edits save over the player&apos;s draft
                </span>
              )}
              <button
                type="button"
                className={`chip pointer-coarse:min-h-10 ${gmEdit.on ? 'border-magenta text-magenta' : 'text-dim'}`}
                aria-pressed={gmEdit.on}
                data-testid="gm-edit"
                onClick={() => gmEdit.set(!gmEdit.on)}
                title="This build belongs to a player. Reading it changes nothing; editing it replaces their saved draft with yours as you go."
              >
                edit as GM
              </button>
            </div>
          )}
          {!reviewMode && !readOnly && !gmEdit?.available && (
            <div className="ml-auto flex items-center gap-1" role="group" aria-label="Walkthrough mode">
              {(['guided', 'free'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  className={`chip pointer-coarse:min-h-10 ${mode === m ? 'border-cyan text-cyan' : 'text-dim'}`}
                  aria-pressed={mode === m}
                  data-testid={`mode-${m}`}
                  onClick={() => setMode(m)}
                  title={m === 'guided' ? 'One step at a time; Next opens when a step is done' : 'Every step open, like tabs; only Submit is gated'}
                >
                  {m}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="sticky top-0 z-30 border-b border-edge bg-deck/95 backdrop-blur" data-testid="build-strip">
        <ProgressStrip
          steps={analysis.steps}
          current={step}
          mode={mode}
          onSelect={goTo}
          noteStep={build.state === 'returned' ? build.returnedStep : null}
          panelId={panelId}
          build={build}
        />
      </div>

      <div className="mx-auto grid max-w-6xl grid-cols-1 gap-4 p-3 sm:p-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0">
          <StepFrame
            meta={meta}
            status={status}
            mode={mode}
            readOnly={readOnly}
            panelId={panelId}
            onBack={back !== null ? () => goTo(back) : null}
            onNext={next !== null ? () => goTo(next) : null}
            nextConfirm={nextConfirm}
            {...(intro ? { intro } : {})}
            banner={
              <>
                <GmNoteBanner
                  state={build.state}
                  notes={build.notes}
                  returnedStep={build.returnedStep}
                  step={step}
                  onGoTo={goTo}
                />
                {/* A GM deciding an approval item on a step (a quality, a gear line) hears a refused decision
                    there, not only on the review screen, which shows its own. */}
                {reviewMode && step !== 9 && (
                  <ActionError error={actions.error} issues={actions.refusalIssues} onGoTo={jumpTo} testId="review-step-error" />
                )}
              </>
            }
          >
            <Suspense
              fallback={
                <div className="py-6 text-center">
                  <span className="mono-label text-faint">loading step…</span>
                </div>
              }
            >
              <Screen {...stepProps} />
            </Suspense>
          </StepFrame>
        </div>
        {wide !== false && (
          <aside className="hidden lg:block" aria-label="Pools and issues" data-testid="build-aside">
            <div className="sticky top-16 flex max-h-[calc(100dvh-8rem)] flex-col gap-3 pb-4">
              <div className="max-h-[40dvh] shrink-0 overflow-y-auto" data-testid="build-aside-issues">
                {issuesList}
              </div>
              {/* Room at the end so a GM can scroll the last tile clear of the Fixer's dock. */}
              <div className="min-h-0 flex-1 overflow-y-auto pb-14" data-testid="build-aside-pools">
                {rail}
              </div>
            </div>
          </aside>
        )}
      </div>

      {wide !== true && (
        <>
          <div
            className="sticky bottom-0 z-20 border-t border-edge bg-deck/95 px-3 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] backdrop-blur lg:hidden"
            data-testid="rail-bar"
          >
            <button
              type="button"
              className="btn flex min-h-10 w-full items-center gap-2 px-3 py-1"
              aria-expanded={railOpen}
              {...(railOpen ? { 'aria-controls': drawerId } : {})}
              onClick={() => setRailOpen(true)}
            >
              <span className="shrink-0">
                pools<span className="hidden sm:inline"> &amp; issues</span>
              </span>
              {barPools.length > 0 && (
                <span className="flex shrink-0 gap-x-2 text-left text-xs normal-case tracking-normal" data-testid="rail-bar-pools">
                  {barPools.map((row) => (
                    <span key={row.key} className={row.over ? 'text-danger' : row.exact ? 'text-ok' : 'text-ink'} data-pool={row.key}>
                      <span aria-hidden>{poolTiny(row)}</span>
                      <span className="sr-only">{poolBrief(row)}</span>
                    </span>
                  ))}
                </span>
              )}
              <span className="min-w-0 flex-1 truncate text-right text-xs normal-case tracking-normal text-dim" data-testid="rail-bar-summary">
                {railSummary({ budgets: analysis.budgets, issues: split.now }, meta.pools, split.later.length)}
              </span>
            </button>
          </div>
          <Sheet open={railOpen} onClose={() => setRailOpen(false)} title="Pools & issues">
            <div id={drawerId} className="space-y-3">
              {issuesList}
              {rail}
            </div>
          </Sheet>
        </>
      )}
    </div>
  );
}

export default function BuildPage() {
  const { campaignId, buildId } = useParams<{ campaignId: string; buildId: string }>();
  const [search, setSearch] = useSearchParams();
  const [initial] = useState(() => search.get('step'));
  const b = useBuild(buildId, { ...(campaignId ? { campaignId } : {}), initialStep: initial ? toStep(initial) : null });
  useBuildLive(campaignId, buildId);
  const actions = useBuildActions(b, buildId ?? '', campaignId ?? '');
  const ready = b.phase === 'ready';
  const step = b.step;

  // A `?step=` deep link is applied once (useBuild); drop it from the address
  // so a reload resumes where the player is, not where the link pointed.
  useEffect(() => {
    if (ready && search.has('step')) setSearch({}, { replace: true });
  }, [ready, search, setSearch]);

  // A new step starts at its top. The shell's <main> is the scroll container.
  useEffect(() => {
    if (!ready || typeof document === 'undefined') return;
    document.querySelector('main')?.scrollTo({ top: 0 });
  }, [ready, step]);

  if (!campaignId || !buildId) return null;
  if (b.phase === 'error') {
    return <Notice title="Build unavailable" body={b.error ?? 'This build could not be loaded.'} campaignId={campaignId} />;
  }
  if (b.phase === 'loading' || !b.build || !b.analysis || !b.settings) {
    return <Notice title="Loading…" body="Pulling the build and the campaign's creation rules off the host." />;
  }
  if (b.record && b.record.campaignId !== campaignId) {
    return <Notice title="Wrong campaign" body="This build belongs to another campaign." campaignId={campaignId} />;
  }

  return (
    <BuildPageView
      campaignId={campaignId}
      buildId={buildId}
      record={b.record}
      build={b.build}
      settings={b.settings}
      settingsFromCampaign={b.settingsFromCampaign}
      analysis={b.analysis}
      mode={b.mode}
      readOnly={b.readOnly}
      reviewMode={b.reviewMode}
      role={b.role}
      isOwner={b.isOwner}
      save={b.save}
      update={b.update}
      goTo={b.goTo}
      setMode={b.setMode}
      actions={actions}
      gmEdit={b.gmEdit}
    />
  );
}
