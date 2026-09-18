/**
 * "Describe your runner" — the Fixer drafts a build from a sentence, on
 * Step 1 (FR3.9 P6, docs/CHARGEN.md §4.4 Step 1, §8.5 `propose_build`).
 *
 * Only there when it works: the box renders nothing unless the campaign has
 * turned the Fixer's drafts on *and* has a model to run them
 * (`GET /api/builds/:id/propose`, readable by the build's owner as well as the
 * GM — the GM's own Fixer status route is not a player's to read, which is
 * why this does not ask it). A read-only build and the GM's review get no
 * box either: there is nothing to draft onto.
 *
 * The flow is a card's, with the question asked first rather than after:
 *
 * 1. A description, and **draft a runner**. While the model works the button
 *    says so, a **stop** button stops this build's draft (never the GM's
 *    Fixer), and a status line says a local model can take a minute.
 * 2. The proposal, **before anything changes**: each thing a player weighs a
 *    runner by as "was → would be" (heard as a sentence, not an arrow and a
 *    strike-through), what the rules would flag, and what the Fixer named but
 *    could not find in the campaign's books.
 * 3. **use this draft** — one pure updater through `update`
 *   (`acceptProposal`), so the shell recomputes and autosaves it like any
 *    other edit, and Back/undo behave as they always do — or **discard**.
 *
 * `DescribeRunnerView` is every state as props, so each renders to static
 * markup in a node test; `describeRunnerHandlers` is what the controls do, as
 * plain functions a test can press; `DescribeRunner` holds the query, the two
 * mutations and the three pieces of local state (the words, the proposal, and
 * whether it was just taken). The record itself is never copied: the summary
 * is recomputed against the build as it stands on every render.
 */
import { useId, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CharacterBuild, ChargenSettings } from '@safehouse/contracts';
import { inputClass } from '../../../gm/ui.js';
import type { BuildUpdater } from '../../session.js';
import {
  PROMPT_MAX,
  acceptProposal,
  canDraft,
  draftErrorWords,
  draftKeys,
  fetchDraftAvailability,
  isDraftStopped,
  issueCountWords,
  proposalSummary,
  proposeBuild,
  stopDraft,
  type BuildProposal,
  type DraftAvailability,
  type ProposalSummary,
} from './draft.js';

export interface DescribeRunnerViewProps {
  /** Null while unknown (loading, or the route refused): the box stays hidden. */
  availability: DraftAvailability | null;
  readOnly: boolean;
  prompt: string;
  /** A draft is being written. */
  busy: boolean;
  stopping: boolean;
  /** The last draft's refusal, in words. */
  error: string | null;
  /** The last draft was stopped by the player. */
  stopped: boolean;
  /** The proposal beside the build as it stands, when there is one. */
  summary: ProposalSummary | null;
  /** A draft was just taken. */
  taken: boolean;
  onPrompt: (value: string) => void;
  onDraft: () => void;
  onStop: () => void;
  onAccept: () => void;
  onDiscard: () => void;
}

/** The words under the Draft button, for whichever state the box is in. */
export function describeStatus(p: Pick<DescribeRunnerViewProps, 'availability' | 'busy' | 'stopped' | 'summary' | 'taken'>): string {
  if (p.busy) return 'The Fixer is drafting. A local model can take a minute or two.';
  if (p.stopped) return 'Stopped. Nothing on the build changed.';
  if (p.taken) return 'Draft taken: every step now holds it, and all of it is yours to change there.';
  if (p.summary) {
    const n = p.summary.changed;
    return n === 0 ? 'The draft matches the build as it is.' : `The draft would change ${n} of the ${p.summary.lines.length} lines below.`;
  }
  if (p.availability?.running) return 'A draft for this runner is already being written on another screen.';
  return 'Nothing on the build changes until you use a draft.';
}

/** The identity promise the Accept button is described by. */
export const DRAFT_KEPT_WORDS =
  'Who the runner is — alias, real name, age, sex and background — stays as you typed it; the draft only fills blanks. Everything else becomes the draft’s.';

export function DescribeRunnerView(props: DescribeRunnerViewProps) {
  const id = useId();
  const { availability, readOnly, prompt, busy, stopping, error, summary } = props;
  if (readOnly || !availability?.available) return null;
  const headingId = `${id}-heading`;
  const hintId = `${id}-hint`;
  const promptId = `${id}-prompt`;
  const statusId = `${id}-status`;
  const state = busy ? 'drafting' : summary ? 'proposed' : 'idle';

  return (
    <section aria-labelledby={headingId} className="space-y-2" data-testid="concept-describe" data-state={state}>
      <div>
        <h2 id={headingId} className="mono-label text-cyan">
          Describe your runner
        </h2>
        <p id={hintId} className="mt-1 text-xs text-dim">
          A sentence or two about who they are. The Fixer drafts a whole build from this campaign&apos;s books and
          shows what it would change first.
        </p>
      </div>
      <label htmlFor={promptId} className="mono-label block">
        Who is this runner?
      </label>
      <textarea
        id={promptId}
        className={`${inputClass} min-h-[4.5rem] resize-y pointer-coarse:min-h-10`}
        rows={3}
        maxLength={PROMPT_MAX}
        value={prompt}
        placeholder="an ork who drove for a gang: loud, loyal, good with a pistol, bad with money"
        aria-describedby={hintId}
        readOnly={busy}
        onChange={(event) => props.onPrompt(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            props.onDraft();
          }
        }}
        data-testid="concept-describe-prompt"
      />
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="btn btn-accent px-3 py-1.5"
          onClick={props.onDraft}
          disabled={busy || !canDraft(prompt)}
          aria-busy={busy || undefined}
          aria-describedby={statusId}
          data-testid="concept-describe-draft"
        >
          {busy ? 'drafting…' : summary ? 'draft again' : 'draft a runner'}
        </button>
        {busy && (
          <button type="button" className="btn px-3 py-1.5" onClick={props.onStop} disabled={stopping} data-testid="concept-describe-stop">
            {stopping ? 'stopping…' : 'stop'}
          </button>
        )}
        <p id={statusId} role="status" className="min-w-0 flex-1 text-xs text-dim" data-testid="concept-describe-status">
          {describeStatus(props)}
        </p>
      </div>
      {error && (
        <p role="alert" className="break-words text-xs text-warn" data-testid="concept-describe-error">
          <span aria-hidden>! </span>
          {error}
        </p>
      )}
      {summary && !busy && <DraftCard summary={summary} onAccept={props.onAccept} onDiscard={props.onDiscard} />}
    </section>
  );
}

function DraftCard({ summary, onAccept, onDiscard }: { summary: ProposalSummary; onAccept: () => void; onDiscard: () => void }) {
  const id = useId();
  const headingId = `${id}-heading`;
  const keptId = `${id}-kept`;
  return (
    <div role="group" aria-labelledby={headingId} className="space-y-3 rounded-md border border-cyan-dim/50 bg-panel p-3" data-testid="concept-draft">
      <h3 id={headingId} className="text-sm font-semibold text-ink">
        The Fixer&apos;s draft
      </h3>
      {summary.note && (
        <p className="break-words text-sm text-dim" data-testid="concept-draft-note">
          {summary.note}
        </p>
      )}
      <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2" data-testid="concept-draft-lines">
        {summary.lines.map((line) => (
          <div key={line.key} className="min-w-0" data-line={line.key} data-changed={line.changed ? 'yes' : 'no'}>
            <dt className="mono-label text-faint">{line.label}</dt>
            <dd className="break-words text-sm">
              {line.changed ? (
                <>
                  <span aria-hidden>
                    <span className="text-faint line-through">{line.before}</span>
                    <span className="text-faint"> → </span>
                    <span className="text-ink">{line.after}</span>
                  </span>
                  <span className="sr-only">
                    was {line.before}, would be {line.after}
                  </span>
                </>
              ) : (
                <span className="text-dim">
                  {line.after}
                  <span className="sr-only"> (stays)</span>
                </span>
              )}
            </dd>
          </div>
        ))}
      </dl>
      <p className="text-xs text-dim" data-testid="concept-draft-issues" data-errors={summary.counts.errors}>
        {issueCountWords(summary.counts)} The rail and the issues list show them once the draft is used.
      </p>
      {summary.leftOut.length > 0 && (
        <div className="space-y-1">
          <h4 className="mono-label text-warn">Left out</h4>
          <ul className="space-y-1 text-xs text-warn" data-testid="concept-draft-left-out">
            {summary.leftOut.map((line, i) => (
              <li key={i} className="break-words">
                {line}
              </li>
            ))}
          </ul>
        </div>
      )}
      <p id={keptId} className="text-xs text-dim" data-testid="concept-draft-kept">
        {DRAFT_KEPT_WORDS}
      </p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn btn-accent px-3 py-1.5" onClick={onAccept} aria-describedby={keptId} data-testid="concept-draft-accept">
          use this draft
        </button>
        <button type="button" className="btn px-3 py-1.5" onClick={onDiscard} data-testid="concept-draft-discard">
          discard
        </button>
      </div>
    </div>
  );
}

/** What the box's controls do, over the state they need — so a node test can press them. */
export interface DescribeRunnerDeps {
  prompt: string;
  busy: boolean;
  proposal: BuildProposal | null;
  editable: boolean;
  update: (fn: BuildUpdater) => void;
  draft: (prompt: string) => void;
  stop: () => void;
  setProposal: (proposal: BuildProposal | null) => void;
  setTaken: (taken: boolean) => void;
}

export function describeRunnerHandlers(deps: DescribeRunnerDeps): Pick<DescribeRunnerViewProps, 'onDraft' | 'onStop' | 'onAccept' | 'onDiscard'> {
  return {
    onDraft() {
      if (!deps.editable || deps.busy || !canDraft(deps.prompt)) return;
      deps.setTaken(false);
      deps.draft(deps.prompt.trim());
    },
    onStop() {
      if (deps.busy) deps.stop();
    },
    onAccept() {
      const proposal = deps.proposal;
      if (!proposal || !deps.editable) return;
      deps.update((build: CharacterBuild) => acceptProposal(build, proposal.build));
      deps.setProposal(null);
      deps.setTaken(true);
    },
    onDiscard() {
      deps.setProposal(null);
    },
  };
}

export interface DescribeRunnerProps {
  buildId: string;
  build: CharacterBuild;
  settings: ChargenSettings;
  readOnly: boolean;
  update: (fn: BuildUpdater) => void;
}

export default function DescribeRunner({ buildId, build, settings, readOnly, update }: DescribeRunnerProps) {
  const qc = useQueryClient();
  const [prompt, setPrompt] = useState('');
  const [proposal, setProposal] = useState<BuildProposal | null>(null);
  const [taken, setTaken] = useState(false);
  const availability = useQuery({
    queryKey: draftKeys.availability(buildId),
    queryFn: () => fetchDraftAvailability(buildId),
    enabled: Boolean(buildId) && !readOnly,
    // A refusal is an answer (an older server, a device that may not open the build): the box stays hidden.
    retry: false,
    staleTime: 30_000,
  });
  const draft = useMutation({
    mutationFn: (text: string) => proposeBuild(buildId, text),
    onSuccess: (next) => setProposal(next),
    onSettled: () => void qc.invalidateQueries({ queryKey: draftKeys.availability(buildId) }),
  });
  const stop = useMutation({ mutationFn: () => stopDraft(buildId) });
  const summary = useMemo(() => (proposal ? proposalSummary(build, proposal, settings) : null), [build, proposal, settings]);
  const handlers = describeRunnerHandlers({
    prompt,
    busy: draft.isPending,
    proposal,
    editable: !readOnly,
    update,
    draft: (text) => draft.mutate(text),
    stop: () => stop.mutate(),
    setProposal,
    setTaken,
  });

  return (
    <DescribeRunnerView
      availability={availability.data ?? null}
      readOnly={readOnly}
      prompt={prompt}
      busy={draft.isPending}
      stopping={stop.isPending}
      error={draft.isPending ? null : draftErrorWords(draft.error)}
      stopped={!draft.isPending && isDraftStopped(draft.error)}
      summary={summary}
      taken={taken}
      onPrompt={setPrompt}
      {...handlers}
    />
  );
}
