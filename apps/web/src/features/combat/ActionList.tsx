/** An actor's actions grouped Free / Simple / Complex / Interrupt, each with its type and page. */
import type { ActionType, Ref } from '@safehouse/contracts';
import { RefChip } from '../gm/books/RefChip.js';
import type { ActionSummary, ActorActions } from './cardApi.js';
import { TYPE_LABEL, TYPE_TONE, orderedGroups } from './cardModel.js';

export function TypeBadge({ type }: { type: ActionType }) {
  return <span className={`chip shrink-0 py-0 text-[0.6rem] ${TYPE_TONE[type]}`}>{TYPE_LABEL[type]}</span>;
}

export function PageChip({ refValue }: { refValue: Ref | undefined }) {
  if (!refValue) return null;
  return (
    <span className="inline-flex shrink-0" onClick={(e) => e.stopPropagation()} role="presentation">
      <RefChip refValue={refValue} className="py-0 text-[0.6rem] text-faint" />
    </span>
  );
}

function previewText(a: ActionSummary): string {
  if (!a.preview) return 'no test';
  const limit = a.preview.limit ? ` [${a.preview.limit.value}]` : '';
  return `${a.preview.total}${limit}`;
}

export function ActionRow({ action, onPick }: { action: ActionSummary; onPick: (a: ActionSummary) => void }) {
  return (
    <li className="flex items-center gap-2 border-b border-edge/50 last:border-b-0">
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-2 py-2 text-left hover:text-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan pointer-coarse:min-h-11"
        onClick={() => onPick(action)}
      >
        <span className="min-w-0 flex-1 truncate text-sm text-ink">{action.name}</span>
        {action.initCost !== undefined && (
          <span className="shrink-0 font-label text-[0.65rem] text-warn">−{action.initCost} init</span>
        )}
        <span className="shrink-0 font-label text-xs tabular-nums text-dim" title="Dice [limit], before a target">
          {previewText(action)}
        </span>
      </button>
      <TypeBadge type={action.type} />
      <PageChip refValue={action.ref} />
    </li>
  );
}

export default function ActionList({
  actions,
  onPick,
}: {
  actions: ActorActions;
  onPick: (a: ActionSummary) => void;
}) {
  return (
    <div className="space-y-3" data-testid="action-list">
      {orderedGroups(actions).map((g) => (
        <section key={g.type} aria-label={`${TYPE_LABEL[g.type]} actions`}>
          <div className="mono-label mb-1 flex items-center gap-2">
            <TypeBadge type={g.type} />
            <span className="text-faint">{g.actions.length}</span>
          </div>
          <ul>
            {g.actions.map((a) => (
              <ActionRow key={a.id} action={a} onPick={onPick} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
