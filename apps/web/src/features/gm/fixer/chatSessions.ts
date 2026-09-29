/**
 * Chat panels outlive their mount. The dock's chat and the NPC voice keep
 * their state here for the life of the tab, so a panel that unmounts — a
 * page change that hides its tab, a crash that took the layout down, another
 * campaign and back — comes back exactly as it was: messages, an answer
 * still streaming, the draft, the scroll. Nothing is refetched.
 */

/** One value per key, made on first ask and kept for the tab's life. */
export function keyed<T>(): (key: string, make: () => T) => T {
  const all = new Map<string, T>();
  return (key, make) => {
    let v = all.get(key);
    if (v === undefined) {
      v = make();
      all.set(key, v);
    }
    return v;
  };
}

export interface SavedScroll {
  top: number;
  atBottom: boolean;
}

type Box = { scrollTop: number; scrollHeight: number; clientHeight: number };

/** Where a scroller is; a few px from the end counts as the end. */
export function readScroll(el: Box): SavedScroll {
  return { top: el.scrollTop, atBottom: el.scrollHeight - el.scrollTop - el.clientHeight <= 8 };
}

/** Where a remounted scroller goes: where it was, or the end if it was there. */
export function restoreScroll(saved: SavedScroll | null, el: Box): number {
  return !saved || saved.atBottom ? el.scrollHeight : saved.top;
}
