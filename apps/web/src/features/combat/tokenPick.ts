/** "Tap a token": the card steps aside, and the map's next token tap is its target. */
import { create } from 'zustand';

interface TokenPickState {
  picking: boolean;
  picked: string | null;
  start: () => void;
  stop: () => void;
  clear: () => void;
}

export const useTokenPick = create<TokenPickState>()((set) => ({
  picking: false,
  picked: null,
  start: () => set({ picking: true, picked: null }),
  stop: () => set({ picking: false }),
  clear: () => set({ picked: null }),
}));

/** The map calls this on every token tap; it only counts while a card is picking. */
export function offerTokenPick(tokenId: string | null): void {
  if (tokenId && useTokenPick.getState().picking) useTokenPick.setState({ picking: false, picked: tokenId });
}
