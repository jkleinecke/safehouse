/**
 * A roll card in a bottom sheet: straight to one action, or a list first (all
 * of an actor's actions, or the answers to an incoming attack). On the map the
 * sheet steps aside while the player taps a target token.
 */
import { useEffect, useState, type ReactNode } from 'react';
import type { AttackKind, CardActorRef, DeclaredBy, Token, Visibility } from '@safehouse/contracts';
import type { CoverLevel } from '@safehouse/rules';
import { Sheet } from '../sheet/components/ui.js';
import ActionList, { ActionRow } from './ActionList.js';
import { useActorActions, type ActionSummary } from './cardApi.js';
import { defenseChoices, newDraft, startDraft, type CardDraft, type CardStart } from './cardModel.js';
import RollCardPanel from './RollCardPanel.js';
import { useTokenPick } from './tokenPick.js';

export type CardFlowMode =
  | { kind: 'act'; start?: CardStart }
  | { kind: 'defend'; exchangeId: string; against: AttackKind; start?: CardStart }
  | { kind: 'card'; action: Pick<ActionSummary, 'id' | 'weapons' | 'needsTarget'>; exchangeId?: string };

export interface CardFlowProps {
  campaignId: string;
  sceneId?: string | null;
  actor: CardActorRef;
  title: string;
  mode: CardFlowMode;
  gm: boolean;
  forActorBy?: DeclaredBy;
  skills?: readonly string[];
  /** The map's tokens: "tap a token" is offered only with them. */
  tokens?: readonly Token[];
  /** Above the list (the GM's incoming attacks and "Declare an attack"). */
  header?: ReactNode;
  /** GM, on the map: the cover the map reads between two rows. */
  coverOf?: (attackerId: string, targetId: string) => CoverLevel | null;
  initialVisibility?: Visibility;
  onClose: () => void;
}

function firstDraft(actor: CardActorRef, mode: CardFlowMode): CardDraft | null {
  if (mode.kind === 'card') return newDraft(actor, mode.action, mode.exchangeId);
  return mode.start ? startDraft(actor, mode.start, mode.kind === 'defend' ? mode.exchangeId : undefined) : null;
}

export default function CardFlow(props: CardFlowProps) {
  const { actor, mode, gm } = props;
  const [draft, setDraft] = useState<CardDraft | null>(() => firstDraft(actor, mode));
  const listed = mode.kind !== 'card';
  const actions = useActorActions(listed ? actor : null, mode.kind === 'defend' ? mode.against : undefined);

  const picking = useTokenPick((s) => s.picking);
  const picked = useTokenPick((s) => s.picked);
  const [mine, setMine] = useState(false);
  useEffect(() => {
    if (!mine || !picked || !draft) return;
    const name = props.tokens?.find((t) => t.id === picked)?.name;
    setDraft({ ...draft, target: { kind: 'token', id: picked, ...(name ? { name } : {}) } });
    setMine(false);
    useTokenPick.getState().clear();
  }, [mine, picked, draft, props.tokens]);
  // Leaving mid-pick must not leave the map waiting for a tap.
  useEffect(() => () => useTokenPick.getState().stop(), []);

  const pickOnMap = props.tokens
    ? () => {
        setMine(true);
        useTokenPick.getState().start();
      }
    : undefined;

  if (mine && picking) {
    return (
      <div className="fixed inset-x-0 bottom-4 z-50 mx-auto flex w-[min(100%-2rem,26rem)] items-center gap-2 rounded-lg border border-cyan-dim bg-panel/95 px-3 py-2 shadow-lg">
        <span className="flex-1 text-sm text-ink">Tap the target on the map</span>
        <button
          type="button"
          className="btn px-3 py-1 pointer-coarse:min-h-10"
          onClick={() => {
            setMine(false);
            useTokenPick.getState().stop();
          }}
          title="Back to the card"
          aria-label="Back to the card"
        >
          Back
        </button>
      </div>
    );
  }

  const pick = (a: ActionSummary) =>
    setDraft(newDraft(actor, a, mode.kind === 'defend' ? mode.exchangeId : undefined));

  let body;
  if (draft) {
    body = (
      <RollCardPanel
        campaignId={props.campaignId}
        sceneId={props.sceneId ?? null}
        draft={draft}
        onDraft={setDraft}
        gm={gm}
        {...(props.forActorBy ? { forActorBy: props.forActorBy } : {})}
        {...(props.skills ? { skills: props.skills } : {})}
        {...(pickOnMap ? { onPickOnMap: pickOnMap } : {})}
        {...(props.coverOf ? { coverOf: props.coverOf } : {})}
        {...(props.initialVisibility ? { initialVisibility: props.initialVisibility } : {})}
        {...(listed ? { onBack: () => setDraft(null) } : {})}
        onDone={props.onClose}
      />
    );
  } else if (actions.isError) {
    body = <p className="py-4 text-center text-sm text-danger">{actions.error instanceof Error ? actions.error.message : 'No actions.'}</p>;
  } else if (!actions.data) {
    body = <p className="py-4 text-center text-sm text-faint" role="status">Loading the actions…</p>;
  } else if (mode.kind === 'defend') {
    body = (
      <>
        {!gm && <p className="mb-2 text-xs text-faint">Optional: the GM can roll it for you.</p>}
        <ul>
          {defenseChoices(actions.data).map((a) => (
            <ActionRow key={a.id} action={a} onPick={pick} />
          ))}
        </ul>
      </>
    );
  } else {
    body = <ActionList actions={actions.data} onPick={pick} />;
  }
  if (!draft && props.header) {
    body = (
      <>
        {props.header}
        {body}
      </>
    );
  }

  return (
    <Sheet open onClose={props.onClose} title={props.title}>
      {body}
    </Sheet>
  );
}
