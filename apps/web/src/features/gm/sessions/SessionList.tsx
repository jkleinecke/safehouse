/**
 * Session records + live mode (FR6.1/6.2): create a session for tonight,
 * "start session" puts the campaign in live mode (presence, log recording,
 * encounter launching), "end session" closes the log and opens the
 * award/recap flow. Attendance is hand-editable from the campaign's roster.
 */
import { useState } from 'react';
import { useCharacters } from '../../grid/api.js';
import { isoToday } from '../common.js';
import { ErrorNote, Field, inputClass, SectionTitle, Spinner } from '../ui.js';
import {
  useCreateSession,
  useEndSession,
  useSessions,
  useStartSession,
  useUpdateSession,
  type GameSession,
} from './api.js';
import { toggleAttendee } from './recap.js';

function StateChip({ state }: { state: GameSession['state'] }) {
  const tone =
    state === 'live'
      ? 'border-ok/50 text-ok'
      : state === 'done'
        ? 'border-edge text-faint'
        : 'border-cyan-dim text-cyan';
  return <span className={`chip ${tone}`}>{state}</span>;
}

export interface SessionListProps {
  campaignId: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export default function SessionList({ campaignId, selectedId, onSelect }: SessionListProps) {
  const sessions = useSessions(campaignId);
  const characters = useCharacters(campaignId);
  const create = useCreateSession(campaignId);
  const update = useUpdateSession(campaignId);
  const start = useStartSession(campaignId);
  const end = useEndSession(campaignId);
  const [date, setDate] = useState(isoToday());

  const rosterNames = (characters.data ?? []).map((c) => c.alias ?? c.name ?? c.id);

  return (
    <div className="panel p-4">
      <SectionTitle>Sessions</SectionTitle>

      <div className="mt-3 flex flex-wrap items-end gap-3">
        <Field label="Date (real world)">
          <input
            className={`${inputClass} w-40`}
            value={date}
            onChange={(e) => setDate(e.target.value)}
            placeholder="2026-08-27"
          />
        </Field>
        <button
          className="btn btn-accent px-3 py-1.5"
          disabled={create.isPending}
          onClick={() => create.mutate({ date }, { onSuccess: (s) => onSelect(s.id) })}
        >
          {create.isPending ? 'creating…' : 'new session'}
        </button>
      </div>
      <ErrorNote error={create.error} />

      {sessions.isLoading && <div className="mt-3"><Spinner label="loading sessions" /></div>}
      <ErrorNote error={sessions.error} />
      {sessions.data && sessions.data.length === 0 && (
        <p className="mt-3 text-sm text-dim">No sessions recorded yet.</p>
      )}

      <ul className="mt-3 space-y-2">
        {(sessions.data ?? []).map((session) => {
          const selected = session.id === selectedId;
          return (
            <li
              key={session.id}
              className={`rounded-md border p-3 ${
                selected ? 'border-cyan-dim bg-deck' : 'border-edge bg-deck/60'
              }`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <button
                  className="min-w-0 flex-1 truncate text-left text-sm font-semibold"
                  onClick={() => onSelect(session.id)}
                >
                  {session.date}
                </button>
                <StateChip state={session.state} />
                <span className="mono-label text-faint">
                  {session.attendance.length} present
                </span>
                {session.state !== 'live' ? (
                  <button
                    className="btn px-2.5 py-1"
                    disabled={start.isPending || session.state === 'done'}
                    onClick={() => start.mutate(session.id)}
                    title="Live mode: presence, log recording, starting fights"
                  >
                    start session
                  </button>
                ) : (
                  <button
                    className="btn px-2.5 py-1 text-warn"
                    disabled={end.isPending}
                    onClick={() => end.mutate(session.id)}
                    title="Closes the log and opens the award/recap flow"
                  >
                    end session
                  </button>
                )}
              </div>

              {selected && (
                <div className="mt-3">
                  <span className="mono-label">Attendance</span>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {rosterNames.map((name) => {
                      const on = session.attendance.includes(name);
                      return (
                        <button
                          key={name}
                          className={`chip cursor-pointer ${on ? 'border-ok/50 text-ok' : 'text-dim hover:text-ink'}`}
                          onClick={() =>
                            update.mutate({
                              id: session.id,
                              patch: { attendance: toggleAttendee(session.attendance, name) },
                            })
                          }
                        >
                          {on ? '✓' : '○'} {name}
                        </button>
                      );
                    })}
                    {rosterNames.length === 0 && (
                      <span className="text-sm text-faint">No characters in the campaign yet.</span>
                    )}
                  </div>
                  {session.attendance.filter((n) => !rosterNames.includes(n)).length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {session.attendance
                        .filter((n) => !rosterNames.includes(n))
                        .map((name) => (
                          <span key={name} className="chip text-faint">
                            {name}
                          </span>
                        ))}
                    </div>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <ErrorNote error={start.error ?? end.error ?? update.error} />
    </div>
  );
}
