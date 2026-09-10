/**
 * Handouts (FR5.4): upload → attach to a page → stage privately → reveal live.
 *
 * The reveal is the load-bearing step. A staged handout is a `gm`-visibility
 * attachment, which is what `GET /files/:id` actually checks — revealing flips
 * that flag and *then* announces `handout.revealed`, so the TV takeover and the
 * players' log entry can never run ahead of the permission (Principle 4).
 *
 * A player sees only revealed handouts; the server never sends the rest.
 */
import { useRef, useState } from 'react';
import { ErrorNote } from '../gm/ui.js';
import {
  useAttachHandout,
  useDetachHandout,
  useHandouts,
  useRevealHandout,
  useUploadHandout,
  type CodexPage,
  type HandoutView,
} from './api.js';

export interface HandoutsPanelProps {
  campaignId: string;
  page: CodexPage;
  isGm: boolean;
}

function sizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isImage(mime: string): boolean {
  return mime.startsWith('image/');
}

function HandoutRow({
  handout,
  campaignId,
  pageId,
  isGm,
}: {
  handout: HandoutView;
  campaignId: string;
  pageId: string;
  isGm: boolean;
}) {
  const reveal = useRevealHandout(campaignId, pageId);
  const detach = useDetachHandout(campaignId, pageId);

  return (
    <li className="rounded-md border border-edge bg-deck p-2">
      <div className="flex items-center gap-2">
        <span className={`chip shrink-0 ${handout.revealed ? 'border-ok/40 text-ok' : 'border-magenta-dim text-magenta'}`}>
          {handout.revealed ? 'live' : 'staged'}
        </span>
        <a
          className="min-w-0 flex-1 truncate text-xs text-dim hover:text-cyan"
          href={handout.url}
          target="_blank"
          rel="noreferrer"
        >
          {handout.label ?? handout.mime}
        </a>
        <span className="mono-label shrink-0 text-faint">{sizeLabel(handout.size)}</span>
      </div>
      {isImage(handout.mime) && (
        <img
          src={handout.url}
          alt={handout.label ?? 'handout'}
          className="mt-2 max-h-32 w-full rounded border border-edge object-contain"
        />
      )}
      {isGm && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {!handout.revealed ? (
            <button
              className="btn btn-accent px-2.5 py-1"
              disabled={reveal.isPending}
              onClick={() => reveal.mutate({ attachmentId: handout.attachmentId })}
            >
              {reveal.isPending ? 'revealing…' : 'reveal to table'}
            </button>
          ) : (
            <button
              className="btn px-2.5 py-1"
              disabled={reveal.isPending}
              onClick={() =>
                reveal.mutate({ attachmentId: handout.attachmentId, visibility: 'gm' })
              }
            >
              re-hide
            </button>
          )}
          <button
            className="btn px-2.5 py-1 text-danger"
            disabled={detach.isPending}
            onClick={() => detach.mutate(handout.attachmentId)}
          >
            unpin
          </button>
        </div>
      )}
      <ErrorNote error={reveal.error ?? detach.error} />
    </li>
  );
}

export default function HandoutsPanel({ campaignId, page, isGm }: HandoutsPanelProps) {
  const staged = useHandouts(campaignId);
  const upload = useUploadHandout(campaignId);
  const attach = useAttachHandout(campaignId, page.id);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [label, setLabel] = useState('');

  const pinnedIds = new Set(page.handouts.map((h) => h.attachmentId));
  const unpinned = (staged.data ?? []).filter((h) => !pinnedIds.has(h.attachmentId));

  return (
    <section className="panel p-3">
      <div className="mono-label text-cyan">Handouts</div>

      {page.handouts.length === 0 && (
        <p className="mt-2 text-xs text-faint">Nothing pinned to this page.</p>
      )}
      <ul className="mt-2 space-y-2">
        {page.handouts.map((h) => (
          <HandoutRow
            key={h.attachmentId}
            handout={h}
            campaignId={campaignId}
            pageId={page.id}
            isGm={isGm}
          />
        ))}
      </ul>

      {isGm && (
        <div className="mt-3 border-t border-edge pt-3">
          <label className="block">
            <span className="mono-label block">Add a handout</span>
            <input
              ref={fileRef}
              type="file"
              accept="image/*,application/pdf"
              className="mt-1 w-full text-xs text-dim file:mr-2 file:rounded file:border file:border-edge-bright file:bg-raised file:px-2 file:py-1 file:font-label file:text-xs file:text-ink"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                upload.mutate(file, {
                  onSuccess: (att) => {
                    attach.mutate({
                      attachmentId: att.id,
                      ...(label.trim() ? { label: label.trim() } : { label: file.name }),
                    });
                    setLabel('');
                    if (fileRef.current) fileRef.current.value = '';
                  },
                });
              }}
            />
          </label>
          <input
            className="mt-2 w-full rounded-md border border-edge bg-deck px-2.5 py-1.5 text-xs text-ink placeholder:text-faint focus:border-cyan focus:outline-none"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="label (optional)"
            aria-label="Handout label"
          />
          <p className="mono-label mt-1.5 text-faint">
            Uploaded staged — private until you reveal it.
          </p>
          <ErrorNote error={upload.error ?? attach.error} />

          {unpinned.length > 0 && (
            <div className="mt-3">
              <div className="mono-label text-faint">Already staged in this campaign</div>
              <ul className="mt-1 flex flex-wrap gap-1.5">
                {unpinned.slice(0, 8).map((h) => (
                  <li key={h.attachmentId}>
                    <button
                      type="button"
                      className="chip cursor-pointer text-dim hover:border-cyan hover:text-cyan"
                      disabled={attach.isPending}
                      onClick={() => attach.mutate({ attachmentId: h.attachmentId })}
                    >
                      {h.label ?? h.mime} +
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
