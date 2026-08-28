/**
 * Drafts inbox (FR12.15, Principle 8): every AI generation lands here as an
 * `ai_generations` row the GM accepts, edits, or rejects — nothing ever
 * auto-applies. Spoiler-guard flags (FR12.19) ride on the row so a
 * player-facing draft never leaks GM-only facts by accident.
 */
import { useState } from 'react';
import { fmtLatency, fmtTokens } from '../common.js';
import { ErrorNote, SectionTitle, Spinner } from '../ui.js';
import {
  draftOutputText,
  spoilerFlagsOf,
  useAcceptDraft,
  useDrafts,
  useRejectDraft,
  type AiGeneration,
} from './api.js';

function targetLabel(target: unknown): string | null {
  if (typeof target === 'string') return target;
  if (typeof target === 'object' && target !== null) {
    const t = target as Record<string, unknown>;
    const kind = typeof t['type'] === 'string' ? t['type'] : typeof t['kind'] === 'string' ? t['kind'] : null;
    const id = typeof t['id'] === 'string' ? t['id'] : null;
    if (kind && id) return `${kind}:${id.slice(0, 8)}`;
    if (kind) return kind;
  }
  return null;
}

function DraftRow({ gen, campaignId }: { gen: AiGeneration; campaignId: string }) {
  const accept = useAcceptDraft(campaignId);
  const reject = useRejectDraft(campaignId);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(() => draftOutputText(gen));
  const flags = spoilerFlagsOf(gen);
  const target = targetLabel(gen.target);

  return (
    <li className="rounded-md border border-edge bg-deck p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="chip border-magenta-dim text-magenta">{gen.kind}</span>
        {target && <span className="chip text-dim">{target}</span>}
        {gen.model && <span className="chip text-faint">{gen.model}</span>}
        {gen.usage && (
          <span className="mono-label text-faint">
            {fmtTokens(gen.usage.totalTokens)} tok · {fmtLatency(gen.usage.latencyMs)}
          </span>
        )}
        {gen.createdAt && <span className="mono-label text-faint">{gen.createdAt.slice(0, 16).replace('T', ' ')}</span>}
      </div>

      {flags.length > 0 && (
        <div className="mt-2 rounded-md border border-warn/40 bg-warn/10 p-2">
          <div className="mono-label text-warn">spoiler guard — reveal or cut?</div>
          <ul className="mt-1 space-y-0.5 text-xs text-warn">
            {flags.map((f, i) => (
              <li key={i}>— {f}</li>
            ))}
          </ul>
        </div>
      )}

      {gen.prompt && (
        <p className="mono-label mt-2 truncate text-faint" title={gen.prompt}>
          prompt: {gen.prompt}
        </p>
      )}

      {editing ? (
        <textarea
          className="mt-2 h-48 w-full resize-y rounded-md border border-edge bg-panel px-2.5 py-1.5 font-label text-xs text-ink focus:border-cyan focus:outline-none"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      ) : (
        <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-md border border-edge bg-panel p-2.5 text-xs text-dim">
          {text || '(empty draft)'}
        </pre>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          className="btn btn-accent px-3 py-1.5"
          disabled={accept.isPending}
          onClick={() =>
            accept.mutate(editing ? { id: gen.id, output: text } : { id: gen.id })
          }
        >
          {accept.isPending ? 'applying…' : editing ? 'accept edited' : 'accept'}
        </button>
        <button className="btn px-3 py-1.5" onClick={() => setEditing((e) => !e)}>
          {editing ? 'cancel edit' : 'edit'}
        </button>
        <button
          className="btn px-3 py-1.5 text-danger"
          disabled={reject.isPending}
          onClick={() => reject.mutate(gen.id)}
        >
          reject
        </button>
      </div>
      <ErrorNote error={accept.error ?? reject.error} />
    </li>
  );
}

export interface DraftsInboxProps {
  campaignId: string;
}

export default function DraftsInbox({ campaignId }: DraftsInboxProps) {
  const drafts = useDrafts(campaignId);
  const rows = drafts.data ?? [];

  return (
    <div className="panel p-4">
      <div className="flex items-center gap-2">
        <SectionTitle hint="nothing the AI writes applies itself">Drafts inbox</SectionTitle>
        {rows.length > 0 && <span className="chip border-cyan-dim text-cyan">{rows.length}</span>}
        {drafts.isFetching && <Spinner />}
      </div>

      <ErrorNote error={drafts.error} />

      {rows.length === 0 && !drafts.isLoading && (
        <p className="mt-3 text-sm text-dim">
          No drafts waiting. Ask the Fixer for an NPC, a recap, or a codex page and it lands here.
        </p>
      )}

      <ul className="mt-3 space-y-3">
        {rows.map((gen) => (
          <DraftRow key={gen.id} gen={gen} campaignId={campaignId} />
        ))}
      </ul>
    </div>
  );
}
