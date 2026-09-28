/** Guided roll cards over REST: an actor's actions, a card, settling it (server-built, DESIGN.md §10.1). */
import { useQuery } from '@tanstack/react-query';
import type {
  ActionType,
  AttackKind,
  CardAction,
  CardActor,
  CardActorRef,
  CardRequestInput,
  CardSettleRequestInput,
  Exchange,
  Glitch,
  LimitKind,
  RollCard,
} from '@safehouse/contracts';
import { apiGet, apiPost } from '../../api/client.js';

/** One entry of the actions list (the server's `ActionSummary`). */
export interface ActionSummary extends CardAction {
  needsTarget?: true;
  /** The sheet's weapons, the ones made for this action first. */
  weapons?: string[];
  /** The pool with the card's defaults, before a target or a range. */
  preview: { total: number; limit: { kind: LimitKind; value: number } | null } | null;
}

export interface ActorActions {
  actor: CardActor;
  groups: { type: ActionType; actions: ActionSummary[] }[];
  /** Given an attack kind: every defense, in the server's order. */
  defenses?: string[];
}

/** The part of the stored roll a card shows. */
export interface SettledRoll {
  id: string;
  faces: number[];
  hits: number;
  limitedHits: number;
  glitch: Glitch;
  limit: { kind: string; value: number } | null;
}

export interface CardSettled {
  card: RollCard;
  roll: SettledRoll | null;
  initScore?: { combatantId: string; from: number; to: number };
  exchange?: Exchange;
}

export function fetchActions(ref: CardActorRef, against?: AttackKind): Promise<ActorActions> {
  const q = against ? `?against=${against}` : '';
  return apiGet<ActorActions>(`/api/actors/${ref.kind}/${encodeURIComponent(ref.id)}/actions${q}`);
}

export function previewCard(req: CardRequestInput): Promise<RollCard> {
  return apiPost<{ card: RollCard }>('/api/cards/preview', req).then((r) => r.card);
}

export function settleCard(req: CardSettleRequestInput): Promise<CardSettled> {
  return apiPost<CardSettled>('/api/cards/settle', req);
}

export function useActorActions(ref: CardActorRef | null, against?: AttackKind) {
  return useQuery({
    queryKey: ['card-actions', ref?.kind, ref?.id, against ?? null],
    queryFn: () => fetchActions(ref as CardActorRef, against),
    enabled: ref !== null,
    staleTime: 15_000,
    retry: 0,
  });
}
