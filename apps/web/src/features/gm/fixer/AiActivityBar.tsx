/**
 * What the AI is doing right now, on every GM screen, with the one button
 * that stops it. The server announces `ai.activity` when a run starts, is
 * renamed, is being cancelled and ends (fixer/activity.ts); the live store
 * keeps the latest; this bar shows it with a clock and a cancel. Between the
 * click and the server's announcement the bar shows the click's own label
 * (`useAiPending`), so nothing on screen goes quiet while a request is in
 * flight.
 *
 * The cancel is the server's: `POST /api/fixer/cancel` aborts the model call
 * and the route that was running answers its caller with 499 `ai_cancelled`.
 */
import { useEffect, useState } from 'react';
import { useLiveStore } from '../../../live/store.js';
import { useAiPending, useCancelAi } from './api.js';

/** The noun for a run's kind, so the bar can say whose work it is. */
export const KIND_NOUN: Record<string, string> = {
  chat: 'the Fixer',
  npc: 'an NPC',
  floor: 'the floor builder',
  map: 'the map reader',
  geometry: 'the layout copilot',
  tokens: 'token identification',
  architect: 'the Architect',
};

export function elapsedLabel(sinceIso: string, now: number): string {
  const s = Math.max(0, Math.round((now - Date.parse(sinceIso)) / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

export interface ActivityBarViewProps {
  activity: { kind: string; label: string; since: string } | null;
  cancelling: boolean;
  now: number;
  onCancel: () => void;
  cancelPending?: boolean;
}

/** The bar itself, given its state — the half a static render can see. */
export function ActivityBarView({ activity, cancelling, now, onCancel, cancelPending }: ActivityBarViewProps) {
  if (!activity) return null;
  return (
    <div
      className="flex flex-wrap items-center gap-2 border-b border-cyan-dim/50 bg-panel/95 px-4 py-1.5 text-xs"
      role="status"
      aria-live="polite"
      data-testid="ai-activity"
      data-kind={activity.kind}
      data-state={cancelling ? 'cancelling' : 'busy'}
    >
      <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-cyan" aria-hidden />
      <span className="text-ink">
        {cancelling ? 'stopping' : 'working'} · {activity.label}
      </span>
      <span className="mono-label text-faint">{elapsedLabel(activity.since, now)}</span>
      <span className="mono-label text-faint">· {KIND_NOUN[activity.kind] ?? activity.kind}</span>
      <button
        type="button"
        className="btn ml-auto px-2.5 py-0.5 text-danger"
        onClick={onCancel}
        disabled={cancelPending || cancelling}
        data-testid="ai-cancel"
        title="Stop the model call; nothing it has not finished is applied"
      >
        {cancelling ? 'stopping…' : 'cancel'}
      </button>
    </div>
  );
}

export default function AiActivityBar({ campaignId }: { campaignId: string }) {
  const live = useLiveStore((s) => s.aiActivity);
  const pending = useAiPending((s) => s.pending);
  const cancel = useCancelAi(campaignId);
  const [now, setNow] = useState(() => Date.now());

  const active = live ?? pending;
  useEffect(() => {
    if (!active) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [active]);

  return (
    <ActivityBarView
      activity={active}
      cancelling={live?.state === 'cancelling'}
      now={now}
      onCancel={() => cancel.mutate()}
      cancelPending={cancel.isPending}
    />
  );
}
