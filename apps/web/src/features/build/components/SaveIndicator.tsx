/**
 * The autosave's one line (FR3.9, docs/CHARGEN.md §4.4 "Autosave on every
 * change"): saving, saved, not saved and why.
 *
 * A player who closes the tab needs to know the last tap reached the server,
 * so the state is text, not a spinner alone. A save that failed offers retry;
 * a build that stopped being editable says what happened (the session's
 * conflict sentence) and offers nothing, because there is nothing a retry
 * could do. A save refused because another device saved first (`stale`) is
 * the one conflict the player settles: the edits are still on screen, so it
 * offers "keep mine" (save them over the other version) and "take theirs".
 *
 * What a screen reader *hears* is narrower than what is shown. Autosave cycles
 * unsaved → saving → saved on every edit, and a live region that spoke each
 * one talked over every stepper press. So the visible word is plain text, and
 * the polite live region carries only what needs hearing unprompted: a save
 * that failed, or a build that can no longer be saved (`saveAnnouncement`).
 */
import { useId } from 'react';
import type { SaveStatus } from '../session.js';

export interface SaveIndicatorProps {
  status: SaveStatus;
  error: string | null;
  readOnly: boolean;
  onRetry?: () => void;
  /** Another device saved first; the two ways out. */
  stale?: { onKeepMine: () => void; onTakeTheirs: () => void } | null;
}

/** The words for a status. Pure, so the vocabulary is tested once. */
export function saveText(status: SaveStatus, readOnly: boolean): string {
  if (status === 'conflict') return 'not saved';
  if (readOnly) return 'read only';
  switch (status) {
    case 'saving':
      return 'saving…';
    case 'saved':
      return 'saved';
    case 'dirty':
      return 'unsaved changes';
    case 'error':
      return 'not saved';
    default:
      return 'up to date';
  }
}

/** What the live region says for a status: only failures, never the routine cycle. */
export function saveAnnouncement(status: SaveStatus, error: string | null): string {
  if (status !== 'error' && status !== 'conflict') return '';
  return error ? `Not saved: ${error}` : 'Not saved.';
}

const TONE: Record<SaveStatus, string> = {
  idle: 'text-faint',
  dirty: 'text-warn',
  saving: 'text-cyan',
  saved: 'text-ok',
  error: 'text-danger',
  conflict: 'text-danger',
};

export default function SaveIndicator({ status, error, readOnly, onRetry, stale }: SaveIndicatorProps) {
  const text = saveText(status, readOnly);
  const errorId = useId();
  const choosing = status === 'conflict' && stale ? stale : null;
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2" data-testid="save-indicator" data-status={status}>
      <span className={`mono-label ${readOnly && status !== 'conflict' ? 'text-faint' : TONE[status]}`}>{text}</span>
      <span role="status" aria-live="polite" className="sr-only" data-testid="save-announcement">
        {saveAnnouncement(status, error)}
      </span>
      {(status === 'error' || status === 'conflict') && error && (
        <span id={errorId} className="min-w-0 text-xs text-danger" data-testid="save-error">
          {error}
        </span>
      )}
      {choosing && (
        <span className="flex flex-wrap items-center gap-2" role="group" aria-label="Which version stands" data-testid="save-stale">
          <button
            type="button"
            className="btn px-3 py-1"
            onClick={choosing.onKeepMine}
            aria-describedby={errorId}
            data-testid="save-keep-mine"
          >
            keep mine
          </button>
          <button
            type="button"
            className="btn px-3 py-1"
            onClick={choosing.onTakeTheirs}
            aria-describedby={errorId}
            data-testid="save-take-theirs"
          >
            take theirs
          </button>
        </span>
      )}
      {status === 'error' && onRetry && (
        <button type="button" className="chip text-danger" onClick={onRetry}>
          retry
        </button>
      )}
    </div>
  );
}
