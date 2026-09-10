/**
 * `/c/:campaignId/calendar` — the in-game calendar (FR5.7).
 *
 * A merge, not a table: GM-pinned beats, sessions, dated runs, and lifestyle
 * rent due-dates derived from the sheets. The server merges and filters it —
 * a player sees shared beats and *their own* rent, never the GM's plans or
 * another runner's bills — so this screen only has to read well.
 *
 * The in-game clock (`campaigns.ingame_date`) is the anchor: everything is
 * phrased against it, because "in 3 days" is what the table actually asks.
 */
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { Visibility } from '@safehouse/contracts';
import { useCampaign } from '../../api/campaigns.js';
import { getSession } from '../../api/session.js';
import { ErrorNote, SectionTitle } from '../gm/ui.js';
import {
  useCalendar,
  useCreateCalendarEvent,
  useDeleteCalendarEvent,
} from './api.js';
import { useCodexLive } from './live.js';
import {
  groupByDate,
  isUpcoming,
  relativeToClock,
  visibilityLabel,
  visibilityTone,
  type CalendarEntry,
} from './lib.js';

const inputClass =
  'w-full rounded-md border border-edge bg-deck px-2.5 py-1.5 text-sm text-ink ' +
  'placeholder:text-faint focus:border-cyan focus:outline-none';

const KIND_ICON: Record<string, string> = {
  session: '◇',
  run: '◆',
  lifestyle: '¥',
  event: '·',
};

function EntryRow({
  entry,
  campaignId,
  isGm,
  onDelete,
}: {
  entry: CalendarEntry;
  campaignId: string;
  isGm: boolean;
  onDelete: (id: string) => void;
}) {
  const pageId = entry.links?.['pageId'];
  const runId = entry.links?.['runId'];
  // Only GM-pinned timeline events are deletable; derived rows belong to their
  // source (a session's date, a run's date, a sheet's lifestyle).
  const derived = entry.id.includes(':');

  return (
    <li className="flex flex-wrap items-start gap-2 py-2">
      <span className="mono-label w-5 shrink-0 text-center text-faint" aria-hidden>
        {KIND_ICON[entry.kind] ?? '·'}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-ink">{entry.title}</span>
          <span className={`chip ${visibilityTone(entry.visibility)}`}>
            {visibilityLabel(entry.visibility)}
          </span>
          {entry.dateKind === 'real' && <span className="mono-label text-faint">real-world</span>}
          {typeof entry.amount === 'number' && (
            <span className="mono-label text-warn">{entry.amount.toLocaleString('en-US')}¥</span>
          )}
        </div>
        {entry.body && <p className="mt-0.5 text-xs text-dim">{entry.body}</p>}
        <div className="mt-0.5 flex flex-wrap gap-2">
          {pageId && (
            <Link className="mono-label text-cyan hover:underline" to={`/c/${campaignId}/codex/${pageId}`}>
              codex →
            </Link>
          )}
          {runId && (
            <Link className="mono-label text-cyan hover:underline" to={`/c/${campaignId}/gm/runs`}>
              run →
            </Link>
          )}
        </div>
      </div>
      {isGm && !derived && (
        <button
          type="button"
          className="mono-label shrink-0 text-faint hover:text-danger"
          onClick={() => onDelete(entry.id)}
          aria-label={`Remove ${entry.title}`}
        >
          ✕
        </button>
      )}
    </li>
  );
}

export default function CalendarView() {
  const { campaignId } = useParams<{ campaignId: string }>();
  const session = getSession();
  const isGm = session?.role === 'gm';
  const calendar = useCalendar(campaignId);
  const { data: campaign } = useCampaign(campaignId);
  const create = useCreateCalendarEvent(campaignId ?? '');
  const remove = useDeleteCalendarEvent(campaignId ?? '');
  // `clock.advanced` moves every "in 3 days" on this screen (§11).
  useCodexLive(campaignId);

  const clock = calendar.data?.ingameDate ?? campaign?.ingameDate ?? null;
  const [date, setDate] = useState('');
  const [title, setTitle] = useState('');
  const [visibility, setVisibility] = useState<Visibility>('gm');
  const [upcomingOnly, setUpcomingOnly] = useState(false);

  if (!campaignId) return null;

  const all = calendar.data?.entries ?? [];
  const shown = upcomingOnly ? all.filter((e) => isUpcoming(e.date, clock)) : all;
  const days = groupByDate(shown);

  return (
    <div className="p-6">
      <SectionTitle hint="the Sixth World clock">Calendar</SectionTitle>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <span className="chip border-cyan-dim text-cyan">{clock ?? '2076-??-??'}</span>
        <span className="mono-label text-faint">in-game today</span>
        <button
          type="button"
          className={`chip cursor-pointer ${upcomingOnly ? 'border-cyan text-cyan' : 'text-dim'}`}
          aria-pressed={upcomingOnly}
          onClick={() => setUpcomingOnly((v) => !v)}
        >
          upcoming only
        </button>
      </div>

      {isGm && (
        <form
          className="mt-4 flex max-w-2xl flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const t = title.trim();
            const d = date.trim() || clock;
            if (!t || !d) return;
            create.mutate(
              { date: d, title: t, visibility },
              {
                onSuccess: () => {
                  setTitle('');
                  setDate('');
                },
              },
            );
          }}
        >
          <input
            className={`${inputClass} w-40`}
            value={date}
            onChange={(e) => setDate(e.target.value)}
            placeholder={clock ?? '2076-05-12'}
            aria-label="In-game date"
          />
          <input
            className={`${inputClass} min-w-48 flex-1`}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="pin a beat — “Johnson wants an answer”"
            aria-label="Event title"
          />
          <select
            className={`${inputClass} w-auto`}
            value={visibility}
            onChange={(e) => setVisibility(e.target.value as Visibility)}
            aria-label="Event visibility"
          >
            <option value="gm">GM only</option>
            <option value="public">shared</option>
          </select>
          <button className="btn btn-accent px-3 py-1.5" type="submit" disabled={create.isPending}>
            {create.isPending ? '…' : 'pin'}
          </button>
        </form>
      )}
      <ErrorNote error={create.error ?? remove.error ?? calendar.error} />

      {days.length === 0 && !calendar.isLoading && (
        <p className="mt-4 text-sm text-dim">Nothing on the calendar yet.</p>
      )}

      <div className="mt-4 max-w-2xl space-y-4">
        {days.map(({ date: day, entries }) => (
          <section key={day} className="panel p-3">
            <div className="flex items-baseline gap-2">
              <h2 className="font-label text-sm tracking-widest text-cyan">{day}</h2>
              <span className="mono-label text-faint">{relativeToClock(day, clock)}</span>
            </div>
            <ul className="mt-1 divide-y divide-edge/60">
              {entries.map((entry) => (
                <EntryRow
                  key={entry.id}
                  entry={entry}
                  campaignId={campaignId}
                  isGm={isGm}
                  onDelete={(id) => remove.mutate(id)}
                />
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
