/**
 * The Edge actions the sheet offers (FR2.3/FR4.4) — chiefly the Close Call
 * offer, which has to appear the instant a glitch lands and disappear the
 * instant somebody pays for it.
 */
import { describe, expect, it } from 'vitest';
import type { WsEvent } from '@safehouse/contracts';
import { canSeizeOrBlitz, findCloseCallOffer } from './edgeActions.js';

let nextId = 0;

function rollEvent(opts: {
  characterId?: string;
  glitch: 'none' | 'glitch' | 'critical';
  title?: string;
}): WsEvent {
  nextId += 1;
  return {
    id: nextId,
    type: 'roll.created',
    ts: new Date(nextId * 1000).toISOString(),
    visibility: 'public',
    payload: {
      id: `roll-${nextId}`,
      glitch: opts.glitch,
      actor: opts.characterId ? { characterId: opts.characterId } : { gm: true },
      request: { meta: { title: opts.title ?? 'a roll' } },
    },
  };
}

function closeCallLog(rollId: string): WsEvent {
  nextId += 1;
  return {
    id: nextId,
    type: 'log.posted',
    ts: new Date(nextId * 1000).toISOString(),
    visibility: 'public',
    payload: {
      kind: 'edge',
      text: 'Jitter spends 1 Edge — Close Call: critical glitch negated (1/3 left)',
      edgeAction: 'close_call',
      rollId,
    },
  };
}

describe('Seize the Initiative / Blitz availability', () => {
  it('needs a point of Edge and a seat in a live encounter', () => {
    expect(canSeizeOrBlitz({ edgeCurrent: 2, combatantId: 'cmb-1' })).toBe(true);
    // Out of combat there is no initiative order to move.
    expect(canSeizeOrBlitz({ edgeCurrent: 2, combatantId: null })).toBe(false);
    expect(canSeizeOrBlitz({ edgeCurrent: 0, combatantId: 'cmb-1' })).toBe(false);
  });
});

describe('the Close Call offer', () => {
  it('offers nothing when nothing glitched', () => {
    const events = [rollEvent({ characterId: 'me', glitch: 'none' })];
    expect(findCloseCallOffer(events, 'me')).toBeNull();
  });

  it('offers the critical glitch this character just rolled', () => {
    const events = [
      rollEvent({ characterId: 'me', glitch: 'none' }),
      rollEvent({ characterId: 'me', glitch: 'critical', title: 'Ares Predator — FA' }),
    ];
    const offer = findCloseCallOffer(events, 'me');
    expect(offer).toMatchObject({ glitch: 'critical', title: 'Ares Predator — FA' });
    expect(offer?.rollId).toBe((events[1]?.payload as { id: string }).id);
  });

  it('never offers on someone else’s glitch', () => {
    const events = [rollEvent({ characterId: 'someone-else', glitch: 'critical' })];
    expect(findCloseCallOffer(events, 'me')).toBeNull();
  });

  it('ignores a GM roll that names no character', () => {
    const events = [rollEvent({ glitch: 'critical' })];
    expect(findCloseCallOffer(events, 'me')).toBeNull();
  });

  it('takes the most recent glitch when there are several', () => {
    const first = rollEvent({ characterId: 'me', glitch: 'glitch', title: 'sneaking' });
    const second = rollEvent({ characterId: 'me', glitch: 'critical', title: 'pistols' });
    const offer = findCloseCallOffer([first, second], 'me');
    expect(offer?.title).toBe('pistols');
  });

  it('withdraws the offer once the Edge has been spent on it', () => {
    const glitched = rollEvent({ characterId: 'me', glitch: 'critical' });
    const rollId = (glitched.payload as { id: string }).id;
    const events = [glitched, closeCallLog(rollId)];
    expect(findCloseCallOffer(events, 'me')).toBeNull();
  });

  it('withdraws the offer when the player waves it away', () => {
    const glitched = rollEvent({ characterId: 'me', glitch: 'critical' });
    const rollId = (glitched.payload as { id: string }).id;
    expect(findCloseCallOffer([glitched], 'me', new Set([rollId]))).toBeNull();
  });

  it('falls back through to an older, unanswered glitch', () => {
    const older = rollEvent({ characterId: 'me', glitch: 'glitch', title: 'first' });
    const newer = rollEvent({ characterId: 'me', glitch: 'critical', title: 'second' });
    const answered = closeCallLog((newer.payload as { id: string }).id);
    const offer = findCloseCallOffer([older, newer, answered], 'me');
    expect(offer?.title).toBe('first');
  });
});
