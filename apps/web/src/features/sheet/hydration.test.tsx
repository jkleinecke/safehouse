/**
 * LIVE-1 for the sheet.
 *
 * The web UI used to render only the WebSocket events it received while
 * mounted, so a reload mid-session showed an empty world. This suite drives
 * the sheet's data path with **zero WebSocket traffic** — nothing but the two
 * REST bodies the server actually returns — and asserts the view comes up
 * fully populated: the alias, the wounds the tracker is holding, the pools
 * with the scene already in them, and the encounter seat that makes the Edge
 * actions offerable.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { SheetV1, WsEvent } from '@safehouse/contracts';
import { SheetV1Schema } from '@safehouse/contracts';
import { deriveCharacter } from '@safehouse/rules';
import { HYDRATE_ON_MOUNT, normalizeCharacter, normalizeDerivedView } from './api.js';
import { touchesCharacter } from './useSheetLive.js';
import IdentityStrip from './components/IdentityStrip.js';

function makeSheet(): SheetV1 {
  return SheetV1Schema.parse({
    v: 1,
    identity: { alias: 'Kestrel Vane', metatype: 'human' },
    attributes: {
      bod: 4,
      agi: 5,
      rea: 4,
      str: 3,
      wil: 5,
      log: 3,
      int: 4,
      cha: 4,
      edg: { max: 4, current: 2 },
      ess: 6,
      mag: 0,
      res: 0,
    },
    skills: [{ id: 'perception', rating: 2, attr: 'int' }],
  } satisfies Record<string, unknown>);
}

const SHEET = makeSheet();

/** `GET /api/characters/:id` — the plugin's `characterDto`. */
const CHARACTER_BODY = {
  id: 'char-1',
  campaignId: 'camp-1',
  ownerUserId: 'user-9',
  name: 'Kestrel Vane',
  sheet: SHEET,
  play: { monitors: { physical: 3, stun: 1 }, edgeBurned: 1 },
  balances: { karma: 12, nuyen: 4200 },
  sheetVersion: 4,
};

/** `GET /api/characters/:id/derived` — `services/characters.ts DerivedView`. */
const DERIVED_BODY = {
  characterId: 'char-1',
  name: 'Kestrel Vane',
  derived: deriveCharacter(SHEET, {
    situational: [
      {
        id: 'env.scene',
        source: { kind: 'scene' },
        target: 'pool.all',
        op: 'add',
        value: -1,
        active: true,
        note: 'environment: light 1 → light (-1)',
      },
    ],
    wounds: { physical: 3, stun: 1 },
  }),
  wounds: { physical: 3, stun: 1, overflow: 0 },
  woundSource: 'combatant',
  encounterId: 'enc-1',
  combatantId: 'cmb-7',
  edge: { max: 4, current: 2, burned: 1 },
  situational: [{ id: 'env.scene', source: { kind: 'scene' }, target: 'pool.all', op: 'add', value: -1, active: true }],
  activeSceneId: 'scene-3',
  sustained: [],
  recoil: {},
  ammo: {},
  overrides: [],
};

describe('every sheet query refetches on mount and on reconnect', () => {
  it('never serves a stale cache to a phone that just reloaded', () => {
    expect(HYDRATE_ON_MOUNT).toEqual({
      staleTime: 0,
      refetchOnMount: 'always',
      refetchOnReconnect: 'always',
    });
  });
});

describe('REST alone populates the sheet', () => {
  const character = normalizeCharacter(CHARACTER_BODY);
  const view = normalizeDerivedView(DERIVED_BODY);

  it('reads the character record off the wire', () => {
    expect(character).toMatchObject({
      id: 'char-1',
      name: 'Kestrel Vane',
      // Filled boxes are live-play state, not sheet state (FR3.4).
      condition: { physical: 3, stun: 1 },
      edgeBurned: 1,
      balances: { karma: 12, nuyen: 4200 },
    });
  });

  it('reads the live-play picture, including the encounter seat', () => {
    expect(view).not.toBeNull();
    expect(view).toMatchObject({
      combatantId: 'cmb-7',
      encounterId: 'enc-1',
      activeSceneId: 'scene-3',
      authoritative: true,
      wounds: { physical: 3, stun: 1, overflow: 0 },
    });
    // The scene the server applied is reported back, so the dialog can show
    // it as context instead of adding it again (LIVE-2).
    expect(view?.situational).toHaveLength(1);
  });

  it('renders a populated strip with no events ever having arrived', () => {
    const html = renderToStaticMarkup(
      <IdentityStrip
        character={character}
        derived={view!.derived}
        onCondition={() => {}}
        onEdgeOp={() => {}}
        overrideFor={() => ({ set: () => {}, clear: () => {} })}
        edgeActions={{ combatantId: view!.combatantId, onAction: () => {} }}
      />,
    );
    expect(html).toContain('Kestrel Vane');
    // Wounds the TRACKER is holding, not the sheet's own zeros.
    expect(html).toContain('condition monitor, 3 of');
    expect(html).toContain('condition monitor, 1 of');
    // The encounter seat came from REST, so the Edge actions are already live.
    expect(html).toContain('Seize the Initiative');
    expect(html).toContain('Edge 2 of 4, 1 burned permanently');
  });

  it('falls back rather than throwing on a body it cannot read', () => {
    expect(normalizeDerivedView({ derived: { nonsense: true } })).toBeNull();
    expect(normalizeDerivedView(null)).toBeNull();
    // A bare DerivedCharacter (no envelope) still counts as authoritative.
    expect(normalizeDerivedView(DERIVED_BODY.derived)?.combatantId).toBeNull();
  });
});

describe('live events refine that state, they do not replace it', () => {
  function event(type: string, payload: unknown): WsEvent {
    return { id: 1, type, payload, visibility: 'public', ts: '2076-05-12T00:00:00.000Z' };
  }

  it('invalidates on an event that names this character', () => {
    expect(touchesCharacter(event('sheet.updated', { characterId: 'char-1' }), 'char-1')).toBe(true);
    expect(
      touchesCharacter(event('combatant.damaged', { combatant: { sourceId: 'char-1' } }), 'char-1'),
    ).toBe(true);
    expect(touchesCharacter(event('ledger.changed', { entry: { characterId: 'char-1' } }), 'char-1')).toBe(
      true,
    );
  });

  it('leaves another character’s event alone', () => {
    expect(touchesCharacter(event('sheet.updated', { characterId: 'other' }), 'char-1')).toBe(false);
  });

  it('re-reads conservatively when the payload names nobody', () => {
    expect(touchesCharacter(event('encounter.updated', { turn: 2 }), 'char-1')).toBe(true);
  });
});
