/**
 * "Help me fill out the codex" — where the writing actually happens.
 *
 * Before this the capability existed only as the server's `draft_wiki_page`
 * tool, reachable by leaving the page, opening the Fixer chat, phrasing the
 * request so the model chose that tool, and then finding the drafts inbox. Now
 * it is four buttons beside the page.
 *
 * GM-only, because the Fixer is (§13) — a player's codex never renders this.
 *
 * Two things this panel refuses to do:
 *  - it never applies anything. Every result is a `ProposalCard` the GM accepts,
 *    edits or rejects (Principle 8);
 *  - it never goes quiet when the model is off. With no `LLM_BASE_URL` the
 *    buttons stay on screen, disabled, with the reason and a link to the Fixer
 *    screen. A GM should learn that the feature exists and is asleep, not
 *    conclude it was never built (NG7).
 *
 * It also hydrates the campaign's pending `wiki_page` drafts on mount, so a
 * draft the GM asked for from the chat two screens away is waiting here, on the
 * page it belongs to (LIVE-1: REST on mount, never events alone).
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useCampaign } from '../../../api/campaigns.js';
import { ErrorNote, Spinner } from '../../gm/ui.js';
import { useFixerStatus } from '../../gm/fixer/api.js';
import { usePages, type CodexPage } from '../api.js';
import { normalizeTitle } from '../md.js';
import {
  proposalFromDraft,
  useApplyToPage,
  useCodexAsk,
  useRejectProposal,
  useWikiDrafts,
  type CodexProposal,
} from './api.js';
import {
  ACTION_BY_ID,
  CODEX_AI_ACTIONS,
  askErrorLine,
  disabledReason,
  headingLines,
  isStub,
  type CodexAiAction,
  type PageContext,
} from './lib.js';
import ProposalCard, { type AcceptPayload } from './ProposalCard.js';

const inputClass =
  'w-full rounded-md border border-edge bg-deck px-2.5 py-1.5 text-sm text-ink ' +
  'placeholder:text-faint focus:border-cyan focus:outline-none';

export interface AiPanelProps {
  campaignId: string;
  page: CodexPage;
  /** Override the FR12.16 slot choice; otherwise a live session picks `fast`. */
  sessionLive?: boolean;
}

export default function AiPanel({ campaignId, page, sessionLive }: AiPanelProps) {
  const status = useFixerStatus();
  const campaign = useCampaign(campaignId);
  const pages = usePages(campaignId);
  const drafts = useWikiDrafts(campaignId);
  const ask = useCodexAsk(campaignId);
  const apply = useApplyToPage(campaignId, page.id);
  const reject = useRejectProposal(campaignId);

  const [extra, setExtra] = useState('');
  const [sectionId, setSectionId] = useState('');
  const [playerFacing, setPlayerFacing] = useState(page.visibility === 'public');
  const [proposal, setProposal] = useState<CodexProposal | null>(null);
  const [running, setRunning] = useState<CodexAiAction | null>(null);
  /** Remounts the card for each answer, so a second ask never inherits the
   *  first one's edits — two turns can both come back with no draft row. */
  const [nonce, setNonce] = useState(0);

  const sections = useMemo(
    () => headingLines(page.contentMd).map((h) => ({ id: h.id, heading: h.heading })),
    [page.contentMd],
  );

  /**
   * Grounding (FR12.17/R12): the Fixer is told what this page is, what points
   * at it, and which titles exist — so the draft is about this campaign and its
   * `[[links]]` land on real pages rather than inventing a neighbourhood.
   */
  const ctx: PageContext = useMemo(
    () => ({
      title: page.title,
      kind: page.kind,
      tags: page.tags,
      contentMd: page.contentMd,
      neighbours: (pages.data ?? []).map((p) => p.title).filter((t) => t !== page.title),
      backlinks: page.backlinks.map((b) => b.title),
      unresolved: page.links.unresolved.map((u) => u.target),
    }),
    [page, pages.data],
  );

  const offReason = disabledReason(status.data, status.error, ask.error);
  const askError = offReason ? null : askErrorLine(ask.error);
  const busy = ask.isPending;

  /**
   * Pending drafts for THIS page, matched by title, minus the one in hand.
   *
   * A draft that arrived from somewhere else (the Fixer chat) has no recorded
   * intent, so it defaults to APPENDING on a page that already has prose:
   * appending is visible and loses nothing, and the GM can switch it to replace
   * on the card once they have read the diff.
   */
  const pending = useMemo(() => {
    const here = normalizeTitle(page.title);
    return (drafts.data ?? [])
      .filter((g) => g.id !== proposal?.generationId)
      .filter((g) => {
        const out = g.output;
        const title =
          typeof out === 'object' && out !== null
            ? (out as Record<string, unknown>)['title']
            : undefined;
        return typeof title === 'string' && normalizeTitle(title) === here;
      })
      .map((g) =>
        proposalFromDraft(g, {
          action: 'draft',
          mode: isStub(page.contentMd) ? 'replace' : 'append',
          playerFacing: false,
          fallbackTitle: page.title,
          fallbackKind: page.kind,
        }),
      );
  }, [drafts.data, page.contentMd, page.kind, page.title, proposal?.generationId]);

  const elsewhere = useMemo(() => {
    const here = new Set(pending.map((p) => p.generationId));
    return (drafts.data ?? []).filter(
      (g) => !here.has(g.id) && g.id !== proposal?.generationId,
    ).length;
  }, [drafts.data, pending, proposal?.generationId]);

  const run = (action: CodexAiAction) => {
    if (offReason || busy) return;
    const spec = ACTION_BY_ID.get(action);
    const useSection = action === 'expand' && sectionId.length > 0;
    const heading = sections.find((s) => s.id === sectionId)?.heading;
    setRunning(action);
    ask.mutate(
      {
        action,
        ctx: {
          ...ctx,
          ...(useSection && heading ? { sectionId, sectionHeading: heading } : {}),
        },
        extra,
        playerFacing,
        mode: useSection ? 'section' : (spec?.mode === 'section' ? 'replace' : (spec?.mode ?? 'replace')),
        ...(useSection ? { sectionId } : {}),
        // FR12.16: during play the fast slot, so inference never starves the table.
        ...((sessionLive ?? Boolean(campaign.data?.activeSessionId))
          ? { slot: 'fast' as const }
          : {}),
      },
      {
        onSuccess: (result) => {
          setProposal(result);
          setNonce((n) => n + 1);
          setRunning(null);
        },
        onError: () => setRunning(null),
      },
    );
  };

  const accept = (p: CodexProposal) => (payload: AcceptPayload) => {
    apply.mutate(
      { proposal: p, contentMd: payload.merged },
      { onSuccess: () => setProposal((cur) => (cur?.generationId === p.generationId ? null : cur)) },
    );
  };

  const discard = (p: CodexProposal) => () => {
    reject.mutate(p, {
      onSuccess: () => setProposal((cur) => (cur?.generationId === p.generationId ? null : cur)),
    });
  };

  return (
    <section className="panel p-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="mono-label text-magenta">Fixer · fill this page in</div>
        {busy && <Spinner label={running ?? 'working'} />}
      </div>

      {offReason ? (
        <p className="mt-2 text-xs text-warn">
          {offReason}{' '}
          <Link className="text-cyan underline" to={`/c/${campaignId}/gm/fixer`}>
            How to switch it on
          </Link>
          .
        </p>
      ) : (
        <p className="mono-label mt-1 text-faint">
          drafts only — you accept, edit or reject every word
        </p>
      )}

      <div className="mt-2 flex flex-col gap-1.5">
        {CODEX_AI_ACTIONS.map((a) => {
          const label =
            a.id === 'expand' && sectionId.length > 0
              ? `expand “${sections.find((s) => s.id === sectionId)?.heading ?? ''}”`
              : a.id === 'draft' && !isStub(page.contentMd)
                ? 'draft a fresh version'
                : a.label;
          return (
            <button
              key={a.id}
              type="button"
              className="btn w-full justify-start px-3 py-1.5 text-left disabled:cursor-not-allowed disabled:border-edge disabled:text-faint disabled:opacity-60"
              disabled={Boolean(offReason) || busy}
              title={offReason ?? a.hint}
              onClick={() => run(a.id)}
            >
              {label}
            </button>
          );
        })}
      </div>

      <p className="mono-label mt-1.5 text-faint">
        {ACTION_BY_ID.get('summarise')?.hint}
      </p>

      {sections.length > 0 && (
        <label className="mt-2 block">
          <span className="mono-label">Section to expand</span>
          <select
            className={`${inputClass} mt-1`}
            value={sectionId}
            onChange={(e) => setSectionId(e.target.value)}
            disabled={Boolean(offReason) || busy}
            aria-label="Section to expand"
          >
            <option value="">— the whole page —</option>
            {sections.map((s) => (
              <option key={s.id} value={s.id}>
                {s.heading}
              </option>
            ))}
          </select>
        </label>
      )}

      <label className="mt-2 block">
        <span className="mono-label">Steer it (optional)</span>
        <input
          className={`${inputClass} mt-1`}
          value={extra}
          onChange={(e) => setExtra(e.target.value)}
          placeholder="e.g. lean on the Rusting Crown feud"
          disabled={Boolean(offReason) || busy}
          aria-label="Extra direction for the Fixer"
        />
      </label>

      <label className="mono-label mt-2 flex items-center gap-2 text-dim">
        <input
          type="checkbox"
          checked={playerFacing}
          onChange={(e) => setPlayerFacing(e.target.checked)}
          disabled={Boolean(offReason) || busy}
        />
        the table will read this — run the spoiler guard
      </label>

      {askError && <ErrorNote error={askError} />}
      <ErrorNote error={apply.error ?? reject.error} />

      {(proposal || pending.length > 0) && (
        <ul className="mt-3 space-y-3">
          {proposal && (
            <ProposalCard
              key={`${proposal.generationId ?? 'local'}-${nonce}`}
              proposal={proposal}
              currentMd={page.contentMd}
              sections={sections}
              busy={apply.isPending || reject.isPending}
              onAccept={accept(proposal)}
              onReject={discard(proposal)}
            />
          )}
          {pending.map((p) => (
            <ProposalCard
              key={p.generationId ?? p.title}
              proposal={p}
              currentMd={page.contentMd}
              sections={sections}
              busy={apply.isPending || reject.isPending}
              onAccept={accept(p)}
              onReject={discard(p)}
            />
          ))}
        </ul>
      )}

      {elsewhere > 0 && (
        <p className="mono-label mt-2 text-faint">
          {elsewhere} more codex draft(s) waiting for other pages —{' '}
          <Link className="text-cyan underline" to={`/c/${campaignId}/gm/fixer`}>
            drafts inbox
          </Link>
        </p>
      )}
    </section>
  );
}
