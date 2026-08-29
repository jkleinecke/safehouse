/**
 * Live wiring for the sheet (DESIGN.md §11) — and its half of LIVE-1.
 *
 * Two jobs:
 *
 *  1. **Merge** — watch the WS-fed zustand store for persisted events that
 *     touch this character (`sheet.updated`, `combatant.damaged`,
 *     `ledger.changed`, scene changes) and invalidate the matching queries.
 *  2. **Hydrate** — the views were rendering only events that arrived while
 *     they were mounted, so a phone that reloaded mid-session showed an empty
 *     world. Every sheet query now refetches on mount (`HYDRATE_ON_MOUNT` in
 *     `api.ts`), and this hook re-hydrates again whenever the socket comes back
 *     from `offline`: gap replay covers what the hub still holds, a refetch
 *     covers everything older than the buffer.
 */
import { useEffect } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { WsEvent } from '@safehouse/contracts';
import { useLiveStore, type SocketStatus } from '../../live/store.js';
import { characterKey } from './api.js';

function rec(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};
}

/** Does this event's payload reference the character (or fail to say)? */
export function touchesCharacter(event: WsEvent, characterId: string): boolean {
  const p = rec(event.payload);
  const candidates = [
    p['characterId'],
    p['sourceId'],
    rec(p['combatant'])['sourceId'],
    rec(p['entry'])['characterId'],
  ];
  if (candidates.some((c) => c === characterId)) return true;
  // Payload names no character at all → invalidate conservatively (cheap).
  return candidates.every((c) => typeof c !== 'string');
}

/**
 * Scene events change every pool on the sheet, because the active scene's
 * environment is folded into the server's derived values (FR9.11 / LIVE-2).
 * Activating or editing a scene therefore invalidates the character, not just
 * the scene query.
 */
const SCENE_EVENTS = new Set(['scene.activated', 'scene.updated']);

/** Everything the sheet re-reads when the connection or the world moves. */
export function hydrateCharacter(qc: QueryClient, characterId: string): void {
  void qc.invalidateQueries({ queryKey: characterKey(characterId) });
}

export function useSheetLive(characterId: string | undefined): void {
  const qc = useQueryClient();

  // --- merge: events → query invalidation ---------------------------------
  useEffect(() => {
    if (!characterId) return;
    let seen = useLiveStore.getState().lastEventId;

    const unsub = useLiveStore.subscribe((state) => {
      if (state.lastEventId <= seen) return;
      const fresh = state.events.filter((e) => e.id > seen);
      seen = state.lastEventId;

      for (const event of fresh) {
        if (SCENE_EVENTS.has(event.type)) {
          void qc.invalidateQueries({ queryKey: ['scene'] });
          // The scene's environment is inside every derived pool.
          hydrateCharacter(qc, characterId);
          continue;
        }
        switch (event.type) {
          case 'sheet.updated':
          case 'combatant.damaged':
          case 'encounter.updated':
            // `encounter.updated` matters even when it names no character:
            // joining or leaving a live encounter is what makes Seize the
            // Initiative and Blitz offerable (they need `combatantId`).
            if (touchesCharacter(event, characterId)) hydrateCharacter(qc, characterId);
            break;
          case 'ledger.changed':
            if (touchesCharacter(event, characterId)) {
              void qc.invalidateQueries({
                queryKey: [...characterKey(characterId), 'ledger'],
              });
            }
            break;
          default:
            break;
        }
      }
    });

    return unsub;
  }, [characterId, qc]);

  // --- hydrate: re-read the world after a reconnect (LIVE-1) --------------
  useEffect(() => {
    if (!characterId) return;
    let previous: SocketStatus = useLiveStore.getState().status;
    return useLiveStore.subscribe((state) => {
      const next = state.status;
      if (next === previous) return;
      const reconnected = previous === 'offline' && next === 'online';
      previous = next;
      if (reconnected) hydrateCharacter(qc, characterId);
    });
  }, [characterId, qc]);
}
