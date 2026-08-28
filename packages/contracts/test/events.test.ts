import { describe, expect, it } from 'vitest';
import {
  WsEventSchema,
  WsEphemeralSchema,
  WsCommandSchema,
  WS_EVENT_TYPES,
  WS_EPHEMERAL_TYPES,
  WS_COMMANDS,
  ApiErrorSchema,
} from '../src/index.js';

describe('WsEventSchema', () => {
  it('round-trips a persisted event', () => {
    const input = {
      id: 42,
      type: 'roll.created',
      payload: { rollId: 'r1', hits: 4 },
      visibility: 'gm_owner',
      ownerUserId: 'usr_2',
      ts: '2076-05-12T20:31:00.000Z',
    };
    const once = WsEventSchema.parse(input);
    expect(WsEventSchema.parse(once)).toEqual(once);
  });

  it('catalog covers the §11 event names', () => {
    for (const t of ['roll.created', 'token.moved', 'fog.updated', 'scene.activated', 'encounter.updated', 'combatant.damaged']) {
      expect(WS_EVENT_TYPES).toContain(t);
    }
    expect(WS_EPHEMERAL_TYPES).toContain('token.dragging');
    expect(WS_EPHEMERAL_TYPES).toContain('ping');
  });

  it('ephemeral messages require the ephemeral flag', () => {
    expect(
      WsEphemeralSchema.parse({ type: 'ping', payload: { x: 1, y: 2 }, ephemeral: true }).ephemeral,
    ).toBe(true);
    expect(WsEphemeralSchema.safeParse({ type: 'ping', payload: {} }).success).toBe(false);
  });
});

describe('WsCommandSchema (client→server)', () => {
  it('parses every command kind', () => {
    const cmds = [
      { cmd: 'roll.request', pool: 9, actor: { characterId: 'chr_1' } },
      { cmd: 'token.move', tokenId: 'tok_1', x: 4, y: 7 },
      { cmd: 'token.drag', tokenId: 'tok_1', x: 4.5, y: 6.2 },
      { cmd: 'fog.reveal', sceneId: 'scn_1', regionId: 'east-wing', announce: true },
      { cmd: 'encounter.advance', encounterId: 'enc_1' },
      { cmd: 'damage.apply', combatantId: 'cbt_3', monitor: 'stun', boxes: 4 },
      { cmd: 'ping', sceneId: 'scn_1', x: 10, y: 12 },
    ];
    for (const c of cmds) {
      const parsed = WsCommandSchema.parse(c);
      expect(parsed.cmd).toBe(c.cmd);
      expect(WsCommandSchema.parse(parsed)).toEqual(parsed);
    }
    expect(WS_COMMANDS).toHaveLength(7);
  });

  it('fog.reveal defaults op to reveal and accepts define with a region', () => {
    const reveal = WsCommandSchema.parse({ cmd: 'fog.reveal', sceneId: 's1', regionId: 'lab' });
    expect(reveal).toMatchObject({ op: 'reveal' });
    const define = WsCommandSchema.parse({
      cmd: 'fog.reveal',
      sceneId: 's1',
      op: 'define',
      region: {
        id: 'lab',
        name: 'the lab',
        polygon: [
          { x: 0, y: 0 },
          { x: 4, y: 0 },
          { x: 4, y: 3 },
        ],
      },
    });
    expect(define.cmd === 'fog.reveal' && define.region?.name).toBe('the lab');
  });

  it('rejects unknown commands and malformed payloads', () => {
    expect(WsCommandSchema.safeParse({ cmd: 'token.teleport', tokenId: 't', x: 0, y: 0 }).success).toBe(false);
    expect(WsCommandSchema.safeParse({ cmd: 'damage.apply', combatantId: 'c', monitor: 'matrix', boxes: 1 }).success).toBe(false);
    expect(WsCommandSchema.safeParse({ cmd: 'token.move', tokenId: 't', x: 'four', y: 0 }).success).toBe(false);
  });
});

describe('ApiErrorSchema', () => {
  it('round-trips the error envelope', () => {
    const err = ApiErrorSchema.parse({
      error: { code: 'not_found', message: 'no such scene', details: { id: 'scn_9' } },
    });
    expect(ApiErrorSchema.parse(err)).toEqual(err);
    expect(ApiErrorSchema.safeParse({ code: 'bare' }).success).toBe(false);
  });
});
