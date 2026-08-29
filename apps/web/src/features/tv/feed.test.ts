import { describe, expect, it } from 'vitest';
import type {
  Combatant,
  CombatantMonitors,
  Encounter,
  Visibility,
  WsEvent,
} from '@safehouse/contracts';
import {
  DEFAULT_TV_CONTROLS,
  isEncounterLive,
  latestMoment,
  momentDrama,
  tvControls,
  tvIngameDate,
  tvMoments,
  tvRibbon,
  tvScene,
  tvTakeover,
  TV_MOMENT_CAP,
} from './feed.js';

let nextId = 0;

function evt(type: string, payload: unknown, visibility: Visibility = 'public'): WsEvent {
  nextId += 1;
  return { id: nextId, type, payload, visibility, ts: '2076-05-12T21:00:00.000Z' };
}

function rollEvent(over: Record<string, unknown> = {}, visibility: Visibility = 'public'): WsEvent {
  return evt(
    'roll.created',
    {
      actorName: 'Wisp',
      request: { pool: 6, meta: { label: 'Perception' } },
      result: { faces: [5, 6, 2, 1, 4, 5], hits: 3, ones: 1, glitch: 'none', limitedHits: 3 },
      ...over,
    },
    visibility,
  );
}

function mon(physical = 0, stun = 0): CombatantMonitors {
  return {
    physical: { max: 10, filled: physical },
    stun: { max: 10, filled: stun },
    overflow: { max: 3, filled: 0 },
  };
}

function combatant(over: Partial<Combatant> & { id: string }): Combatant {
  return {
    encounterId: 'enc1',
    source: 'manual',
    name: over.id,
    initBase: 8,
    initDice: 1,
    initScore: 10,
    initKind: 'physical',
    monitors: mon(),
    effects: [],
    visibility: 'public',
    actedThisPass: false,
    ...over,
  };
}

function encounter(combatants: Combatant[], over: Partial<Encounter> = {}): Encounter {
  return {
    id: 'enc1',
    campaignId: 'c1',
    name: 'Alley ambush',
    state: 'live',
    turn: 1,
    pass: 1,
    combatants,
    ...over,
  };
}

describe('tvMoments', () => {
  it('takes public rolls only — the TV is the least private screen at the table', () => {
    const moments = tvMoments([rollEvent(), rollEvent({}, 'gm'), rollEvent({}, 'gm_owner')]);
    expect(moments).toHaveLength(1);
    expect(moments[0]?.actorName).toBe('Wisp');
    expect(moments[0]?.label).toBe('Perception');
  });

  it('ignores events that are not rolls', () => {
    expect(tvMoments([evt('token.moved', { tokenId: 't1' }), evt('log.posted', { text: 'hi' })])).toEqual([]);
  });

  it('caps the buffer so a six-hour session cannot grow it', () => {
    const events = Array.from({ length: TV_MOMENT_CAP + 25 }, () => rollEvent());
    const moments = tvMoments(events);
    expect(moments).toHaveLength(TV_MOMENT_CAP);
    // Newest kept, oldest dropped.
    expect(moments[moments.length - 1]?.id).toBe(events[events.length - 1]?.id);
  });

  it('honours a custom cap', () => {
    expect(tvMoments([rollEvent(), rollEvent(), rollEvent()], 2)).toHaveLength(2);
  });
});

describe('latestMoment', () => {
  it('returns the newest public roll', () => {
    const older = rollEvent();
    const newest = rollEvent({ actorName: 'Nine' });
    expect(latestMoment([older, newest])?.actorName).toBe('Nine');
  });

  it('is null with nothing to show', () => {
    expect(latestMoment([])).toBeNull();
    expect(latestMoment([evt('log.posted', { text: 'hi' })])).toBeNull();
  });
});

describe('momentDrama', () => {
  const drama = (over: Record<string, unknown>) => {
    const m = latestMoment([rollEvent(over)]);
    expect(m).not.toBeNull();
    return momentDrama(m!);
  };

  it('escalates critical glitches above ordinary ones', () => {
    expect(
      drama({ result: { faces: [1, 1, 1, 2], hits: 0, ones: 3, glitch: 'critical', limitedHits: 0 } }),
    ).toBe('critical');
    expect(
      drama({ result: { faces: [1, 1, 1, 5], hits: 1, ones: 3, glitch: 'glitch', limitedHits: 1 } }),
    ).toBe('glitch');
  });

  it('gives edge its own flavour', () => {
    expect(drama({ edgeAction: 'push_pre' })).toBe('edge');
    expect(drama({ request: { pool: 6, meta: { burnEdge: true } } })).toBe('edge');
  });

  it('leaves a plain roll plain', () => {
    expect(drama({})).toBe('none');
  });
});

describe('tvTakeover', () => {
  it('picks the newest public reveal', () => {
    const t = tvTakeover([
      evt('handout.revealed', { title: 'Old memo' }),
      evt('wiki.revealed', { title: 'Ares Macrotechnology' }),
    ]);
    expect(t).toMatchObject({ kind: 'codex', title: 'Ares Macrotechnology' });
  });

  it('carries body text and the attachment placeholder id', () => {
    const t = tvTakeover([
      evt('handout.revealed', { name: 'Datachip', text: 'A single line of code.', attachmentId: 'a1b2c3d4e5' }),
    ]);
    expect(t?.title).toBe('Datachip');
    expect(t?.body).toBe('A single line of code.');
    expect(t?.attachmentId).toBe('a1b2c3d4e5');
  });

  it('never shows a GM-only reveal', () => {
    expect(tvTakeover([evt('handout.revealed', { title: 'Secret' }, 'gm')])).toBeNull();
  });

  /**
   * The real `handout.revealed` payload (`plugins/codex.ts`) names the page
   * `pageTitle` and the caption `note` — neither of which this read, so every
   * handout the GM revealed came up on the wall-sized screen as "Handout".
   */
  it('reads the names the server actually emits for a handout', () => {
    const t = tvTakeover([
      evt('handout.revealed', {
        attachmentId: 'att_9',
        url: '/files/att_9',
        mime: 'image/png',
        pageTitle: 'Pier 23 survey',
        note: 'Someone has circled the east door.',
      }),
    ]);
    expect(t).toMatchObject({
      kind: 'handout',
      title: 'Pier 23 survey',
      body: 'Someone has circled the east door.',
      attachmentId: 'att_9',
    });
  });

  it('is null with no reveals', () => {
    expect(tvTakeover([rollEvent()])).toBeNull();
  });
});

describe('idle card sources', () => {
  it('reads the newest scene activation', () => {
    expect(
      tvScene([
        evt('scene.activated', { sceneId: 's1', name: 'Docks' }),
        evt('scene.activated', { scene: { id: 's2', name: 'Rooftop' } }),
      ]),
    ).toEqual({ id: 's2', name: 'Rooftop' });
  });

  it('reads the newest in-game date', () => {
    expect(
      tvIngameDate([
        evt('clock.advanced', { ingameDate: '2076-05-12' }),
        evt('clock.advanced', { date: '2076-05-14' }),
      ]),
    ).toBe('2076-05-14');
  });

  it('returns null when the campaign has said nothing yet', () => {
    expect(tvScene([])).toBeNull();
    expect(tvIngameDate([])).toBeNull();
  });
});

describe('tvRibbon', () => {
  it('orders by score and flags the acting combatant', () => {
    const rows = tvRibbon(
      encounter([
        combatant({ id: 'slow', initScore: 6 }),
        combatant({ id: 'fast', initScore: 21 }),
      ]),
    );
    expect(rows.map((r) => r.id)).toEqual(['fast', 'slow']);
    expect(rows[0]?.acting).toBe(true);
    expect(rows[0]?.order).toBe(1);
  });

  it('respects an explicitly set active combatant', () => {
    const rows = tvRibbon(
      encounter([combatant({ id: 'a', initScore: 21 }), combatant({ id: 'b', initScore: 6 })], {
        activeCombatantId: 'b',
      }),
    );
    expect(rows.find((r) => r.acting)?.id).toBe('b');
  });

  it('leaves GM-hidden combatants off the shared screen', () => {
    const rows = tvRibbon(
      encounter([
        combatant({ id: 'seen', initScore: 12 }),
        combatant({ id: 'ambusher', initScore: 30, visibility: 'gm' }),
      ]),
    );
    expect(rows.map((r) => r.id)).toEqual(['seen']);
  });

  it('publishes a coarse condition band, never boxes', () => {
    const rows = tvRibbon(encounter([combatant({ id: 'hurt', monitors: mon(8, 0) })]));
    expect(rows[0]?.band).toBe('bloodied');
  });

  it('caps its width', () => {
    const rows = tvRibbon(
      encounter(Array.from({ length: 18 }, (_, i) => combatant({ id: `c${i}`, initScore: 20 - i }))),
      4,
    );
    expect(rows).toHaveLength(4);
  });

  it('still lists everyone once the pass is spent', () => {
    const rows = tvRibbon(encounter([combatant({ id: 'spent', initScore: 0 })]));
    expect(rows.map((r) => r.id)).toEqual(['spent']);
  });

  it('is empty without an encounter', () => {
    expect(tvRibbon(null)).toEqual([]);
  });
});

describe('isEncounterLive', () => {
  it('needs a live encounter with combatants', () => {
    expect(isEncounterLive(null)).toBe(false);
    expect(isEncounterLive(encounter([]))).toBe(false);
    expect(isEncounterLive(encounter([combatant({ id: 'a' })], { state: 'prep' }))).toBe(false);
    expect(isEncounterLive(encounter([combatant({ id: 'a' })], { state: 'done' }))).toBe(false);
    expect(isEncounterLive(encounter([combatant({ id: 'a' })]))).toBe(true);
  });
});

describe('tvControls', () => {
  it('defaults to showing everything', () => {
    expect(tvControls([])).toEqual(DEFAULT_TV_CONTROLS);
  });

  it('follows the newest display steering event', () => {
    expect(tvControls([evt('display.updated', { blank: true })])).toEqual({ blank: true, ribbon: true });
    expect(
      tvControls([evt('display.updated', { blank: true }), evt('display.updated', { ribbon: false })]),
    ).toEqual({ blank: false, ribbon: false });
  });
});
