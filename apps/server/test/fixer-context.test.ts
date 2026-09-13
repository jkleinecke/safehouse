/**
 * The where-line (fixer/context.ts): what the dock stamps on a chat turn
 * becomes one snapshot line the model can act on, ids included.
 */
import { describe, expect, it } from 'vitest';
import { AiContextSchema, joinSnapshot, whereTheGmIs } from '../src/fixer/context.js';

describe('whereTheGmIs', () => {
  it('says nothing for nothing', () => {
    expect(whereTheGmIs(undefined)).toBeNull();
    expect(whereTheGmIs({})).toBeNull();
  });

  it('names the scene, the floor and the selected token with their ids', () => {
    const line = whereTheGmIs({
      screen: 'map',
      sceneId: 'sc-1',
      sceneName: 'Pier 23 Warehouse',
      sceneLive: false,
      level: 1,
      levelName: 'Catwalk',
      selectedTokenId: 'tk-9',
      selectedTokenName: 'Ratchet',
      selectedTokenSource: 'npc_template',
    });
    expect(line).toContain('on the Map');
    expect(line).toContain('scene "Pier 23 Warehouse" [sc-1], staged, not on the table — floor "Catwalk"');
    expect(line).toContain('an NPC token selected: Ratchet [tk-9]');
    expect(line).toContain('"This", "here" and "them"');
  });

  it('carries a codex page and a sheet', () => {
    expect(whereTheGmIs({ screen: 'codex', pageId: 'p1', pageTitle: 'The Rusting Crown' })).toContain(
      'reading the codex page "The Rusting Crown" [p1]',
    );
    expect(whereTheGmIs({ screen: 'sheet', characterId: 'c1', characterName: 'Whisper' })).toContain(
      'on the sheet of Whisper [c1]',
    );
  });

  it('joins with the live snapshot, or stands alone without a session', () => {
    expect(joinSnapshot(null, null)).toBeNull();
    expect(joinSnapshot('SNAP', null)).toBe('SNAP');
    expect(joinSnapshot(null, 'WHERE')).toBe('WHERE');
    expect(joinSnapshot('SNAP', 'WHERE')).toBe('SNAP\nWHERE');
  });

  it('rejects labels that could not have come from a screen', () => {
    expect(AiContextSchema.safeParse({ sceneName: 'x'.repeat(121) }).success).toBe(false);
    expect(AiContextSchema.safeParse({ screen: 'kitchen' }).success).toBe(false);
    expect(AiContextSchema.safeParse({ screen: 'map', level: 2 }).success).toBe(true);
  });
});
