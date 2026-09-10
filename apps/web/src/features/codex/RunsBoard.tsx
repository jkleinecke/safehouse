/**
 * `/c/:campaignId/gm/runs` — the runs board (FR5.5).
 *
 * One card per job: Johnson page, hook, objectives, agreed payout, the
 * opposition it links to, the awards it posted, and the after-action recap.
 *
 * Awards post as **pending** ledger entries (FR3.6): the settle-up beat at the
 * table approves them, so a mistyped payout never silently moves a balance.
 * Players get a much thinner list from the server — finished runs and their
 * recaps only — which is why this screen never has to hide anything itself.
 */
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useCampaign } from '../../api/campaigns.js';
import { getSession } from '../../api/session.js';
import { ErrorNote, SectionTitle } from '../gm/ui.js';
import Markdown from './Markdown.js';
import {
  useAwardRun,
  useCreateRun,
  useRoster,
  useRuns,
  useUpdateRun,
  type RunRecord,
} from './api.js';
import { nextObjectiveState, payoutSummary, runProgress, type Objective } from './lib.js';
import { useCodexLive } from './live.js';

const inputClass =
  'w-full rounded-md border border-edge bg-deck px-2.5 py-1.5 text-sm text-ink ' +
  'placeholder:text-faint focus:border-cyan focus:outline-none';

const STATES = ['prep', 'active', 'done', 'failed'] as const;

function stateTone(state: string): string {
  if (state === 'done') return 'border-ok/40 text-ok';
  if (state === 'failed') return 'border-danger/40 text-danger';
  if (state === 'active') return 'border-cyan-dim text-cyan';
  return 'text-faint';
}

function ObjectiveList({
  run,
  campaignId,
  isGm,
}: {
  run: RunRecord;
  campaignId: string;
  isGm: boolean;
}) {
  const update = useUpdateRun(campaignId);
  const [draft, setDraft] = useState('');
  const objectives: Objective[] = run.objectives ?? [];
  const progress = runProgress(objectives);

  const save = (next: Objective[]) => update.mutate({ runId: run.id, patch: { objectives: next } });

  return (
    <div className="mt-3">
      <div className="flex items-center gap-2">
        <div className="mono-label text-cyan">Objectives</div>
        {progress.total > 0 && (
          <span className="mono-label text-faint">
            {progress.done}/{progress.total} done
            {progress.failed > 0 ? ` · ${progress.failed} blown` : ''}
          </span>
        )}
      </div>
      {progress.total > 0 && (
        <div
          className="mt-1 h-1 w-full overflow-hidden rounded-full bg-deck"
          role="progressbar"
          aria-valuenow={progress.pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Objectives settled"
        >
          <div className="h-full bg-cyan-dim" style={{ width: `${progress.pct}%` }} />
        </div>
      )}
      <ul className="mt-2 space-y-1">
        {objectives.map((o) => (
          <li key={o.id} className="flex items-center gap-2">
            <button
              type="button"
              className={`chip shrink-0 ${
                o.state === 'done'
                  ? 'border-ok/40 text-ok'
                  : o.state === 'failed'
                    ? 'border-danger/40 text-danger'
                    : 'text-faint'
              } ${isGm ? 'cursor-pointer' : ''}`}
              disabled={!isGm || update.isPending}
              aria-label={`${o.text}: ${o.state}`}
              onClick={() =>
                save(
                  objectives.map((x) =>
                    x.id === o.id ? { ...x, state: nextObjectiveState(x.state) } : x,
                  ),
                )
              }
            >
              {o.state}
            </button>
            <span className={`min-w-0 flex-1 text-sm ${o.state === 'done' ? 'text-faint line-through' : 'text-dim'}`}>
              {o.text}
            </span>
            {isGm && (
              <button
                type="button"
                className="mono-label shrink-0 text-faint hover:text-danger"
                onClick={() => save(objectives.filter((x) => x.id !== o.id))}
                aria-label={`Remove objective ${o.text}`}
              >
                ✕
              </button>
            )}
          </li>
        ))}
        {objectives.length === 0 && <li className="text-xs text-faint">No objectives set.</li>}
      </ul>
      {isGm && (
        <form
          className="mt-2 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const text = draft.trim();
            if (!text) return;
            save([...objectives, { id: `o${Date.now()}`, text, state: 'open' }]);
            setDraft('');
          }}
        >
          <input
            className={inputClass}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="add an objective"
            aria-label={`Add an objective to ${run.title}`}
          />
          <button className="btn shrink-0 px-3 py-1.5" type="submit" disabled={update.isPending}>
            add
          </button>
        </form>
      )}
      <ErrorNote error={update.error} />
    </div>
  );
}

function AwardsPanel({ run, campaignId }: { run: RunRecord; campaignId: string }) {
  const award = useAwardRun(campaignId);
  const characters = useRoster(campaignId).data ?? [];
  const [karma, setKarma] = useState('');
  const [nuyen, setNuyen] = useState('');
  const [picked, setPicked] = useState<string[]>([]);

  const toggle = (id: string) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const totals = run.awards;

  return (
    <div className="mt-3 border-t border-edge pt-3">
      <div className="mono-label text-cyan">Awards → ledgers (pending)</div>
      {totals && (totals.karma !== 0 || totals.nuyen !== 0) && (
        <p className="mono-label mt-1 text-faint">
          posted so far: {totals.karma} karma · {totals.nuyen.toLocaleString('en-US')}¥
        </p>
      )}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {characters.map((c) => (
          <button
            key={c.id}
            type="button"
            className={`chip cursor-pointer ${picked.includes(c.id) ? 'border-cyan text-cyan' : 'text-dim'}`}
            aria-pressed={picked.includes(c.id)}
            onClick={() => toggle(c.id)}
          >
            {c.name}
          </button>
        ))}
        {characters.length === 0 && <span className="text-xs text-faint">No characters yet.</span>}
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <input
          className={`${inputClass} w-28`}
          value={karma}
          onChange={(e) => setKarma(e.target.value)}
          placeholder="karma"
          inputMode="numeric"
          aria-label="Karma each"
        />
        <input
          className={`${inputClass} w-32`}
          value={nuyen}
          onChange={(e) => setNuyen(e.target.value)}
          placeholder="nuyen"
          inputMode="numeric"
          aria-label="Nuyen each"
        />
        <button
          className="btn btn-accent px-3 py-1.5"
          disabled={award.isPending || picked.length === 0}
          onClick={() => {
            const k = Number.parseInt(karma, 10);
            const n = Number.parseInt(nuyen, 10);
            const entries = picked.map((characterId) => ({
              characterId,
              ...(Number.isFinite(k) && k !== 0 ? { karma: k } : {}),
              ...(Number.isFinite(n) && n !== 0 ? { nuyen: n } : {}),
            }));
            award.mutate(
              { runId: run.id, body: { reason: `Run: ${run.title}`, entries } },
              {
                onSuccess: () => {
                  setKarma('');
                  setNuyen('');
                  setPicked([]);
                },
              },
            );
          }}
        >
          {award.isPending ? 'posting…' : 'post as pending'}
        </button>
      </div>
      <p className="mono-label mt-1.5 text-faint">
        Lands unapproved — settle it at the table.
      </p>
      <ErrorNote error={award.error} />
    </div>
  );
}

function RunCard({ run, campaignId, isGm }: { run: RunRecord; campaignId: string; isGm: boolean }) {
  const update = useUpdateRun(campaignId);
  const [recap, setRecap] = useState(run.recapMd ?? '');
  const [editingRecap, setEditingRecap] = useState(false);

  return (
    <li className="panel p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">{run.title}</h3>
        {isGm ? (
          <select
            className={`${inputClass} w-auto`}
            value={run.state}
            onChange={(e) => update.mutate({ runId: run.id, patch: { state: e.target.value } })}
            aria-label={`State of ${run.title}`}
          >
            {STATES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        ) : (
          <span className={`chip ${stateTone(run.state)}`}>{run.state}</span>
        )}
        {run.ingameDate && <span className="mono-label text-faint">{run.ingameDate}</span>}
      </div>

      {run.payout && payoutSummary(run.payout) && (
        <p className="mono-label mt-1 text-warn">payout {payoutSummary(run.payout)}</p>
      )}

      {run.hook && <p className="mt-2 text-sm text-dim">{run.hook}</p>}

      {run.johnsonPageId && (
        <Link
          to={`/c/${campaignId}/codex/${run.johnsonPageId}`}
          className="mono-label mt-2 inline-block text-cyan hover:underline"
        >
          the Johnson →
        </Link>
      )}

      {isGm && <ObjectiveList run={run} campaignId={campaignId} isGm={isGm} />}

      {(run.opposition?.length ?? 0) > 0 && (
        <div className="mt-3">
          <div className="mono-label text-cyan">Opposition</div>
          <ul className="mt-1 flex flex-wrap gap-1.5">
            {(run.opposition ?? []).map((o, i) => (
              <li key={i} className="chip text-dim">
                {o.label ?? o.encounterId?.slice(0, 8) ?? 'fight'}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-3">
        <div className="flex items-center gap-2">
          <div className="mono-label text-cyan">After-action recap</div>
          {isGm && (
            <button
              className="mono-label text-faint hover:text-cyan"
              onClick={() => setEditingRecap((v) => !v)}
            >
              {editingRecap ? 'cancel' : 'edit'}
            </button>
          )}
        </div>
        {editingRecap ? (
          <div className="mt-1.5">
            <textarea
              className={`${inputClass} h-40 resize-y font-label text-xs`}
              value={recap}
              onChange={(e) => setRecap(e.target.value)}
              aria-label={`Recap for ${run.title}`}
            />
            <button
              className="btn btn-accent mt-2 px-3 py-1.5"
              disabled={update.isPending}
              onClick={() =>
                update.mutate(
                  { runId: run.id, patch: { recapMd: recap } },
                  { onSuccess: () => setEditingRecap(false) },
                )
              }
            >
              {update.isPending ? 'saving…' : 'save recap'}
            </button>
          </div>
        ) : run.recapMd ? (
          <Markdown md={run.recapMd} campaignId={campaignId} />
        ) : (
          <p className="mt-1 text-xs text-faint">Not written yet.</p>
        )}
      </div>

      {isGm && <AwardsPanel run={run} campaignId={campaignId} />}
      <ErrorNote error={update.error} />
    </li>
  );
}

export default function RunsBoard() {
  const { campaignId } = useParams<{ campaignId: string }>();
  const session = getSession();
  const isGm = session?.role === 'gm';
  const runs = useRuns(campaignId);
  const create = useCreateRun(campaignId ?? '');
  const { data: campaign } = useCampaign(campaignId);
  const [title, setTitle] = useState('');
  // Award approvals land as `ledger.changed`; the board follows them (§11).
  useCodexLive(campaignId);

  if (!campaignId) return null;
  const rows = runs.data ?? [];

  return (
    <div className="p-6">
      <SectionTitle hint="Johnson, objectives, payout, awards, recap">Runs</SectionTitle>

      {isGm && (
        <form
          className="mt-3 flex max-w-lg gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const t = title.trim();
            if (!t) return;
            create.mutate(
              {
                title: t,
                state: 'prep',
                ...(campaign?.ingameDate ? { ingameDate: campaign.ingameDate } : {}),
              },
              { onSuccess: () => setTitle('') },
            );
          }}
        >
          <input
            className={inputClass}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="new run — “Extraction at Dock 9”"
            aria-label="New run title"
          />
          <button className="btn btn-accent shrink-0 px-3 py-1.5" type="submit" disabled={create.isPending}>
            {create.isPending ? '…' : 'add run'}
          </button>
        </form>
      )}
      <ErrorNote error={create.error ?? runs.error} />

      {rows.length === 0 && !runs.isLoading && (
        <p className="mt-4 text-sm text-dim">
          {isGm ? 'No runs yet — the board fills as jobs come in.' : 'No finished runs to read yet.'}
        </p>
      )}

      <ul className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
        {rows.map((run) => (
          <RunCard key={run.id} run={run} campaignId={campaignId} isGm={isGm} />
        ))}
      </ul>
    </div>
  );
}
