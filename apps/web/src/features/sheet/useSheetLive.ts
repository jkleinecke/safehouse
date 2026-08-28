/**
 * Live refetch wiring (DESIGN.md §11): watches the WS-fed zustand store for
 * persisted events that touch this character — sheet.updated,
 * combatant.damaged, ledger.changed — and invalidates the matching queries.
 */
import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { WsEvent } from '@safehouse/contracts';
import { useLiveStore } from '../../live/store.js';
import { characterKey } from './api.js';

function rec(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};
}

/** Does this event's payload reference the character (or fail to say)? */
function touchesCharacter(event: WsEvent, characterId: string): boolean {
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

export function useSheetLive(characterId: string | undefined): void {
  const qc = useQueryClient();

  useEffect(() => {
    if (!characterId) return;
    let seen = useLiveStore.getState().lastEventId;

    const unsub = useLiveStore.subscribe((state) => {
      if (state.lastEventId <= seen) return;
      const fresh = state.events.filter((e) => e.id > seen);
      seen = state.lastEventId;

      for (const event of fresh) {
        switch (event.type) {
          case 'sheet.updated':
          case 'combatant.damaged':
            if (touchesCharacter(event, characterId)) {
              void qc.invalidateQueries({ queryKey: characterKey(characterId) });
            }
            break;
          case 'ledger.changed':
            if (touchesCharacter(event, characterId)) {
              void qc.invalidateQueries({
                queryKey: [...characterKey(characterId), 'ledger'],
              });
            }
            break;
          case 'scene.updated':
            // Environment may have changed — refresh the env chip source.
            void qc.invalidateQueries({ queryKey: ['scene'] });
            break;
          default:
            break;
        }
      }
    });

    return unsub;
  }, [characterId, qc]);
}
