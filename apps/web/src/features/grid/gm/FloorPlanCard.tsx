/**
 * A floor plan the Fixer drafted (FR12.11, lane 3), shown where the GM asked
 * for it — in the chat — with one button that paints it.
 *
 * The plan arrives from the chat's `draft_floor` tool with every square
 * already worked out (`fixer/floor-plan.ts`), and the card BUILDS it the
 * moment it arrives — the GM asked for a floor, not for a floor to approve.
 * The three layers go down as ONE undoable step, so Ctrl+Z is the "no".
 *
 * Built here, in the browser, rather than by the server, for exactly that
 * reason: the paint goes through the same path as a brush stroke, so it lands
 * on the GM's own undo history. A plan in a thread reopened from the server
 * is shown, not built again — a reload must never paint a floor twice.
 *
 * It used to live inside the dock's "draft a floor" tab, with its own text
 * box. That tab is gone: the chat is where the GM asks, and the chat can
 * carry what the floor is FOR from everything said before it.
 */
import { useEffect, useState } from 'react';
import Icon from '../../../components/Icon.js';
import { usePaintTiles, type FloorPlanResult } from '../api.js';
import { useHistory } from '../history.js';

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

/** One line the GM reads before building: rooms, squares, openings. */
export function describePlan(plan: FloorPlanResult['plan']): string {
  const c = plan.counts;
  const parts = [plural(plan.rooms.length, 'room'), plural(c.floor, 'floor square'), `${c.wall} wall`, plural(c.door, 'door')];
  if (c.window > 0) parts.push(plural(c.window, 'window'));
  const props = c.prop + (c.dressed ?? 0);
  if (props > 0) parts.push(plural(props, 'prop'));
  if (c.stair > 0) parts.push(plural(c.stair, 'stair'));
  // The outside is painted too (every square, first pass), and dressed.
  if ((c.outside ?? 0) > 0) parts.push(`${c.outside} outside`);
  if ((c.areas ?? 0) > 0) parts.push(plural(c.areas ?? 0, 'area'));
  if ((c.scatter ?? 0) > 0) parts.push(`${c.scatter} scattered`);
  return parts.join(' · ');
}

export interface FloorPlanCardProps {
  sceneId: string;
  level: number;
  plan: FloorPlanResult['plan'];
  /**
   * Build as soon as it is shown. Keyed, so a card that remounts — React's
   * development double-mount, a panel closed and reopened — cannot paint the
   * same plan twice. Absent for a plan read back from an old thread.
   */
  autoBuildKey?: string;
}

/** Plans already built this session, by their tool call. */
const built = new Set<string>();

export default function FloorPlanCard({ sceneId, level, plan, autoBuildKey }: FloorPlanCardProps) {
  const paint = usePaintTiles();
  const [state, setState] = useState<'ready' | 'building' | 'built'>(
    autoBuildKey && built.has(autoBuildKey) ? 'built' : 'ready',
  );
  const [note, setNote] = useState<string | null>(
    autoBuildKey && built.has(autoBuildKey) ? 'built — Ctrl+Z takes the whole floor back' : null,
  );

  /** Three strokes, one history step: the whole floor comes and goes together. */
  const build = async () => {
    if (state !== 'ready') return;
    const history = useHistory.getState();
    setState('building');
    history.beginGroup(sceneId, `build ${plan.title}`);
    try {
      for (const layer of ['ground', 'structure', 'object'] as const) {
        const cells = plan.layers[layer];
        if (Object.keys(cells).length === 0) continue;
        await paint.mutateAsync({ sceneId, tilesetId: plan.tilesetId, level, paint: cells, erase: [] });
      }
      setState('built');
      setNote('built — Ctrl+Z takes the whole floor back');
    } catch (err) {
      setState('ready');
      setNote(err instanceof Error ? err.message : 'could not build it — undo, then try again');
    } finally {
      history.endGroup();
    }
  };

  // Straight onto the map: no confirmation, one undo step.
  useEffect(() => {
    if (!autoBuildKey || built.has(autoBuildKey)) return;
    built.add(autoBuildKey);
    void build();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoBuildKey]);

  return (
    <div className="rounded-md border border-cyan-dim/50 bg-panel p-2.5" data-testid="floor-plan-card">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="text-sm text-ink">{plan.title}</span>
        <span className="mono-label text-faint">{describePlan(plan)}</span>
      </div>
      <ul className="mt-1 flex flex-wrap gap-1">
        {plan.rooms.map((r) => (
          <li key={r.name} className="chip text-dim" title={`${r.rect.w}×${r.rect.h} at ${r.rect.x},${r.rect.y}`}>
            {r.name}
            <span className="ml-1 normal-case text-faint">{r.kind}</span>
          </li>
        ))}
      </ul>
      {plan.notes && <p className="mt-1 text-xs text-dim">{plan.notes}</p>}
      {plan.warnings.length > 0 && (
        <ul className="mt-1 space-y-0.5 text-xs text-warn" data-testid="floor-plan-warnings">
          {plan.warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      )}
      {state === 'building' && <p className="mono-label mt-2 animate-pulse text-cyan">building…</p>}
      {state === 'ready' && !autoBuildKey && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="btn px-2.5 py-1.5"
            onClick={() => void build()}
            disabled={plan.counts.floor === 0}
            data-testid="floor-plan-build"
            title="Build it again — a plan from earlier in this thread; one undo step"
            aria-label="Build it again"
          >
            <Icon name="construction" size={18} />
          </button>
          <span className="mono-label text-faint">floor {level} · from earlier in the thread</span>
        </div>
      )}
      {note && (
        <p className="mt-1 text-xs text-cyan" data-testid="floor-plan-note">
          {note}
        </p>
      )}
    </div>
  );
}
