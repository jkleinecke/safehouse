/**
 * "A ganger bar on the docks the team keeps returning to."
 *
 * A page from a sentence, in the browser pane where the GM is already standing
 * — the empty-codex case the New-page form cannot help with, because a title
 * and a kind is not a page.
 *
 * Same seam as everywhere else: the Fixer's answer arrives as a proposal card,
 * and the page exists only once the GM accepts it (Principle 8). Accepting an
 * untouched draft goes through `POST /api/generations/:id/accept`, so the row
 * is marked accepted and the new page carries its provenance.
 *
 * GM-only. With no model configured the control stays visible and disabled with
 * the reason on it (NG7) rather than vanishing.
 */
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ErrorNote, Spinner } from '../../gm/ui.js';
import { useFixerStatus } from '../../gm/fixer/api.js';
import { usePages } from '../api.js';
import { PAGE_KINDS } from '../lib.js';
import { useAcceptAsNewPage, useCodexAsk, useRejectProposal, type CodexProposal } from './api.js';
import { askErrorLine, disabledReason, titleFromBrief } from './lib.js';
import ProposalCard, { type AcceptPayload } from './ProposalCard.js';

const inputClass =
  'w-full rounded-md border border-edge bg-deck px-2.5 py-1.5 text-sm text-ink ' +
  'placeholder:text-faint focus:border-cyan focus:outline-none';

export interface NewPagePromptProps {
  campaignId: string;
  /** Pre-filled from an unresolved `[[link]]` the GM clicked. */
  seedTitle?: string;
}

export default function NewPagePrompt({ campaignId, seedTitle }: NewPagePromptProps) {
  const navigate = useNavigate();
  const status = useFixerStatus();
  const pages = usePages(campaignId);
  const ask = useCodexAsk(campaignId);
  const create = useAcceptAsNewPage(campaignId);
  const reject = useRejectProposal(campaignId);

  const [brief, setBrief] = useState('');
  const [kind, setKind] = useState('location');
  const [proposal, setProposal] = useState<CodexProposal | null>(null);
  /** Remounts the card per answer so a second brief starts from its own draft. */
  const [nonce, setNonce] = useState(0);

  const offReason = disabledReason(status.data, status.error, ask.error);
  const askError = offReason ? null : askErrorLine(ask.error);
  const text = brief.trim() || (seedTitle ?? '').trim();

  const submit = () => {
    if (offReason || ask.isPending || text.length === 0) return;
    ask.mutate(
      {
        action: 'new',
        brief: text,
        mode: 'replace',
        playerFacing: false,
        ctx: {
          title: titleFromBrief(text, seedTitle ?? text.slice(0, 60)),
          kind,
          tags: [],
          contentMd: '',
          neighbours: (pages.data ?? []).map((p) => p.title),
          backlinks: [],
          unresolved: [],
        },
      },
      {
        onSuccess: (result) => {
          setProposal(result);
          setNonce((n) => n + 1);
        },
      },
    );
  };

  const accept = (payload: AcceptPayload) => {
    if (!proposal) return;
    create.mutate(
      { proposal, contentMd: payload.merged, title: payload.title, kind: payload.kind },
      {
        onSuccess: (pageId) => {
          setProposal(null);
          setBrief('');
          navigate(`/c/${campaignId}/codex/${pageId}`);
        },
      },
    );
  };

  return (
    <div className="border-t border-edge pt-3">
      <div className="flex items-center gap-2">
        <div className="mono-label text-magenta">Or describe it</div>
        {ask.isPending && <Spinner label="drafting" />}
      </div>

      {/*
        The brief on its own line, the kind and the button on the next: three
        controls in a 300 px column truncated both the placeholder and the
        kind (docs/UX_SITE.md, Alignment).
      */}
      <div className="mt-1.5 flex flex-wrap gap-2">
        <input
          className={`${inputClass} basis-full`}
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          placeholder="a ganger bar on the docks the team keeps returning to"
          aria-label="Describe the page you want"
          disabled={Boolean(offReason) || ask.isPending}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              submit();
            }
          }}
        />
        <select
          className={`${inputClass} w-auto flex-1`}
          value={kind}
          onChange={(e) => setKind(e.target.value)}
          aria-label="Kind for the described page"
          disabled={Boolean(offReason) || ask.isPending}
        >
          {PAGE_KINDS.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="btn shrink-0 px-3 py-1.5 disabled:cursor-not-allowed disabled:border-edge disabled:text-faint disabled:opacity-60"
          disabled={Boolean(offReason) || ask.isPending || text.length === 0}
          title={offReason ?? 'The Fixer drafts it; you accept, edit or reject it'}
          onClick={submit}
        >
          {ask.isPending ? '…' : 'ask the fixer'}
        </button>
      </div>

      {offReason ? (
        <p className="mono-label mt-1.5 text-warn">
          {offReason}{' '}
          <Link className="text-cyan underline" to={`/c/${campaignId}/gm/fixer`}>
            how to switch it on
          </Link>
        </p>
      ) : (
        <p className="mono-label mt-1.5 text-faint">
          grounded in this campaign — you read it before it becomes a page
        </p>
      )}

      {askError && <ErrorNote error={askError} />}
      <ErrorNote error={create.error ?? reject.error} />

      {proposal && (
        <ul className="mt-3 space-y-3">
          <ProposalCard
            key={`${proposal.generationId ?? 'local'}-${nonce}`}
            proposal={proposal}
            target="new"
            busy={create.isPending || reject.isPending}
            onAccept={accept}
            onReject={() => reject.mutate(proposal, { onSuccess: () => setProposal(null) })}
          />
        </ul>
      )}
    </div>
  );
}
