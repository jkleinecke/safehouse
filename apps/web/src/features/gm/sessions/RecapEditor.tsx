/**
 * Recap editor + Discord publish (FR6.3). The session log is already in the
 * live buffer, so "draft from log" assembles the headline events into a
 * Markdown skeleton the GM edits. Publishing is an explicit, confirmed GM
 * action — the webhook is the only outbound traffic in the whole system.
 */
import { useEffect, useMemo, useState } from 'react';
import { useLiveStore } from '../../../live/store.js';
import { ErrorNote, SectionTitle } from '../ui.js';
import { usePublishRecap, useUpdateSession, type GameSession } from './api.js';
import { headlineEvents, recapSkeleton } from './recap.js';

export interface RecapEditorProps {
  campaignId: string;
  session: GameSession;
  /** Sixth World date for the header line (FR5.7). */
  ingameDate?: string;
  /** Whether the campaign has a webhook configured — publish needs one. */
  webhookConfigured?: boolean;
}

export default function RecapEditor({
  campaignId,
  session,
  ingameDate,
  webhookConfigured,
}: RecapEditorProps) {
  const events = useLiveStore((s) => s.events);
  const update = useUpdateSession(campaignId);
  const publish = usePublishRecap(campaignId);

  const [text, setText] = useState(session.recapMd ?? '');
  const [prep, setPrep] = useState(session.prepNotesMd ?? '');
  const [showPrep, setShowPrep] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  useEffect(() => {
    if (loadedFor !== session.id) {
      setText(session.recapMd ?? '');
      setPrep(session.prepNotesMd ?? '');
      setConfirming(false);
      setLoadedFor(session.id);
    }
  }, [session, loadedFor]);

  const headlines = useMemo(() => headlineEvents(events), [events]);

  return (
    <div className="panel p-4">
      <div className="flex flex-wrap items-center gap-2">
        <SectionTitle hint="players' only window between sessions">Recap</SectionTitle>
        <span className="chip text-faint">{session.date}</span>
        <button
          className="btn ml-auto px-2.5 py-1"
          onClick={() =>
            setText(
              recapSkeleton({
                date: session.date,
                ...(ingameDate ? { ingameDate } : {}),
                attendance: session.attendance,
                headlines,
              }),
            )
          }
          title="Assemble headline events from the session log"
        >
          draft from log
        </button>
      </div>

      {headlines.length > 0 && (
        <div className="mt-3">
          <span className="mono-label">Headlines in the log ({headlines.length})</span>
          <ul className="mt-1 max-h-32 space-y-0.5 overflow-y-auto text-xs text-dim">
            {headlines.map((h) => (
              <li key={h.eventId}>
                <span className="mono-label mr-2 text-faint">{h.kind}</span>
                {h.text}
              </li>
            ))}
          </ul>
        </div>
      )}

      <textarea
        className="mt-3 h-64 w-full resize-y rounded-md border border-edge bg-deck px-2.5 py-2 text-sm text-ink placeholder:text-faint focus:border-cyan focus:outline-none"
        value={text}
        placeholder="What the team will remember about tonight…"
        onChange={(e) => setText(e.target.value)}
      />

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          className="btn px-3 py-1.5"
          disabled={update.isPending}
          onClick={() => update.mutate({ id: session.id, patch: { recapMd: text } })}
        >
          {update.isPending ? 'saving…' : 'save recap'}
        </button>

        {confirming ? (
          <>
            <span className="mono-label text-warn">post this to Discord?</span>
            <button
              className="btn btn-accent px-3 py-1.5"
              disabled={publish.isPending}
              onClick={() =>
                update.mutate(
                  { id: session.id, patch: { recapMd: text } },
                  {
                    onSuccess: () =>
                      publish.mutate(session.id, { onSuccess: () => setConfirming(false) }),
                  },
                )
              }
            >
              {publish.isPending ? 'posting…' : 'yes, publish'}
            </button>
            <button className="btn px-3 py-1.5" onClick={() => setConfirming(false)}>
              cancel
            </button>
          </>
        ) : (
          <button
            className="btn px-3 py-1.5 text-cyan"
            disabled={!text.trim()}
            onClick={() => setConfirming(true)}
            title={
              webhookConfigured === false
                ? 'Set the Discord webhook URL in campaign settings first'
                : 'Post the recap to the table Discord (FR6.3)'
            }
          >
            publish to Discord
          </button>
        )}

        {publish.isSuccess && <span className="mono-label text-ok">published</span>}
        {webhookConfigured === false && (
          <span className="mono-label text-faint">no webhook configured</span>
        )}
      </div>
      <ErrorNote error={update.error ?? publish.error} />

      <div className="mt-4 border-t border-edge pt-3">
        <button
          className="mono-label text-dim hover:text-cyan"
          onClick={() => setShowPrep((s) => !s)}
        >
          {showPrep ? '▾' : '▸'} GM prep notes (private)
        </button>
        {showPrep && (
          <>
            <textarea
              className="mt-2 h-40 w-full resize-y rounded-md border border-edge bg-deck px-2.5 py-2 text-sm text-ink focus:border-cyan focus:outline-none"
              value={prep}
              placeholder="Never leaves this screen."
              onChange={(e) => setPrep(e.target.value)}
            />
            <button
              className="btn mt-2 px-3 py-1.5"
              disabled={update.isPending}
              onClick={() => update.mutate({ id: session.id, patch: { prepNotesMd: prep } })}
            >
              save prep notes
            </button>
          </>
        )}
      </div>
    </div>
  );
}
