/**
 * Describe the floor, and the Fixer lays it out (FR12.11, lane 3). The GM
 * says what the level is; the model answers with rooms, openings, props and
 * stairs in the scene's own tileset; the server turns that into squares
 * (`fixer/floor-plan.ts`) and this panel shows the plan — rooms, counts and
 * every warning — before a single square is painted. "Build it" paints the
 * plan as ONE undoable step, so Ctrl+Z takes the whole floor back.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { Scene } from '@safehouse/contracts';
import { aiDisabledFrom, isAiCancelled, useCancelAi, useFixerStatus } from '../../gm/fixer/api.js';
import { ErrorNote } from '../../gm/ui.js';
import { useBuildFloor, usePaintTiles, type FloorPlanResult } from '../api.js';
import { useHistory } from '../history.js';

export interface BuildWithAiProps {
  scene: Scene;
  /** The palette's set — what the plan is drawn in. */
  tilesetId: string;
  /** Which floor the plan lands on (FR9.22). */
  level: number;
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

/** One line the GM reads before building: rooms, squares, openings. */
export function describePlan(plan: FloorPlanResult['plan']): string {
  const c = plan.counts;
  const parts = [plural(plan.rooms.length, 'room'), plural(c.floor, 'floor square'), `${c.wall} wall`, plural(c.door, 'door')];
  if (c.window > 0) parts.push(plural(c.window, 'window'));
  if (c.prop > 0) parts.push(plural(c.prop, 'prop'));
  if (c.stair > 0) parts.push(plural(c.stair, 'stair'));
  return parts.join(' · ');
}

export default function BuildWithAi({ scene, tilesetId, level }: BuildWithAiProps) {
  const status = useFixerStatus();
  const build = useBuildFloor();
  const cancel = useCancelAi(scene.campaignId);
  const paint = usePaintTiles();
  const [prompt, setPrompt] = useState('');
  const [result, setResult] = useState<FloorPlanResult | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [building, setBuilding] = useState(false);
  const disabled = aiDisabledFrom(status.data, status.error, build.error);

  const draft = () => {
    const text = prompt.trim();
    if (text.length < 3 || build.isPending) return;
    setNote(null);
    build.mutate({ sceneId: scene.id, level, tilesetId, prompt: text }, { onSuccess: (r) => setResult(r) });
  };

  /** Three strokes, one history step: the whole floor comes and goes together. */
  const apply = async () => {
    if (!result || building) return;
    const { layers, title } = result.plan;
    const history = useHistory.getState();
    setBuilding(true);
    history.beginGroup(scene.id, `build ${title}`);
    try {
      for (const layer of ['ground', 'structure', 'object'] as const) {
        const cells = layers[layer];
        if (Object.keys(cells).length === 0) continue;
        await paint.mutateAsync({
          sceneId: scene.id,
          tilesetId: result.plan.tilesetId,
          level,
          paint: cells,
          erase: [],
        });
      }
      setNote(`built “${title}” — undo takes the whole floor back`);
      setResult(null);
    } catch (err) {
      setNote(err instanceof Error ? err.message : 'could not build it — undo, then try again');
    } finally {
      history.endGroup();
      setBuilding(false);
    }
  };

  return (
    <details
      className="rounded-md border border-edge bg-deck/60 px-3 py-2"
      data-testid="build-with-ai"
      open={result !== null || undefined}
    >
      <summary className="cursor-pointer text-sm text-ink">
        Describe this floor to the Fixer
        <span className="mono-label ml-2 text-faint">{disabled ? 'offline' : 'it lays out rooms, doors and props'}</span>
      </summary>
      {disabled ? (
        <p className="mt-2 text-xs text-dim" data-testid="build-with-ai-offline">
          Comes back with the Fixer: point{' '}
          <Link className="text-cyan underline" to={`/c/${scene.campaignId}/gm/ai`}>
            AI
          </Link>{' '}
          at an inference endpoint and this box turns a sentence into rooms, doors and furniture on
          this floor.
        </p>
      ) : (
        <div className="mt-2 flex flex-col gap-2">
          <textarea
            className="min-h-[3.5rem] w-full resize-y rounded-md border border-edge bg-deck px-2.5 py-1.5 text-sm text-ink placeholder:text-faint focus:border-cyan focus:outline-none"
            rows={3}
            value={prompt}
            placeholder="a two-room clinic: waiting area up front, an exam room behind a locked door, a back way out"
            aria-label="Describe this floor"
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                draft();
              }
            }}
          />
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="btn btn-accent px-3 py-1.5"
              onClick={draft}
              disabled={prompt.trim().length < 3 || build.isPending}
              data-testid="build-with-ai-draft"
            >
              {build.isPending ? 'laying it out…' : 'draft the floor'}
            </button>
            {build.isPending && (
              <button
                type="button"
                className="btn px-2.5 py-1 text-danger"
                onClick={() => cancel.mutate()}
                disabled={cancel.isPending}
                data-testid="build-with-ai-cancel"
              >
                cancel
              </button>
            )}
            <span className="mono-label text-faint">
              {build.isPending
                ? 'the model is laying it out — this can take a minute'
                : `floor ${level} · ${tilesetId} · nothing is painted until you build it`}
            </span>
          </div>
          {isAiCancelled(build.error) ? (
            <p className="text-xs text-warn">Cancelled — no plan, nothing painted.</p>
          ) : (
            <ErrorNote error={build.error} />
          )}

          {result && (
            <div className="rounded-md border border-cyan-dim/50 bg-panel p-2.5" data-testid="build-with-ai-plan">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="text-sm text-ink">{result.plan.title}</span>
                <span className="mono-label text-faint">{describePlan(result.plan)}</span>
              </div>
              <ul className="mt-1 flex flex-wrap gap-1">
                {result.plan.rooms.map((r) => (
                  <li key={r.name} className="chip text-dim" title={`${r.rect.w}×${r.rect.h} at ${r.rect.x},${r.rect.y}`}>
                    {r.name}
                    <span className="ml-1 normal-case text-faint">{r.kind}</span>
                  </li>
                ))}
              </ul>
              {result.plan.notes && <p className="mt-1 text-xs text-dim">{result.plan.notes}</p>}
              {result.plan.warnings.length > 0 && (
                <ul className="mt-1 space-y-0.5 text-xs text-warn" data-testid="build-with-ai-warnings">
                  {result.plan.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              )}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className="btn btn-accent px-3 py-1.5"
                  onClick={() => void apply()}
                  disabled={building || result.plan.counts.floor === 0}
                  data-testid="build-with-ai-build"
                >
                  {building ? 'building…' : 'build it'}
                </button>
                <button type="button" className="btn px-3 py-1.5" onClick={() => setResult(null)} disabled={building}>
                  discard
                </button>
                <span className="mono-label text-faint">one undo step</span>
              </div>
            </div>
          )}
          {note && (
            <p className="text-xs text-cyan" data-testid="build-with-ai-note">
              {note}
            </p>
          )}
        </div>
      )}
    </details>
  );
}
