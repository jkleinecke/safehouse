/**
 * The Architect's screen, given its state — the half a static render can see.
 *
 * Three stages on one page: the brief, the outline as a checklist, what
 * landed. The page (`ArchitectPage.tsx`) owns the state and the requests;
 * this renders them. Every AI request here is cancellable from the button
 * beside it and from the activity bar, and while the build runs the label
 * the server renames the run to ("writing “Pier 23” (1 of 4)") is the
 * progress line.
 */
import { Link } from 'react-router-dom';
import type { ArchitectBuildItem, ArchitectBuildResult, ArchitectOutline, ArchitectSelection } from '../fixer/api.js';
import { ErrorNote } from '../ui.js';

export type ItemType = keyof ArchitectSelection;

export interface ArchitectViewProps {
  campaignId: string;
  /** The AI is off: say so, link to where it is turned on, nothing else. */
  offline: boolean;
  brief: string;
  onBrief: (v: string) => void;
  outline: ArchitectOutline | null;
  ticked: ArchitectSelection;
  onToggle: (type: ItemType, index: number) => void;
  onToggleAll: (type: ItemType, on: boolean) => void;
  outlining: boolean;
  building: boolean;
  /** The server's label for the run in flight, when there is one. */
  progress: string | null;
  cancelling: boolean;
  result: ArchitectBuildResult | null;
  outlineError: unknown;
  buildError: unknown;
  outlineCancelled: boolean;
  buildCancelled: boolean;
  onOutline: () => void;
  onBuild: () => void;
  onCancel: () => void;
  onStartOver: () => void;
}

const TYPE_LABEL: Record<ItemType, string> = { lore: 'codex pages', npcs: 'NPCs', scenes: 'scenes' };

export function tickedCount(sel: ArchitectSelection): number {
  return sel.lore.length + sel.npcs.length + sel.scenes.length;
}

/** One line per landed item: where it went and how to get there. */
export function landedLine(item: ArchitectBuildItem): string {
  if (!item.ok) return item.note ?? 'failed';
  const where = item.landed === 'scenes' ? 'staged as a scene' : 'in the drafts inbox';
  return item.note ? `${where} — ${item.note}` : where;
}

function Checklist({
  type,
  items,
  ticked,
  disabled,
  onToggle,
  onToggleAll,
}: {
  type: ItemType;
  items: Array<{ title: string; detail: string; sub?: string }>;
  ticked: number[];
  disabled: boolean;
  onToggle: (type: ItemType, index: number) => void;
  onToggleAll: (type: ItemType, on: boolean) => void;
}) {
  if (items.length === 0) return null;
  const all = ticked.length === items.length;
  return (
    <section className="rounded-md border border-edge bg-deck/60 p-3" data-testid={`architect-${type}`}>
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="mono-label text-cyan">
          {TYPE_LABEL[type]} <span className="text-faint">· {ticked.length} of {items.length}</span>
        </h3>
        <button type="button" className="mono-label text-faint hover:text-ink" onClick={() => onToggleAll(type, !all)} disabled={disabled}>
          {all ? 'none' : 'all'}
        </button>
      </div>
      <ul className="mt-2 space-y-1.5">
        {items.map((item, i) => (
          <li key={i}>
            <label className="flex cursor-pointer items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={ticked.includes(i)}
                disabled={disabled}
                onChange={() => onToggle(type, i)}
                data-testid={`architect-tick-${type}-${i}`}
              />
              <span>
                <span className="text-ink">{item.title}</span>
                {item.sub && <span className="mono-label ml-2 text-faint">{item.sub}</span>}
                <span className="block text-xs text-dim">{item.detail}</span>
              </span>
            </label>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function ArchitectView(p: ArchitectViewProps) {
  const base = `/c/${p.campaignId}`;
  if (p.offline) {
    return (
      <p className="mt-3 max-w-2xl text-sm text-dim" data-testid="architect-offline">
        Comes back with the Fixer: point{' '}
        <Link className="text-cyan underline" to={`${base}/gm/ai`}>
          AI
        </Link>{' '}
        at an inference endpoint and this screen turns a paragraph into codex pages, NPCs and mapped
        scenes you accept one at a time.
      </p>
    );
  }
  const count = p.outline ? tickedCount(p.ticked) : 0;
  const busy = p.outlining || p.building;
  return (
    <div className="mt-3 flex max-w-3xl flex-col gap-4">
      {/* 1. The brief */}
      <section data-testid="architect-brief">
        <label className="block">
          <span className="mono-label block">The brief</span>
          <textarea
            className="mt-1 min-h-[6rem] w-full resize-y rounded-md border border-edge bg-deck px-2.5 py-1.5 text-sm text-ink placeholder:text-faint focus:border-cyan focus:outline-none"
            rows={5}
            value={p.brief}
            disabled={busy}
            placeholder="A dockside smuggling ring is moving something the corps want back. Three sessions: the hire, the tail, the exchange that goes wrong. I need the pier, the crew, the Johnson, and the warehouse it ends in."
            aria-label="The brief"
            onChange={(e) => p.onBrief(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                p.onOutline();
              }
            }}
          />
        </label>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="btn btn-accent px-3 py-1.5"
            onClick={p.onOutline}
            disabled={p.brief.trim().length < 10 || busy}
            data-testid="architect-outline"
          >
            {p.outlining ? 'roughing it out…' : p.outline ? 'rough it out again' : 'rough it out'}
          </button>
          {p.outlining && (
            <button type="button" className="btn px-2.5 py-1 text-danger" onClick={p.onCancel} disabled={p.cancelling} data-testid="architect-cancel">
              {p.cancelling ? 'stopping…' : 'cancel'}
            </button>
          )}
          <span className="mono-label text-faint">
            {p.outlining ? 'the model is planning — this can take a minute' : 'nothing is written until you build'}
          </span>
        </div>
        {p.outlineCancelled ? <p className="mt-1 text-xs text-warn">Cancelled — no outline.</p> : <ErrorNote error={p.outlineError} />}
      </section>

      {/* 2. The outline as a checklist */}
      {p.outline && (
        <section className="rounded-md border border-cyan-dim/50 bg-panel p-3" data-testid="architect-plan">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-base font-semibold text-ink">{p.outline.title}</h2>
            <button type="button" className="mono-label text-faint hover:text-ink" onClick={p.onStartOver} disabled={busy}>
              start over
            </button>
          </div>
          <p className="mt-1 text-sm text-dim">{p.outline.premise}</p>
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            <Checklist
              type="lore"
              items={p.outline.lore.map((l) => ({ title: l.title, sub: l.kind, detail: l.summary }))}
              ticked={p.ticked.lore}
              disabled={busy}
              onToggle={p.onToggle}
              onToggleAll={p.onToggleAll}
            />
            <Checklist
              type="npcs"
              items={p.outline.npcs.map((n) => ({
                title: n.name,
                sub: n.archetype,
                detail: [n.role, n.persona.voice ? `voice: ${n.persona.voice}` : '', n.persona.goals[0] ? `wants: ${n.persona.goals[0]}` : '']
                  .filter(Boolean)
                  .join(' · '),
              }))}
              ticked={p.ticked.npcs}
              disabled={busy}
              onToggle={p.onToggle}
              onToggleAll={p.onToggleAll}
            />
            <Checklist
              type="scenes"
              items={p.outline.scenes.map((s) => ({
                title: s.name,
                sub: `${s.cols}×${s.rows}${s.tileset ? ` · ${s.tileset}` : ''}`,
                detail: `${s.purpose} ${s.floor}`,
              }))}
              ticked={p.ticked.scenes}
              disabled={busy}
              onToggle={p.onToggle}
              onToggleAll={p.onToggleAll}
            />
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button type="button" className="btn btn-accent px-3 py-1.5" onClick={p.onBuild} disabled={count === 0 || busy} data-testid="architect-build">
              {p.building ? 'building…' : `build ${count} item${count === 1 ? '' : 's'}`}
            </button>
            {p.building && (
              <button type="button" className="btn px-2.5 py-1 text-danger" onClick={p.onCancel} disabled={p.cancelling} data-testid="architect-cancel">
                {p.cancelling ? 'stopping…' : 'cancel'}
              </button>
            )}
            <span className="mono-label text-faint" data-testid="architect-progress">
              {p.building
                ? p.progress ?? 'starting…'
                : 'pages and NPCs land in the drafts inbox; scenes are staged, never active'}
            </span>
          </div>
          {p.buildCancelled && !p.result ? <p className="mt-1 text-xs text-warn">Cancelled — nothing was built.</p> : <ErrorNote error={p.buildError} />}
        </section>
      )}

      {/* 3. What landed */}
      {p.result && (
        <section className="rounded-md border border-edge bg-deck/60 p-3" data-testid="architect-result">
          <h2 className="mono-label text-cyan">
            {p.result.cancelled ? 'stopped — what landed before that' : 'what landed'}
            <span className="ml-2 text-faint">
              {p.result.results.filter((r) => r.ok).length} of {p.result.results.length} ok
            </span>
          </h2>
          {p.result.results.length === 0 ? (
            <p className="mt-2 text-sm text-dim">Nothing — the first item had not finished.</p>
          ) : (
            <ul className="mt-2 space-y-1 text-sm">
              {p.result.results.map((r) => (
                <li key={`${r.type}-${r.index}`} className="flex items-start gap-2" data-testid={`architect-landed-${r.type}-${r.index}`} data-ok={r.ok}>
                  <span className={r.ok ? 'text-cyan' : 'text-danger'} aria-hidden>
                    {r.ok ? '✓' : '✕'}
                  </span>
                  <span>
                    <span className="text-ink">{r.name}</span>
                    <span className="mono-label ml-2 text-faint">{r.type === 'lore' ? 'page' : r.type}</span>
                    <span className="block text-xs text-dim">{landedLine(r)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            {p.result.results.some((r) => r.ok && r.landed === 'drafts') && (
              <Link className="btn px-3 py-1.5" to={`${base}/gm/fixer`} data-testid="architect-to-drafts">
                open the drafts inbox
              </Link>
            )}
            {p.result.results.some((r) => r.landed === 'scenes') && (
              <Link className="btn px-3 py-1.5" to={`${base}/gm/scenes`} data-testid="architect-to-scenes">
                open Scenes
              </Link>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
