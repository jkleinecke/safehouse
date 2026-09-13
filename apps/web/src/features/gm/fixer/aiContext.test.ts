/**
 * The dock's idea of where the GM is (aiContext.ts): which screen a path
 * is, which ids it carries, which chips that earns, and the header line.
 */
import { describe, expect, it } from 'vitest';
import { contextChips, contextLine, idsOf, screenOf } from './aiContext.js';

const C = '/c/ed12d779-0b7d-4134-b687-00b4cc062ec3';

describe('screenOf and idsOf', () => {
  it('reads the screen and the ids off the path', () => {
    expect(screenOf(`${C}/grid`)).toBe('map');
    expect(screenOf(`${C}/codex/page-1`)).toBe('codex');
    expect(screenOf(`${C}/sheet/char-1`)).toBe('sheet');
    expect(screenOf(`${C}/gm/sessions`)).toBe('sessions');
    expect(screenOf(`${C}/gm/runs`)).toBe('runs');
    expect(screenOf(`${C}/gm/fixer`)).toBe('other');
    expect(idsOf(`${C}/codex/page-1`)).toEqual({ pageId: 'page-1' });
    expect(idsOf(`${C}/sheet/char-1`)).toEqual({ characterId: 'char-1' });
    expect(idsOf(`${C}/grid`)).toEqual({});
  });
});

describe('contextChips', () => {
  const ids = (chips: ReturnType<typeof contextChips>) => chips.map((c) => c.id);

  it('offers the map verbs on the map, and more with a token selected', () => {
    expect(ids(contextChips({ screen: 'map', sceneId: 's1', sceneName: 'Pier 23' }))).toEqual(['read-map', 'reveal', 'rules']);
    const chips = contextChips({ screen: 'map', sceneId: 's1', selectedTokenId: 't1', selectedTokenName: 'Ratchet' });
    expect(ids(chips)).toEqual(['read-map', 'reveal', 'threat', 'rules']);
    expect(chips.find((c) => c.id === 'threat')!.text).toContain('[t1]');
  });

  it('offers the old codex panel verbs on a page, with the page id for the tool', () => {
    const chips = contextChips({ screen: 'codex', pageId: 'p1', pageTitle: 'The Rusting Crown' });
    expect(ids(chips)).toEqual(['describe', 'expand', 'spoilers', 'rules']);
    expect(chips[0]!.send).toBe(true);
    expect(chips[0]!.text).toContain('draft_wiki_page once');
    // "Expand:" wants the GM's words after it, so it stays in the box.
    expect(chips[1]!.send).toBe(false);
    expect(chips[1]!.text.endsWith(': ')).toBe(true);
  });

  it('offers the recap on the sessions screen and rules everywhere', () => {
    expect(ids(contextChips({ screen: 'sessions' }))).toEqual(['recap', 'rules']);
    expect(ids(contextChips({ screen: 'other' }))).toEqual(['rules']);
  });
});

describe('contextLine', () => {
  it('is the scene, floor, token, page and sheet in one line — or nothing', () => {
    expect(contextLine({})).toBeNull();
    expect(contextLine({ sceneName: 'Pier 23', sceneLive: false, levelName: 'Catwalk', selectedTokenName: 'Whisper' })).toBe(
      'Pier 23 (staged) · Catwalk · Whisper selected',
    );
    expect(contextLine({ pageTitle: 'Dockside' })).toBe('page: Dockside');
  });
});
