/**
 * One codex page (FR5.1–5.4).
 *
 * Read mode renders the markdown with live `[[links]]` and ref chips. Edit mode
 * (GM) is the same single document — per-section visibility is metadata keyed
 * by heading slug, not a second copy of the prose, so a rewrite never loses a
 * secret's setting.
 *
 * Secrecy: everything here came out of the server already cut down for this
 * device. The visibility badges are the GM's own bookkeeping, never a
 * client-side filter (Principle 4).
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Visibility } from '@safehouse/contracts';
import { RefChip } from '../gm/books/RefChip.js';
import { ErrorNote } from '../gm/ui.js';
import Markdown from './Markdown.js';
import HandoutsPanel from './HandoutsPanel.js';
import TemplatePanel from './TemplatePanel.js';
import {
  useDeletePage,
  usePage,
  useRevealPage,
  useUpdatePage,
  type CodexPage,
} from './api.js';
import {
  PAGE_KINDS,
  inheritedSecrets,
  pinSectionsForReveal,
  visibilityLabel,
  visibilityTone,
} from './lib.js';
import { sectionOutline } from './md.js';

const inputClass =
  'w-full rounded-md border border-edge bg-deck px-2.5 py-1.5 text-sm text-ink ' +
  'placeholder:text-faint focus:border-cyan focus:outline-none';

export interface PageViewProps {
  campaignId: string;
  pageId: string;
  isGm: boolean;
  /** Clicking an unresolved `[[link]]` hands the title to the browser pane. */
  onCreatePrompt?: (title: string) => void;
}

/** FR5.2's three modes, in the order the GM reaches for them. */
const VISIBILITIES: Visibility[] = ['gm', 'gm_owner', 'public'];

function SectionControls({
  page,
  campaignId,
}: {
  page: CodexPage;
  campaignId: string;
}) {
  const reveal = useRevealPage(campaignId, page.id);
  // The GM edits the whole document, so the outline is computed from the text
  // they can see — which for a GM is all of it.
  const outline = sectionOutline(page.contentMd);
  const explicit = new Map(page.sections.map((s) => [s.id, s]));

  if (outline.length === 0) {
    return (
      <p className="mt-2 text-xs text-faint">
        Add `##` headings and each one becomes a separately revealable section.
      </p>
    );
  }

  return (
    <ul className="mt-2 space-y-1.5">
      {outline.map((s) => {
        const meta = explicit.get(s.id);
        const current = meta?.visibility ?? page.visibility;
        const inherited = meta?.explicit !== true;
        return (
          <li key={s.id} className="flex flex-wrap items-center gap-1.5">
            <a
              href={`#section-${s.id}`}
              className="min-w-0 flex-1 truncate text-xs text-dim hover:text-cyan"
              style={{ paddingLeft: `${(s.level - 1) * 8}px` }}
              title={inherited ? 'inherits the page’s visibility' : 'set on this section'}
            >
              {s.heading}
              {inherited && <span className="mono-label ml-1 text-faint">inherited</span>}
            </a>
            {VISIBILITIES.map((v) => (
              <button
                key={v}
                type="button"
                className={`chip cursor-pointer ${
                  current === v ? visibilityTone(v) : 'text-faint hover:text-ink'
                }`}
                aria-pressed={current === v}
                aria-label={`${s.heading}: ${visibilityLabel(v)}`}
                disabled={reveal.isPending}
                onClick={() =>
                  reveal.mutate({
                    section: s.id,
                    visibility: v,
                    // Only a reveal is table news; hiding again is housekeeping.
                    announce: v === 'public',
                  })
                }
              >
                {visibilityLabel(v)}
              </button>
            ))}
          </li>
        );
      })}
      <ErrorNote error={reveal.error} />
    </ul>
  );
}

function Editor({
  page,
  campaignId,
  onDone,
}: {
  page: CodexPage;
  campaignId: string;
  onDone: () => void;
}) {
  const update = useUpdatePage(campaignId, page.id);
  const [title, setTitle] = useState(page.title);
  const [kind, setKind] = useState(page.kind);
  const [tags, setTags] = useState(page.tags.join(', '));
  const [body, setBody] = useState(page.contentMd);

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        update.mutate(
          {
            title: title.trim() || page.title,
            kind,
            contentMd: body,
            tags: tags
              .split(',')
              .map((t) => t.trim())
              .filter(Boolean),
          },
          { onSuccess: onDone },
        );
      }}
    >
      <div className="flex flex-wrap gap-2">
        <input
          className={`${inputClass} min-w-48 flex-1`}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          aria-label="Page title"
        />
        <select
          className={`${inputClass} w-auto`}
          value={kind}
          onChange={(e) => setKind(e.target.value)}
          aria-label="Page kind"
        >
          {[...new Set([...PAGE_KINDS, kind])].map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
      </div>
      <input
        className={inputClass}
        value={tags}
        onChange={(e) => setTags(e.target.value)}
        placeholder="tags, comma separated"
        aria-label="Tags"
      />
      <textarea
        className={`${inputClass} h-96 resize-y font-label text-xs leading-relaxed`}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        aria-label="Page content (Markdown)"
        spellCheck
      />
      <p className="mono-label text-faint">
        `## headings` split the page into revealable sections · `[[Page title]]` links ·
        `SR5 p.426` becomes a book chip
      </p>
      <div className="flex items-center gap-2">
        <button className="btn btn-accent px-3 py-1.5" type="submit" disabled={update.isPending}>
          {update.isPending ? 'saving…' : 'save'}
        </button>
        <button className="btn px-3 py-1.5" type="button" onClick={onDone}>
          cancel
        </button>
      </div>
      <ErrorNote error={update.error} />
    </form>
  );
}

export default function PageView({ campaignId, pageId, isGm, onCreatePrompt }: PageViewProps) {
  const navigate = useNavigate();
  const query = usePage(pageId);
  const reveal = useRevealPage(campaignId, pageId);
  const pin = useUpdatePage(campaignId, pageId);
  const remove = useDeletePage(campaignId);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    setEditing(false);
  }, [pageId]);

  // Error first, then "no data yet". Checking `isLoading` first leaves a real
  // hole: between a failed fetch and its retry the query is pending but not
  // fetching, so `isLoading` is false while `data` is still undefined — and the
  // pane rendered blank. A view must never silently show nothing (LIVE-1).
  if (query.isError) {
    return (
      <div className="p-4">
        <ErrorNote error={query.error} />
        <p className="mt-2 text-sm text-dim">
          That page is not in your codex. A page you may not read answers exactly like one that
          does not exist — that is deliberate (Principle 4).
        </p>
      </div>
    );
  }
  const page = query.data;
  if (!page) return <p className="p-4 text-sm text-faint">Opening the page…</p>;

  const resolve = (target: string): string | null => {
    const hit = page.links.resolved.find(
      (l) => l.target.trim().toLowerCase() === target.trim().toLowerCase(),
    );
    return hit?.pageId ?? null;
  };

  /** Sections a page-level reveal would drag into the light (see lib.ts). */
  const secrets = inheritedSecrets(page.sections);

  /**
   * Reveal the page without revealing its secrets: pin each inherited section
   * to the visibility it has RIGHT NOW, then flip the page. Every section's
   * effective visibility is unchanged; only the page shell and the sections
   * already marked shared become readable. Never widen a secrecy guarantee for
   * convenience (Principle 4).
   */
  const revealPageOnly = async () => {
    const sections = pinSectionsForReveal(page.sections);
    if (sections) await pin.mutateAsync({ sections });
    reveal.mutate({ visibility: 'public', announce: true });
  };

  return (
    <div className="min-w-0 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="chip text-faint">{page.kind}</span>
        <h1 className="min-w-0 flex-1 truncate text-lg font-semibold text-ink">{page.title}</h1>
        <span className={`chip ${visibilityTone(page.visibility)}`}>
          {visibilityLabel(page.visibility)}
        </span>
        {isGm && (
          <>
            <button className="btn px-3 py-1.5" onClick={() => setEditing((v) => !v)}>
              {editing ? 'stop editing' : 'edit'}
            </button>
            {page.visibility !== 'public' ? (
              <>
                <button
                  className="btn btn-accent px-3 py-1.5"
                  disabled={reveal.isPending || pin.isPending}
                  onClick={() => void revealPageOnly()}
                  title={
                    secrets.length > 0
                      ? `Share the page and say so in the log. ${secrets.length} unmarked section(s) stay hidden — reveal them one at a time.`
                      : 'Share this page with the table and say so in the log'
                  }
                >
                  {reveal.isPending || pin.isPending ? 'revealing…' : 'reveal to table'}
                </button>
                {secrets.length > 0 && (
                  <button
                    className="btn px-3 py-1.5 text-warn"
                    disabled={reveal.isPending || pin.isPending}
                    onClick={() => reveal.mutate({ visibility: 'public', announce: true })}
                    title="Share the page AND every unmarked section with it"
                  >
                    reveal everything
                  </button>
                )}
              </>
            ) : (
              <button
                className="btn px-3 py-1.5"
                disabled={reveal.isPending}
                onClick={() => reveal.mutate({ visibility: 'gm', announce: false })}
                title="Put it back behind the screen (no announcement)"
              >
                un-share
              </button>
            )}
          </>
        )}
      </div>

      {page.tags.length > 0 && (
        <div className="mono-label mt-1 text-faint">{page.tags.map((t) => `#${t}`).join(' ')}</div>
      )}
      <ErrorNote error={reveal.error ?? pin.error} />
      {isGm && page.visibility !== 'public' && secrets.length > 0 && (
        <p className="mono-label mt-1 text-warn">
          {secrets.length} section(s) are hidden only because the page is — “reveal to
          table” pins them first so they stay hidden.
        </p>
      )}

      <div className="mt-4 grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="min-w-0">
          {editing ? (
            <Editor page={page} campaignId={campaignId} onDone={() => setEditing(false)} />
          ) : (
            <Markdown
              md={page.contentMd}
              campaignId={campaignId}
              resolve={resolve}
              {...(isGm && onCreatePrompt ? { onCreate: onCreatePrompt } : {})}
            />
          )}
        </div>

        <aside className="space-y-4">
          {isGm && (
            <section className="panel p-3">
              <div className="mono-label text-cyan">Section visibility (FR5.2)</div>
              <SectionControls page={page} campaignId={campaignId} />
            </section>
          )}

          <section className="panel p-3">
            <div className="mono-label text-cyan">Backlinks</div>
            {page.backlinks.length === 0 ? (
              <p className="mt-2 text-xs text-faint">Nothing points here yet.</p>
            ) : (
              <ul className="mt-2 space-y-1">
                {page.backlinks.map((b) => (
                  <li key={b.id}>
                    <button
                      type="button"
                      className="text-left text-xs text-dim hover:text-cyan"
                      onClick={() => navigate(`/c/${campaignId}/codex/${b.id}`)}
                    >
                      <span className="chip mr-1.5 text-faint">{b.kind}</span>
                      {b.title}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {page.links.unresolved.length > 0 && (
            <section className="panel p-3">
              <div className="mono-label text-warn">Unwritten links</div>
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {page.links.unresolved.map((u) => (
                  <li key={u.target}>
                    <button
                      type="button"
                      className="chip cursor-pointer border-warn/40 text-warn hover:border-cyan hover:text-cyan"
                      onClick={() => onCreatePrompt?.(u.target)}
                      disabled={!isGm || !onCreatePrompt}
                    >
                      {u.target}
                      {isGm && onCreatePrompt ? ' +' : ''}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {page.refs.length > 0 && (
            <section className="panel p-3">
              <div className="mono-label text-cyan">Book refs (FR11.2)</div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {page.refs.map((r) => (
                  <RefChip key={`${r.book}-${r.page}`} refValue={{ book: r.book, page: r.page }} />
                ))}
              </div>
            </section>
          )}

          <HandoutsPanel campaignId={campaignId} page={page} isGm={isGm} />

          {/* FR5.6 — the archetypes this page is the entry for. Renders
              nothing for a player: the field is not in their response. */}
          <TemplatePanel campaignId={campaignId} page={page} isGm={isGm} />

          {isGm && (
            <button
              className="btn w-full px-3 py-1.5 text-danger"
              disabled={remove.isPending}
              onClick={() => {
                remove.mutate(page.id, {
                  onSuccess: () => navigate(`/c/${campaignId}/codex`, { replace: true }),
                });
              }}
            >
              delete page
            </button>
          )}
        </aside>
      </div>
    </div>
  );
}
