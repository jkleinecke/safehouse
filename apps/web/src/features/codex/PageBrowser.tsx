/**
 * The wiki browser (FR5.1/5.3): kind filters, tag search, and the GM's
 * dangling-link report as create-prompts.
 *
 * The list the server hands back is already cut to what this device may open
 * (Principle 4) — a GM-only page is absent, not greyed out — so every count and
 * every tag here is honest for whoever is looking at it.
 */
import { useMemo, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import type { Visibility } from '@safehouse/contracts';
import { useCreatePage, usePages, useUnresolvedLinks } from './api.js';
import { NewPagePrompt } from './ai/index.js';
import {
  PAGE_KINDS,
  collectTags,
  filterPages,
  presentKinds,
  visibilityLabel,
  visibilityTone,
} from './lib.js';

const inputClass =
  'w-full rounded-md border border-edge bg-deck px-2.5 py-1.5 text-sm text-ink ' +
  'placeholder:text-faint focus:border-cyan focus:outline-none';

export interface PageBrowserProps {
  campaignId: string;
  isGm: boolean;
  /** Pre-filled title when the reader clicked an unresolved `[[link]]`. */
  pendingTitle?: string;
  onPendingHandled?: () => void;
}

export default function PageBrowser({
  campaignId,
  isGm,
  pendingTitle,
  onPendingHandled,
}: PageBrowserProps) {
  const navigate = useNavigate();
  const pages = usePages(campaignId);
  const unresolved = useUnresolvedLinks(campaignId, isGm);
  const create = useCreatePage(campaignId);

  const [kind, setKind] = useState<string | null>(null);
  const [tag, setTag] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [newKind, setNewKind] = useState<string>('lore');

  const all = pages.data ?? [];
  const rows = useMemo(() => filterPages(all, { kind, tag, q }), [all, kind, tag, q]);
  const tags = useMemo(() => collectTags(all), [all]);
  const kinds = useMemo(() => presentKinds(all), [all]);

  const title = pendingTitle ?? newTitle;

  const submit = (value: string, chosenKind = newKind) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    create.mutate(
      // GM-only until deliberately revealed — the codex defaults to secret.
      { title: trimmed, kind: chosenKind, visibility: 'gm' as Visibility },
      {
        // Land on the page you just made. Creating a page and being left on
        // "Pick a page" reads as a failure — and the next thing the GM wants
        // is to write in it.
        onSuccess: (created) => {
          setNewTitle('');
          onPendingHandled?.();
          navigate(`/c/${campaignId}/codex/${created.id}`);
        },
      },
    );
  };

  return (
    <div className="flex min-h-0 flex-col gap-3">
      <div>
        <label className="block">
          <span className="sr-only">Search the codex</span>
          <input
            className={inputClass}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="search titles and tags…"
            type="search"
          />
        </label>
      </div>

      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by kind">
        <button
          type="button"
          className={`chip cursor-pointer ${kind === null ? 'border-cyan text-cyan' : 'text-dim hover:text-ink'}`}
          onClick={() => setKind(null)}
          aria-pressed={kind === null}
        >
          all {all.length > 0 ? all.length : ''}
        </button>
        {kinds.map((k) => (
          <button
            key={k}
            type="button"
            className={`chip cursor-pointer ${kind === k ? 'border-cyan text-cyan' : 'text-dim hover:text-ink'}`}
            onClick={() => setKind(kind === k ? null : k)}
            aria-pressed={kind === k}
          >
            {k}
          </button>
        ))}
      </div>

      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by tag">
          {tags.map(({ tag: t, count }) => (
            <button
              key={t}
              type="button"
              className={`chip cursor-pointer ${
                tag?.toLowerCase() === t.toLowerCase()
                  ? 'border-magenta text-magenta'
                  : 'text-faint hover:text-ink'
              }`}
              onClick={() => setTag(tag?.toLowerCase() === t.toLowerCase() ? null : t)}
              aria-pressed={tag?.toLowerCase() === t.toLowerCase()}
            >
              #{t} {count}
            </button>
          ))}
        </div>
      )}

      <ul className="min-h-0 flex-1 divide-y divide-edge/60 overflow-y-auto">
        {pages.isLoading && <li className="py-4 text-sm text-faint">Reading the codex…</li>}
        {!pages.isLoading && rows.length === 0 && (
          <li className="py-4 text-sm text-faint">
            {all.length === 0 ? (
              <>
                <span className="block text-dim">
                  The codex is the campaign&rsquo;s memory: the NPCs, factions, locations, runs and
                  lore the table has earned. Pages start GM-only and you reveal them a section at a
                  time.
                </span>
                <span className="mt-2 block">
                  {isGm
                    ? 'Name one below — or describe what you want and let the Fixer write the first draft.'
                    : 'Nothing has been shared with the table yet.'}
                </span>
              </>
            ) : (
              'No page matches those filters.'
            )}
          </li>
        )}
        {rows.map((p) => (
          <li key={p.id}>
            <NavLink
              to={`/c/${campaignId}/codex/${p.id}`}
              className={({ isActive }) =>
                `block rounded-md px-2 py-2 transition-colors ${
                  isActive ? 'bg-raised' : 'hover:bg-panel'
                }`
              }
            >
              <div className="flex items-center gap-2">
                <span className="chip shrink-0 text-faint">{p.kind}</span>
                <span className="min-w-0 flex-1 truncate text-sm text-ink">{p.title}</span>
                <span className={`chip shrink-0 ${visibilityTone(p.visibility)}`}>
                  {visibilityLabel(p.visibility)}
                </span>
              </div>
              {p.tags.length > 0 && (
                <div className="mono-label mt-0.5 truncate text-faint">
                  {p.tags.map((t) => `#${t}`).join(' ')}
                  {isGm && p.gmOnlySections ? ` · ${p.gmOnlySections} hidden` : ''}
                </div>
              )}
            </NavLink>
          </li>
        ))}
      </ul>

      {isGm && (
        <form
          className="border-t border-edge pt-3"
          onSubmit={(e) => {
            e.preventDefault();
            submit(title);
          }}
        >
          <div className="mono-label">New page</div>
          <div className="mt-1.5 flex gap-2">
            <input
              className={inputClass}
              value={title}
              onChange={(e) => {
                setNewTitle(e.target.value);
                if (pendingTitle) onPendingHandled?.();
              }}
              placeholder="page title"
              aria-label="New page title"
            />
            <select
              className={`${inputClass} w-auto`}
              value={newKind}
              onChange={(e) => setNewKind(e.target.value)}
              aria-label="New page kind"
            >
              {PAGE_KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
            <button className="btn btn-accent shrink-0 px-3 py-1.5" type="submit" disabled={create.isPending}>
              {create.isPending ? '…' : 'add'}
            </button>
          </div>
          <p className="mono-label mt-1.5 text-faint">Created GM-only — reveal it deliberately.</p>
        </form>
      )}

      {/* A title and a kind is not a page. Describe one instead and the Fixer
          drafts it — as a draft you accept or reject (Principle 8). */}
      {isGm && (
        <NewPagePrompt campaignId={campaignId} {...(pendingTitle ? { seedTitle: pendingTitle } : {})} />
      )}

      {isGm && (unresolved.data?.length ?? 0) > 0 && (
        <div className="border-t border-edge pt-3">
          <div className="mono-label text-warn">Links with no page</div>
          <ul className="mt-1.5 space-y-1">
            {(unresolved.data ?? []).slice(0, 12).map((u) => (
              <li key={u.target} className="flex items-center gap-2">
                <button
                  type="button"
                  className="chip cursor-pointer border-warn/40 text-warn hover:border-cyan hover:text-cyan"
                  onClick={() => submit(u.target)}
                  disabled={create.isPending}
                  title={`Create “${u.target}”`}
                >
                  {u.target} +
                </button>
                <span className="mono-label min-w-0 flex-1 truncate text-faint">
                  from {u.from.map((f) => f.title).join(', ')}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
