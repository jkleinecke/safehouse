/**
 * Bookmarks and the recently-opened trail (FR11.6). The routes have been on
 * the server since M11 — `GET /api/campaigns/:id/library`, the bookmark CRUD,
 * the trail — and nothing on screen called them (docs/UX_AUDIT.md). Everyone
 * at the table sees the same table; the GM pins and removes in the row, and
 * adds or edits in a popup (the + under the table). A bookmark is a page the
 * table keeps arguing about, so pinned ones sit on top, and every entry opens
 * the book over whatever is on screen.
 */
import { useState } from 'react';
import ConfirmButton from '../../grid/gm/ConfirmButton.js';
import { Sheet } from '../../sheet/components/ui.js';
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
  /** The GM: add, edit, pin, remove. Everyone else reads and opens. */
  canEdit: boolean;
  /** The shelf, for the add form's book picker. */
  books?: readonly BookRecord[] | undefined;
}

interface BookmarkDraft {
  /** Set when editing an existing bookmark; its book cannot change. */
  id?: string;
  book: string;
  page: string;
  label: string;
  note: string;
}

export default function LibraryPanel({ campaignId, canEdit, books }: LibraryPanelProps) {
  const library = useLibrary(campaignId);
  const add = useAddBookmark(campaignId);
  const update = useUpdateBookmark(campaignId);
  const remove = useRemoveBookmark(campaignId);
  const [open, setOpen] = useState<{ code: string; page: number } | null>(null);
  const [draft, setDraft] = useState<BookmarkDraft | null>(null);
  /** The book the last add used — the next add starts there. */
  const [lastBook, setLastBook] = useState('');

  const bookmarks = orderBookmarks(library.data?.bookmarks ?? []);
  const recent = library.data?.recentRefs ?? [];
  const shelf = (books ?? []).filter((b) => b.hasFile !== false);

  const startAdd = () =>
    setDraft({ book: lastBook || shelf[0]?.code || '', page: '', label: '', note: '' });
  const startEdit = (b: Bookmark) =>
    setDraft({ id: b.id, book: b.book, page: String(b.page), label: b.label, note: b.note ?? '' });

  const pageNum = draft ? Number.parseInt(draft.page, 10) : NaN;
  const canSave =
    canEdit &&
    draft !== null &&
    draft.book !== '' &&
    Number.isFinite(pageNum) &&
    pageNum > 0 &&
    draft.label.trim().length > 0;
  const saving = add.isPending || update.isPending;

  const submit = () => {
    if (!canSave || !draft) return;
    const label = draft.label.trim();
    const note = draft.note.trim();
    const done = { onSuccess: () => setDraft(null) };
    if (draft.id) {
      update.mutate({ id: draft.id, patch: { page: pageNum, label, note } }, done);
    } else {
      setLastBook(draft.book);
      add.mutate({ book: draft.book, page: pageNum, label, ...(note ? { note } : {}) }, done);
    }
  };

  return (
    <div className="panel p-4" data-testid="library-panel">
      <h2 className="mono-label text-dim">Bookmarks</h2>

      {library.isPending && <p className="mt-2 text-sm text-dim">Loading…</p>}
      <ErrorNote error={library.error} />
      {library.data && bookmarks.length === 0 && (
        <p className="mt-2 text-sm text-dim" data-testid="bookmarks-empty">
          {canEdit
            ? 'No bookmarks yet. Add one with +, or with the bookmark button inside any open book.'
            : 'The GM has not bookmarked anything yet.'}
        </p>
      )}

      {bookmarks.length > 0 && (
        <table className="mt-2 w-full text-left" data-testid="bookmark-list">
          <tbody>
            {bookmarks.map((b) => (
              <tr
                key={b.id}
                className="border-t border-edge/60 first:border-t-0"
                data-bookmark={b.id}
                data-pinned={b.pinned ? 'yes' : 'no'}
              >
                <td className="w-4 py-1.5 pr-1 text-center">
                  {b.pinned && (
                    <span className="mono-label text-cyan" title="Pinned">
                      ★
                    </span>
                  )}
                </td>
                <td className="whitespace-nowrap py-1.5 pr-2">
                  <button
                    type="button"
                    className="chip cursor-pointer border-cyan-dim/60 text-cyan hover:border-cyan"
                    onClick={() => setOpen({ code: b.book, page: b.page })}
                    title={`Open ${b.title} at printed page ${b.page}`}
                  >
                    {b.ref}
                  </button>
                </td>
                <td className="w-full py-1.5 pr-2 text-sm text-ink">
                  {b.label}
                  {b.note && <span className="ml-2 text-xs text-dim">— {b.note}</span>}
                </td>
                {canEdit && (
                  <td className="whitespace-nowrap py-1.5 text-right">
                    <span className="inline-flex items-center gap-1">
                      <button
                        type="button"
                        className="btn px-2 py-1"
                        onClick={() => update.mutate({ id: b.id, patch: { pinned: !b.pinned } })}
                        title={b.pinned ? 'Unpin' : 'Pin to the top'}
                      >
                        {b.pinned ? 'unpin' : 'pin'}
                      </button>
                      <button type="button" className="btn px-2 py-1" onClick={() => startEdit(b)}>
                        edit
                      </button>
                      <ConfirmButton
                        className="btn px-2 py-1 text-danger"
                        label="remove"
                        confirmLabel="remove?"
                        onConfirm={() => remove.mutate(b.id)}
                        testId={`remove-bookmark-${b.id}`}
                      />
                    </span>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {canEdit && (
        <div className="mt-2 border-t border-edge/60 pt-2">
          <button
            type="button"
            className="btn btn-accent px-3 py-1"
            onClick={startAdd}
            disabled={shelf.length === 0}
            aria-label="Add a bookmark"
            title="Add a bookmark"
            data-testid="add-bookmark"
          >
            +
          </button>
          <ErrorNote error={update.error ?? remove.error} />
        </div>
      )}

      {canEdit && (
        <Sheet
          open={draft !== null}
          onClose={() => setDraft(null)}
          title={draft?.id ? 'Edit bookmark' : 'Add a bookmark'}
        >
          {draft && (
            <form
              className="flex flex-col gap-3"
              data-testid="bookmark-form"
              onSubmit={(e) => {
                e.preventDefault();
                submit();
              }}
            >
              <div className="flex flex-wrap gap-3">
                <label className="flex min-w-[12rem] flex-1 flex-col gap-1">
                  <span className="mono-label">book</span>
                  <select
                    className={inputClass}
                    value={draft.book}
                    disabled={Boolean(draft.id)}
                    onChange={(e) => setDraft({ ...draft, book: e.target.value })}
                    aria-label="Book"
                  >
                    {shelf.map((b) => (
                      <option key={b.id} value={b.code}>
                        {b.title || b.code}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1">
                  <span className="mono-label">printed p.</span>
                  <input
                    className={`${inputClass} w-24`}
                    inputMode="numeric"
                    value={draft.page}
                    onChange={(e) => setDraft({ ...draft, page: e.target.value })}
                    placeholder="426"
                    aria-label="Printed page"
                  />
                </label>
              </div>
              <label className="flex flex-col gap-1">
                <span className="mono-label">label</span>
                <input
                  className={inputClass}
                  value={draft.label}
                  autoFocus
                  onChange={(e) => setDraft({ ...draft, label: e.target.value })}
                  placeholder="called shots"
                  aria-label="Bookmark label"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="mono-label">note</span>
                <input
                  className={inputClass}
                  value={draft.note}
                  onChange={(e) => setDraft({ ...draft, note: e.target.value })}
                  placeholder="optional"
                  aria-label="Bookmark note"
                />
              </label>
              <ErrorNote error={draft.id ? update.error : add.error} />
              <div className="flex justify-end gap-2">
                <button type="button" className="btn px-3 py-1.5" onClick={() => setDraft(null)}>
                  cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-accent px-3 py-1.5"
                  disabled={!canSave || saving}
                >
                  {saving ? 'saving…' : draft.id ? 'save' : 'add bookmark'}
                </button>
              </div>
            </form>
          )}
        </Sheet>
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
