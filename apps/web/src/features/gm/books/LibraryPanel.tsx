/**
 * Bookmarks and the recently-opened trail (FR11.6). The routes have been on
 * the server since M11 — `GET /api/campaigns/:id/library`, the bookmark CRUD,
 * the trail — and nothing on screen called them (docs/UX_AUDIT.md). Everyone
 * at the table sees the same list; the GM names, pins, re-labels and removes.
 * A bookmark is a page the table keeps arguing about, so pinned ones sit on
 * top, and every entry opens the book over whatever is on screen.
 */
import { useState } from 'react';
import ConfirmButton from '../../grid/gm/ConfirmButton.js';
import { ErrorNote, inputClass } from '../ui.js';
import {
  useAddBookmark,
  useLibrary,
  useRemoveBookmark,
  useUpdateBookmark,
  type BookRecord,
  type Bookmark,
} from './api.js';
import { BookViewerOverlay } from './RefChip.js';

/** Pinned first, then by label — the argument the table keeps having sits on top. */
export function orderBookmarks(list: readonly Bookmark[]): Bookmark[] {
  return [...list].sort(
    (a, b) =>
      Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || a.label.localeCompare(b.label),
  );
}

export interface LibraryPanelProps {
  campaignId: string;
  /** The GM: add, rename, pin, remove. Everyone else reads and opens. */
  canEdit: boolean;
  /** The shelf, for the add form's book picker. */
  books?: readonly BookRecord[] | undefined;
}

export default function LibraryPanel({ campaignId, canEdit, books }: LibraryPanelProps) {
  const library = useLibrary(campaignId);
  const add = useAddBookmark(campaignId);
  const update = useUpdateBookmark(campaignId);
  const remove = useRemoveBookmark(campaignId);
  const [open, setOpen] = useState<{ code: string; page: number } | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; label: string } | null>(null);
  const [form, setForm] = useState({ book: '', page: '', label: '', note: '' });

  const bookmarks = orderBookmarks(library.data?.bookmarks ?? []);
  const recent = library.data?.recentRefs ?? [];
  const shelf = (books ?? []).filter((b) => b.hasFile !== false);
  const bookCode = form.book || shelf[0]?.code || '';
  const pageNum = Number.parseInt(form.page, 10);
  const canAdd =
    canEdit &&
    bookCode !== '' &&
    Number.isFinite(pageNum) &&
    pageNum > 0 &&
    form.label.trim().length > 0;

  const submitAdd = () => {
    if (!canAdd) return;
    add.mutate(
      {
        book: bookCode,
        page: pageNum,
        label: form.label.trim(),
        ...(form.note.trim() ? { note: form.note.trim() } : {}),
      },
      { onSuccess: () => setForm({ book: bookCode, page: '', label: '', note: '' }) },
    );
  };

  return (
    <div className="panel p-4" data-testid="library-panel">
      <div className="flex flex-wrap items-baseline gap-2">
        <h2 className="mono-label text-dim">Bookmarks</h2>
        <span className="mono-label text-faint">
          {canEdit ? 'pages the table keeps arguing about — you name them' : 'the pages the GM named'}
        </span>
      </div>

      {library.isPending && <p className="mt-2 text-sm text-dim">Loading…</p>}
      <ErrorNote error={library.error} />
      {library.data && bookmarks.length === 0 && (
        <p className="mt-2 text-sm text-dim" data-testid="bookmarks-empty">
          {canEdit
            ? 'No bookmarks yet. Name a page below, or with the bookmark button inside any open book.'
            : 'The GM has not bookmarked anything yet.'}
        </p>
      )}

      {bookmarks.length > 0 && (
        <ul className="mt-2 divide-y divide-edge/60" data-testid="bookmark-list">
          {bookmarks.map((b) => (
            <li
              key={b.id}
              className="flex flex-wrap items-center gap-2 py-1.5"
              data-bookmark={b.id}
              data-pinned={b.pinned ? 'yes' : 'no'}
            >
              {b.pinned && (
                <span className="mono-label text-cyan" title="Pinned">
                  ★
                </span>
              )}
              <button
                type="button"
                className="chip cursor-pointer border-cyan-dim/60 text-cyan hover:border-cyan"
                onClick={() => setOpen({ code: b.book, page: b.page })}
                title={`Open ${b.title} at printed page ${b.page}`}
              >
                {b.ref}
              </button>
              {renaming?.id === b.id ? (
                <form
                  className="flex items-center gap-1"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const label = renaming.label.trim();
                    if (!label) return;
                    update.mutate({ id: b.id, patch: { label } }, { onSuccess: () => setRenaming(null) });
                  }}
                >
                  <input
                    className={`${inputClass} w-48`}
                    value={renaming.label}
                    autoFocus
                    onChange={(e) => setRenaming({ id: b.id, label: e.target.value })}
                    aria-label="New bookmark label"
                  />
                  <button type="submit" className="btn px-2 py-1" disabled={update.isPending}>
                    save
                  </button>
                  <button type="button" className="btn px-2 py-1" onClick={() => setRenaming(null)}>
                    cancel
                  </button>
                </form>
              ) : (
                <span className="text-sm text-ink">{b.label}</span>
              )}
              {b.note && <span className="text-xs text-dim">— {b.note}</span>}
              {canEdit && renaming?.id !== b.id && (
                <span className="ml-auto flex items-center gap-1">
                  <button
                    type="button"
                    className="btn px-2 py-1"
                    onClick={() => update.mutate({ id: b.id, patch: { pinned: !b.pinned } })}
                    title={b.pinned ? 'Unpin' : 'Pin to the top'}
                  >
                    {b.pinned ? 'unpin' : 'pin'}
                  </button>
                  <button
                    type="button"
                    className="btn px-2 py-1"
                    onClick={() => setRenaming({ id: b.id, label: b.label })}
                  >
                    rename
                  </button>
                  <ConfirmButton
                    className="btn px-2 py-1 text-danger"
                    label="remove"
                    confirmLabel="remove?"
                    onConfirm={() => remove.mutate(b.id)}
                    testId={`remove-bookmark-${b.id}`}
                  />
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {canEdit && (
        <form
          className="mt-3 flex flex-wrap items-end gap-2 border-t border-edge/60 pt-3"
          data-testid="bookmark-form"
          onSubmit={(e) => {
            e.preventDefault();
            submitAdd();
          }}
        >
          <label className="flex flex-col gap-1">
            <span className="mono-label">book</span>
            <select
              className={`${inputClass} w-auto`}
              value={bookCode}
              onChange={(e) => setForm({ ...form, book: e.target.value })}
              aria-label="Book"
            >
              {shelf.map((b) => (
                <option key={b.id} value={b.code}>
                  {b.code}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="mono-label">printed p.</span>
            <input
              className={`${inputClass} w-20`}
              inputMode="numeric"
              value={form.page}
              onChange={(e) => setForm({ ...form, page: e.target.value })}
              placeholder="426"
              aria-label="Printed page"
            />
          </label>
          <label className="flex min-w-[10rem] flex-1 flex-col gap-1">
            <span className="mono-label">label</span>
            <input
              className={inputClass}
              value={form.label}
              onChange={(e) => setForm({ ...form, label: e.target.value })}
              placeholder="called shots"
              aria-label="Bookmark label"
            />
          </label>
          <label className="flex min-w-[10rem] flex-1 flex-col gap-1">
            <span className="mono-label">note</span>
            <input
              className={inputClass}
              value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
              placeholder="optional"
              aria-label="Bookmark note"
            />
          </label>
          <button
            type="submit"
            className="btn btn-accent px-3 py-1.5"
            disabled={!canAdd || add.isPending}
          >
            {add.isPending ? 'adding…' : 'add bookmark'}
          </button>
          <ErrorNote error={add.error ?? update.error ?? remove.error} />
        </form>
      )}

      <div className="mt-4">
        <div className="flex flex-wrap items-baseline gap-2">
          <h2 className="mono-label text-dim">Recently opened</h2>
          <span className="mono-label text-faint">what the table was just reading</span>
        </div>
        {recent.length === 0 ? (
          <p className="mt-1 text-sm text-dim" data-testid="recent-empty">
            Nothing opened yet — every book anyone opens is remembered here.
          </p>
        ) : (
          <div className="mt-2 flex flex-wrap gap-1.5" data-testid="recent-refs">
            {recent.map((r, i) => (
              <button
                key={`${r.book}-${r.page}-${i}`}
                type="button"
                className="chip cursor-pointer text-dim hover:text-cyan"
                onClick={() => setOpen({ code: r.book, page: r.page })}
                title={r.label ? `${r.label} — ${r.ref}` : r.ref}
              >
                {r.ref}
                {r.label ? <span className="ml-1 normal-case text-faint">{r.label}</span> : null}
              </button>
            ))}
          </div>
        )}
      </div>

      {open && (
        <BookViewerOverlay code={open.code} printedPage={open.page} onClose={() => setOpen(null)} />
      )}
    </div>
  );
}
