/**
 * Codex ↔ live socket bridge (§11 event catalog).
 *
 * The codex reads REST on mount like every other screen (LIVE-1: the socket is
 * a delta feed, never the whole truth). What it also has to do is *notice* the
 * reveals that happen while a page is open: the GM flips a section to shared
 * and the player staring at that page should see it appear, not find it after
 * a refresh.
 *
 * So: the persisted events this feature cares about are turned into cache
 * invalidations. `codexEventEffects` is the pure half — what a batch of events
 * means for the caches — and `useCodexLive` applies it.
 *
 * Nothing here decides visibility. A reveal event only reaches a device that
 * may know about it (the hub filters, Principle 4), and the refetch it triggers
 * comes back through the same server-side filter as the first read.
 */
import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { WsEvent } from '@safehouse/contracts';
import { useLiveStore } from '../../live/store.js';
import { codexKeys } from './keys.js';

export interface CodexEffects {
  /** Page ids to refetch (a reveal changed what this device may read). */
  pages: string[];
  /** The page list changed (title, visibility, a page appeared/vanished). */
  list: boolean;
  handouts: boolean;
  runs: boolean;
  calendar: boolean;
}

const EMPTY: CodexEffects = {
  pages: [],
  list: false,
  handouts: false,
  runs: false,
  calendar: false,
};

function asRecord(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};
}

/** What a batch of persisted events means for the codex caches. */
export function codexEventEffects(events: WsEvent[]): CodexEffects {
  const pages = new Set<string>();
  let list = false;
  let handouts = false;
  let runs = false;
  let calendar = false;

  for (const event of events) {
    const payload = asRecord(event.payload);
    switch (event.type) {
      case 'wiki.revealed': {
        const pageId = payload['pageId'];
        if (typeof pageId === 'string') pages.add(pageId);
        list = true;
        break;
      }
      case 'handout.revealed': {
        handouts = true;
        const pageId = payload['pageId'];
        if (typeof pageId === 'string') pages.add(pageId);
        break;
      }
      case 'clock.advanced':
        calendar = true;
        break;
      case 'ledger.changed':
        // Run awards post as ledger entries; the board shows what it posted.
        runs = true;
        break;
      default:
        break;
    }
  }

  if (pages.size === 0 && !list && !handouts && !runs && !calendar) return EMPTY;
  return { pages: [...pages], list, handouts, runs, calendar };
}

/**
 * Apply codex-relevant live events to the query cache. Mount it on any codex
 * screen; it only ever looks at events that arrived after it started.
 */
export function useCodexLive(campaignId: string | undefined): void {
  const qc = useQueryClient();
  const events = useLiveStore((s) => s.events);
  const seenRef = useRef<number>(-1);

  useEffect(() => {
    if (!campaignId) return;
    // First pass establishes the watermark: the mount-time REST read already
    // covers everything before it, so replaying it would just refetch twice.
    if (seenRef.current < 0) {
      seenRef.current = events.at(-1)?.id ?? 0;
      return;
    }
    const fresh = events.filter((e) => e.id > seenRef.current);
    if (fresh.length === 0) return;
    seenRef.current = fresh.at(-1)?.id ?? seenRef.current;

    const effects = codexEventEffects(fresh);
    for (const pageId of effects.pages) {
      void qc.invalidateQueries({ queryKey: codexKeys.page(pageId) });
    }
    if (effects.list) void qc.invalidateQueries({ queryKey: codexKeys.pages(campaignId) });
    if (effects.handouts) void qc.invalidateQueries({ queryKey: codexKeys.handouts(campaignId) });
    if (effects.runs) void qc.invalidateQueries({ queryKey: codexKeys.runs(campaignId) });
    if (effects.calendar) void qc.invalidateQueries({ queryKey: codexKeys.calendar(campaignId) });
  }, [campaignId, events, qc]);
}
