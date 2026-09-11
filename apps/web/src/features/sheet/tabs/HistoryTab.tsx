/**
 * History (FR3.8 revisions and rollback, FR3.1 re-import). The routes have
 * existed since the sheet did; this is the first screen that calls them
 * (docs/UX_AUDIT.md, "built server-side, no UI entry point").
 *
 * Two rules the server already keeps, said here so the screen agrees with
 * it: a rollback is a NEW revision (history is append-only, so going back
 * loses nothing), and a re-import shows its diff first and applies only on a
 * second, explicit click — drafts-then-approve, like everything else that
 * changes what the table plays with.
 */
import { useRef, useState } from 'react';
import { ErrorNote } from '../../gm/ui.js';
import ConfirmButton from '../../grid/gm/ConfirmButton.js';
import {
  canEditCharacter,
  useReimport,
  useRevision,
  useRevisions,
  useRollback,
  type ReimportResult,
  type RevisionSummary,
  type SheetDiffEntry,
} from '../api.js';
import type { TabProps } from './shared.js';

/** Rows the diff table shows before it says "+N more". */
export const DIFF_ROWS = 120;

/** Newest first: the revision the GM wants is almost always a recent one. */
export function newestFirst(revisions: readonly RevisionSummary[]): RevisionSummary[] {
  return [...revisions].sort((a, b) => b.seq - a.seq);
}

/** `2076-06-12 21:04` from an ISO stamp; the stamp itself if it will not parse. */
export function formatWhen(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().slice(0, 16).replace('T', ' ');
}

/**
 * Who made it, if the server said so in words. `createdBy` is a user id today
 * (`services/characters.ts`), and a UUID in a history row is noise the reader
 * cannot act on — so an id is dropped, and a name, when one arrives, is shown.
 */
export function formatWho(createdBy: string | null | undefined): string {
  if (!createdBy) return '';
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(createdBy)
    ? ''
    : createdBy;
}

/** One line per revision: `r12 · chummer re-import · Whistler · 2076-06-12 21:04`. */
export function describeRevision(r: RevisionSummary): string {
  return [`r${r.seq}`, r.cause, formatWho(r.createdBy), formatWhen(r.createdAt)]
    .filter((x) => x.length > 0)
    .join(' · ');
}

/** A value as the diff table prints it: short, and never `[object Object]`. */
export function showValue(v: unknown): string {
  if (v === undefined) return '—';
  if (v === null) return 'null';
  const s = typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : JSON.stringify(v);
  return s.length > 60 ? `${s.slice(0, 57)}…` : s;
}

/**
 * What the Chummer import had to say for itself — assumptions and skips —
 * whatever the report's shape. A warning the GM cannot see is one they act on
 * by accident.
 */
export function reportLines(report: unknown): string[] {
  if (!report || typeof report !== 'object') return [];
  const out: string[] = [];
  for (const [key, value] of Object.entries(report as Record<string, unknown>)) {
    if (!Array.isArray(value)) continue;
    for (const item of value) {
      out.push(`${key}: ${typeof item === 'string' ? item : JSON.stringify(item)}`);
    }
  }
  return out;
}

/** Field · now · after. Added rows have no "now", removed rows no "after". */
export function DiffTable({ diff, emptyText }: { diff: readonly SheetDiffEntry[]; emptyText: string }) {
  if (diff.length === 0) return <p className="mono-label text-faint">{emptyText}</p>;
  const shown = diff.slice(0, DIFF_ROWS);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs" data-testid="sheet-diff">
        <thead>
          <tr className="mono-label text-faint">
            <th className="text-left font-normal">field</th>
            <th className="text-left font-normal">now</th>
            <th className="text-left font-normal">after</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((d) => (
            <tr key={d.path} data-op={d.op} className="border-t border-edge/60 align-top">
              <td className="py-1 pr-2 font-mono text-dim">{d.path}</td>
              <td className={`py-1 pr-2 ${d.op === 'added' ? 'text-faint' : 'text-ink'}`}>{showValue(d.from)}</td>
              <td
                className={`py-1 ${
                  d.op === 'removed' ? 'text-danger' : d.op === 'added' ? 'text-ok' : 'text-cyan'
                }`}
              >
                {showValue(d.to)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {diff.length > DIFF_ROWS && (
        <p className="mono-label mt-1 text-faint">+{diff.length - DIFF_ROWS} more</p>
      )}
    </div>
  );
}

export function HistoryPanel({ characterId, canEdit }: { characterId: string; canEdit: boolean }) {
  const revisions = useRevisions(characterId);
  const [picked, setPicked] = useState<number | null>(null);
  const detail = useRevision(characterId, picked);
  const rollback = useRollback(characterId);
  const list = newestFirst(revisions.data ?? []);
  const current = list[0]?.seq;

  return (
    <section className="panel p-4" data-testid="sheet-history">
      <div className="flex flex-wrap items-baseline gap-2">
        <h2 className="mono-label text-dim">Revisions</h2>
        <span className="mono-label text-faint">
          {list.length} kept · every save, every import, every roll-back
        </span>
      </div>

      {revisions.isPending && <p className="mt-2 text-sm text-dim">Loading history…</p>}
      {revisions.isError && <p className="mt-2 text-sm text-warn">History unavailable.</p>}

      {list.length > 0 && (
        <ol className="mt-2 divide-y divide-edge/60" data-testid="revision-list">
          {list.map((r) => (
            <li key={r.seq} className="flex flex-wrap items-center gap-2 py-1.5" data-seq={r.seq}>
              <button
                type="button"
                className={`chip cursor-pointer ${
                  picked === r.seq ? 'border-cyan text-cyan' : 'text-dim hover:text-ink'
                }`}
                aria-pressed={picked === r.seq}
                onClick={() => setPicked(picked === r.seq ? null : r.seq)}
                title="Show what rolling back to this revision would change"
              >
                r{r.seq}
              </button>
              <span className="text-sm text-ink">{r.cause}</span>
              <span className="mono-label text-faint">
                {[formatWho(r.createdBy), formatWhen(r.createdAt)].filter((x) => x.length > 0).join(' · ')}
              </span>
              {r.seq === current && <span className="chip border-ok/40 text-ok">current</span>}
            </li>
          ))}
        </ol>
      )}

      {picked !== null && (
        <div className="mt-3 rounded-md border border-edge bg-deck p-3" data-testid="revision-detail">
          <div className="flex flex-wrap items-center gap-2">
            <span className="mono-label text-cyan">r{picked}</span>
            <span className="mono-label text-faint">what rolling back would change</span>
            {canEdit && picked !== current && (
              <ConfirmButton
                className="btn ml-auto px-2.5 py-1"
                label={`roll back to r${picked}`}
                confirmLabel={`roll back to r${picked}?`}
                disabled={rollback.isPending}
                onConfirm={() => rollback.mutate(picked, { onSuccess: () => setPicked(null) })}
                testId="rollback"
                title="Restores that sheet as a new revision — nothing is deleted"
              />
            )}
          </div>
          {detail.isPending && <p className="mt-2 text-sm text-dim">Comparing…</p>}
          {detail.data && (
            <div className="mt-2">
              <DiffTable diff={detail.data.diff} emptyText="identical to the current sheet" />
            </div>
          )}
          <ErrorNote error={detail.error ?? rollback.error} />
        </div>
      )}

      <p className="mono-label mt-3 text-faint">a roll-back is a new revision — history only grows</p>
    </section>
  );
}

export function ReimportPanel({ characterId, canEdit }: { characterId: string; canEdit: boolean }) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const preview = useReimport(characterId);
  const apply = useReimport(characterId);
  const [file, setFile] = useState<File | null>(null);
  const [pending, setPending] = useState<ReimportResult | null>(null);
  const [done, setDone] = useState<ReimportResult | null>(null);

  const choose = (f: File) => {
    setFile(f);
    setDone(null);
    setPending(null);
    preview.mutate({ file: f, confirm: false }, { onSuccess: setPending });
  };
  const confirm = () => {
    if (!file) return;
    apply.mutate(
      { file, confirm: true },
      {
        onSuccess: (r) => {
          setDone(r);
          setPending(null);
          setFile(null);
          if (fileRef.current) fileRef.current.value = '';
        },
      },
    );
  };
  const lines = pending ? reportLines(pending.report) : [];

  return (
    <section className="panel mt-3 p-4" data-testid="sheet-reimport">
      <div className="flex flex-wrap items-baseline gap-2">
        <h2 className="mono-label text-dim">Re-import from Chummer</h2>
        <span className="mono-label text-faint">the diff first; nothing changes until you apply it</span>
      </div>
      {!canEdit ? (
        <p className="mt-2 text-sm text-dim">Only the sheet's owner or the GM can re-import it.</p>
      ) : (
        <>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="btn px-3 py-1.5"
              onClick={() => fileRef.current?.click()}
              disabled={preview.isPending || apply.isPending}
              data-testid="reimport-choose"
            >
              {preview.isPending ? 'reading…' : 'choose a .chum5'}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".chum5,.xml,text/xml,application/xml"
              className="hidden"
              aria-label="Chummer5a character file"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) choose(f);
              }}
            />
            {file && <span className="mono-label text-faint">{file.name}</span>}
          </div>
          <p className="mono-label mt-1 text-faint">
            manual overrides survive a re-import — they are the table's decisions, not Chummer's
          </p>
          <ErrorNote error={preview.error ?? apply.error} />

          {pending && (
            <div className="mt-3 rounded-md border border-edge bg-deck p-3" data-testid="reimport-preview">
              <div className="flex flex-wrap items-center gap-2">
                <span className="mono-label text-cyan">
                  {pending.diff.length} change{pending.diff.length === 1 ? '' : 's'}
                </span>
                <span className="mono-label text-faint">against the sheet as it is now</span>
                <ConfirmButton
                  className="btn ml-auto px-3 py-1.5"
                  label="apply re-import"
                  confirmLabel="apply — as a new revision?"
                  onConfirm={confirm}
                  disabled={apply.isPending}
                  testId="reimport-apply"
                />
              </div>
              {lines.length > 0 && (
                <ul className="mt-2 space-y-0.5 text-xs text-warn" data-testid="reimport-report">
                  {lines.map((l, i) => (
                    <li key={i}>{l}</li>
                  ))}
                </ul>
              )}
              <div className="mt-2">
                <DiffTable diff={pending.diff} emptyText="the file matches the sheet — nothing to apply" />
              </div>
            </div>
          )}

          {done && (
            <p className="mt-2 text-sm text-ok" data-testid="reimport-done">
              Re-imported — {done.diff.length} change{done.diff.length === 1 ? '' : 's'}
              {typeof done.revision === 'number' ? `, kept as revision r${done.revision}` : ''}.
            </p>
          )}
        </>
      )}
    </section>
  );
}

export default function HistoryTab({ character }: TabProps) {
  const canEdit = canEditCharacter(character);
  return (
    <div className="p-3">
      <HistoryPanel characterId={character.id} canEdit={canEdit} />
      <ReimportPanel characterId={character.id} canEdit={canEdit} />
    </div>
  );
}
