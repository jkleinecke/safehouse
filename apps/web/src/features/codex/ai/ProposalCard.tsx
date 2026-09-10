/**
 * The GM's seam (Principle 8): a Fixer proposal sitting beside the page it
 * would change, applied to nothing.
 *
 * Everything that makes this safe is visible on the card:
 *  - a line diff of the page as it IS against the page as it WOULD BE, so
 *    "accept" is never a leap of faith;
 *  - the FR12.19 spoiler-guard flags, which must be acknowledged before the
 *    accept button unlocks — the guard exists precisely for the draft the GM
 *    was about to reveal to the table;
 *  - `edit`, because a draft the GM improved is still the GM's page (P2);
 *  - where it lands: replace the page, append a section, or splice back one
 *    section. The model does not get to choose how much of the page it takes.
 *
 * Accepting calls back out; this component writes nothing itself.
 */
import { useMemo, useState } from 'react';
import { ErrorNote } from '../../gm/ui.js';
import {
  applyProposal,
  diffLines,
  diffStat,
  type MergeMode,
} from './lib.js';
import type { CodexProposal } from './api.js';

const inputClass =
  'w-full rounded-md border border-edge bg-deck px-2.5 py-1.5 text-sm text-ink ' +
  'placeholder:text-faint focus:border-cyan focus:outline-none';

const MODE_LABEL: Record<MergeMode, string> = {
  replace: 'replace the page',
  append: 'append to the page',
  section: 'replace this section',
};

export interface AcceptPayload {
  /** The proposal body as the GM left it (edits included). */
  contentMd: string;
  /** The whole page body after merging — what actually gets written. */
  merged: string;
  mode: MergeMode;
  sectionId?: string;
  title: string;
  kind: string;
}

export interface ProposalCardProps {
  proposal: CodexProposal;
  /** The page as it stands. Empty for a page that does not exist yet. */
  currentMd?: string;
  /** Headings the GM can splice into, for `section` mode. */
  sections?: Array<{ id: string; heading: string }>;
  /** 'new' drops the merge controls: there is no page to merge with yet. */
  target?: 'page' | 'new';
  busy?: boolean;
  error?: unknown;
  onAccept: (payload: AcceptPayload) => void;
  onReject: () => void;
}

function DiffView({ before, after }: { before: string; after: string }) {
  const lines = useMemo(() => diffLines(before, after), [before, after]);
  const stat = diffStat(lines);
  return (
    <div className="mt-2">
      <div className="mono-label flex items-center gap-2 text-faint">
        <span className="text-ok">+{stat.added}</span>
        <span className="text-danger">−{stat.removed}</span>
        <span>lines · the page as it would be</span>
      </div>
      <pre className="mt-1 max-h-80 overflow-auto rounded-md border border-edge bg-panel p-2.5 font-label text-xs leading-relaxed">
        {lines.map((l, i) => (
          <div
            key={i}
            className={
              l.kind === 'add'
                ? 'whitespace-pre-wrap text-ok'
                : l.kind === 'del'
                  ? 'whitespace-pre-wrap text-danger line-through opacity-70'
                  : 'whitespace-pre-wrap text-dim'
            }
          >
            {l.kind === 'add' ? '+ ' : l.kind === 'del' ? '− ' : '  '}
            {l.text || ' '}
          </div>
        ))}
      </pre>
    </div>
  );
}

export default function ProposalCard({
  proposal,
  currentMd = '',
  sections = [],
  target = 'page',
  busy,
  error,
  onAccept,
  onReject,
}: ProposalCardProps) {
  const [text, setText] = useState(proposal.contentMd);
  const [title, setTitle] = useState(proposal.title);
  const [editing, setEditing] = useState(false);
  const [mode, setMode] = useState<MergeMode>(
    proposal.mode === 'section' && !proposal.sectionId ? 'replace' : proposal.mode,
  );
  const [sectionId, setSectionId] = useState(proposal.sectionId ?? sections[0]?.id ?? '');
  const [acknowledged, setAcknowledged] = useState(false);

  const flagged = proposal.spoilerFlags.length > 0;
  const merged = useMemo(
    () => applyProposal(currentMd, text, mode, sectionId || undefined),
    [currentMd, text, mode, sectionId],
  );
  const empty = text.trim().length === 0;
  const blocked = busy === true || empty || (flagged && !acknowledged);

  const modes: MergeMode[] =
    sections.length > 0 ? ['replace', 'append', 'section'] : ['replace', 'append'];

  return (
    <li className="rounded-md border border-cyan-dim/60 bg-deck p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="chip border-magenta-dim text-magenta">fixer proposal</span>
        <span className="chip text-faint">{proposal.kind}</span>
        {proposal.model && <span className="chip text-faint">{proposal.model}</span>}
        {proposal.unverified ? (
          <span className="chip border-warn/40 text-warn" title="No ai_generations row backs this">
            no draft row
          </span>
        ) : (
          <span className="chip text-dim" title="Saved as an ai_generations draft">
            draft
          </span>
        )}
        {proposal.createdAt && (
          <span className="mono-label text-faint">
            {proposal.createdAt.slice(0, 16).replace('T', ' ')}
          </span>
        )}
      </div>

      {proposal.unverified && (
        <p className="mono-label mt-2 text-warn">
          The Fixer answered without saving a draft, so the spoiler guard never ran on this
          text. Read it yourself before you accept it.
        </p>
      )}

      {flagged && (
        <div className="mt-2 rounded-md border border-warn/40 bg-warn/10 p-2">
          <div className="mono-label text-warn">spoiler guard — reveal or cut?</div>
          <p className="mt-1 text-xs text-warn/90">
            This draft is meant for the table and leans on things only you know:
          </p>
          <ul className="mt-1 space-y-0.5 text-xs text-warn">
            {proposal.spoilerFlags.map((f, i) => (
              <li key={i}>— {f}</li>
            ))}
          </ul>
          <label className="mono-label mt-2 flex items-center gap-2 text-warn">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(e) => setAcknowledged(e.target.checked)}
            />
            I have read these and I still want this text
          </label>
        </div>
      )}

      {target === 'new' && (
        <label className="mt-2 block">
          <span className="mono-label">Page title</span>
          <input
            className={`${inputClass} mt-1`}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            aria-label="Proposed page title"
          />
        </label>
      )}

      {target === 'page' && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5" role="group" aria-label="Where it lands">
          <span className="mono-label text-faint">lands as</span>
          {modes.map((m) => (
            <button
              key={m}
              type="button"
              className={`chip cursor-pointer ${mode === m ? 'border-cyan text-cyan' : 'text-faint hover:text-ink'}`}
              aria-pressed={mode === m}
              onClick={() => setMode(m)}
            >
              {MODE_LABEL[m]}
            </button>
          ))}
          {mode === 'section' && sections.length > 0 && (
            <select
              className={`${inputClass} w-auto`}
              value={sectionId}
              onChange={(e) => setSectionId(e.target.value)}
              aria-label="Section to replace"
            >
              {sections.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.heading}
                </option>
              ))}
            </select>
          )}
        </div>
      )}

      {editing ? (
        <textarea
          className={`${inputClass} mt-2 h-64 resize-y font-label text-xs leading-relaxed`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          aria-label="Proposed markdown"
          spellCheck
        />
      ) : (
        <DiffView before={currentMd} after={merged} />
      )}

      <p className="mono-label mt-2 text-faint">
        Nothing is written until you accept. Reject leaves the page exactly as it is.
      </p>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="btn btn-accent px-3 py-1.5 disabled:cursor-not-allowed disabled:border-edge disabled:text-faint disabled:opacity-60"
          disabled={blocked}
          title={
            flagged && !acknowledged
              ? 'Acknowledge the spoiler-guard flags first'
              : 'Write this into the page'
          }
          onClick={() =>
            onAccept({
              contentMd: text,
              merged,
              mode,
              ...(mode === 'section' && sectionId ? { sectionId } : {}),
              title: title.trim() || proposal.title,
              kind: proposal.kind,
            })
          }
        >
          {busy ? 'writing…' : target === 'new' ? 'accept — create the page' : 'accept'}
        </button>
        <button type="button" className="btn px-3 py-1.5" onClick={() => setEditing((v) => !v)}>
          {editing ? 'back to the diff' : 'edit'}
        </button>
        <button
          type="button"
          className="btn px-3 py-1.5 text-danger disabled:cursor-not-allowed disabled:opacity-60"
          disabled={busy}
          onClick={onReject}
        >
          reject
        </button>
      </div>
      <ErrorNote error={error} />
    </li>
  );
}
