/** The GM's one open card, whichever screen asked for it, and the boxes still undoable. */
import { create } from 'zustand';
import type { AttackKind, CardActorRef, Exchange, Visibility } from '@safehouse/contracts';
import type { CardStart } from './cardModel.js';

interface Who {
  actor: CardActorRef;
  title: string;
  /** A runner: the GM enters it for the player at the table. */
  runner?: boolean;
}

export type GmCardRequest =
  | (Who & { kind: 'act'; start?: CardStart; visibility?: Visibility })
  | (Who & { kind: 'defend'; exchangeId: string; against: AttackKind; start?: CardStart })
  | (Who & { kind: 'soak'; exchangeId: string })
  | { kind: 'declare'; target: CardActorRef; targetName: string };

export const useGmCard = create<{ req: GmCardRequest | null; seq: number }>()(() => ({ req: null, seq: 0 }));

export function openGmCard(req: GmCardRequest): void {
  useGmCard.setState((s) => ({ req, seq: s.seq + 1 }));
}

export function closeGmCard(): void {
  useGmCard.setState({ req: null });
}

/** Applied this session, newest last, so Undo stays in reach. */
export const useApplied = create<{ list: Exchange[] }>()(() => ({ list: [] }));

export function rememberApplied(x: Exchange): void {
  useApplied.setState((s) => ({ list: [...s.list.filter((y) => y.id !== x.id), x].slice(-20) }));
}

export function forgetApplied(id: string): void {
  useApplied.setState((s) => ({ list: s.list.filter((y) => y.id !== id) }));
}
