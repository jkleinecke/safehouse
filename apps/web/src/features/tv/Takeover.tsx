/**
 * Full-screen handout takeover (FR9.20): the title and body carry the reveal,
 * and the attachment itself is served from the file store at `/files/:id`.
 *
 * The TV is a `display` device with its own token, and an <img> cannot send an
 * Authorization header, so the token rides as `?token=` — the same iframe-safe
 * path the book reader uses. A missing or unreadable asset falls back to the
 * dashed frame rather than a broken-image icon on a wall-sized screen.
 */
import { useState } from 'react';
import { getToken } from '../../api/session.js';
import type { TvTakeover } from './feed.js';

export default function Takeover({ takeover }: { takeover: TvTakeover }) {
  const [failed, setFailed] = useState(false);
  const token = getToken();
  const src = takeover.attachmentId
    ? `/files/${takeover.attachmentId}${token ? `?token=${encodeURIComponent(token)}` : ''}`
    : null;

  return (
    <div
      className="tv-takeover absolute inset-0 z-20 flex flex-col items-center justify-center bg-ground/97 px-16 py-12"
      aria-label="Revealed handout"
    >
      <span className="font-label text-2xl tracking-[0.45em] text-magenta">
        {takeover.kind === 'handout' ? 'HANDOUT' : 'CODEX'}
      </span>
      <h1 className="mt-6 max-w-[24ch] text-center text-7xl font-bold leading-tight">
        {takeover.title}
      </h1>

      {takeover.body && (
        <p className="mt-8 max-w-[46ch] text-center text-4xl leading-snug text-dim">
          {takeover.body}
        </p>
      )}

      {src && !failed && (
        <img
          src={src}
          alt={takeover.title}
          onError={() => setFailed(true)}
          className="mt-10 max-h-[38vh] max-w-[62vw] rounded-2xl border-2 border-edge-bright object-contain"
        />
      )}

      {src && failed && (
        <div className="mt-10 flex h-[38vh] w-[62vw] items-center justify-center rounded-2xl border-2 border-dashed border-edge-bright">
          <span className="font-label tv-breathe text-2xl tracking-[0.3em] text-faint">
            ATTACHMENT {takeover.attachmentId?.slice(0, 8)}
          </span>
        </div>
      )}
    </div>
  );
}
