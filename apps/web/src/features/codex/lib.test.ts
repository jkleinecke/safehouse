import { describe, expect, it } from 'vitest';
import type { Visibility } from '@safehouse/contracts';
import {
  collectTags,
  contactRating,
  daysBetween,
  favourBalance,
  favourLabel,
  filterPages,
  groupByDate,
  inheritedSecrets,
  isUpcoming,
  nextObjectiveState,
  pinSectionsForReveal,
  payoutSummary,
  presentKinds,
  relativeToClock,
  runProgress,
  visibilityLabel,
  visibilityTone,
  type PageListItem,
  type SectionVisibility,
} from './lib.js';

function page(
  id: string,
  kind: string,
  title: string,
  tags: string[] = [],
  visibility: Visibility = 'gm',
): PageListItem {
  return { id, kind, title, tags, visibility, updatedAt: '2076-05-12T00:00:00Z' };
}

const PAGES: PageListItem[] = [
  page('1', 'npc', 'The Johnson', ['corp', 'seattle']),
  page('2', 'location', 'Dock 9', ['seattle'], 'public'),
  page('3', 'faction', 'Renraku', ['corp', 'Seattle']),
  page('4', 'lore', 'The Crash', []),
];

describe('filterPages', () => {
  it('narrows by kind', () => {
    expect(filterPages(PAGES, { kind: 'npc' }).map((p) => p.id)).toEqual(['1']);
  });

  it('narrows by tag, case-insensitively', () => {
    expect(filterPages(PAGES, { tag: 'SEATTLE' }).map((p) => p.id)).toEqual(['1', '2', '3']);
  });

  it('searches titles and tags', () => {
    expect(filterPages(PAGES, { q: 'john' }).map((p) => p.id)).toEqual(['1']);
    expect(filterPages(PAGES, { q: 'corp' }).map((p) => p.id)).toEqual(['1', '3']);
  });

  it('combines filters and returns everything when empty', () => {
    expect(filterPages(PAGES, { kind: 'faction', tag: 'corp' }).map((p) => p.id)).toEqual(['3']);
    expect(filterPages(PAGES, {}).length).toBe(4);
    expect(filterPages(PAGES, { q: '   ' }).length).toBe(4);
  });
});

describe('collectTags', () => {
  it('counts tags case-insensitively, most used first, keeping first-seen casing', () => {
    expect(collectTags(PAGES)).toEqual([
      { tag: 'seattle', count: 3 },
      { tag: 'corp', count: 2 },
    ]);
  });

  it('is empty for untagged pages', () => {
    expect(collectTags([page('9', 'lore', 'X')])).toEqual([]);
  });
});

describe('presentKinds', () => {
  it('keeps the canonical order and appends anything unexpected', () => {
    const withDraft = [...PAGES, page('5', 'page', 'Fixer draft')];
    expect(presentKinds(withDraft)).toEqual(['npc', 'faction', 'location', 'lore', 'page']);
  });
});

describe('visibility presentation', () => {
  it('names the three modes in table language (FR5.2)', () => {
    expect(visibilityLabel('public')).toBe('shared');
    expect(visibilityLabel('gm')).toBe('GM only');
    expect(visibilityLabel('gm_owner')).toBe('per player');
  });

  it('gives secrets a loud tone and shared pages a calm one', () => {
    expect(visibilityTone('public')).toContain('ok');
    expect(visibilityTone('gm')).toContain('magenta');
    expect(visibilityTone('gm_owner')).toContain('warn');
  });
});

describe('section visibility — the page-reveal trap (FR5.2, Principle 4)', () => {
  const sections: SectionVisibility[] = [
    { id: 'cover-story', heading: 'Cover story', visibility: 'public', explicit: true },
    { id: 'what-he-wants', heading: 'What he actually wants', visibility: 'gm', explicit: false },
    { id: 'the-price', heading: 'The price', visibility: 'gm', explicit: true },
  ];

  it('finds the sections a page-level reveal would publish by accident', () => {
    expect(inheritedSecrets(sections).map((s) => s.id)).toEqual(['what-he-wants']);
  });

  it('does not flag an inherited section that is already shared', () => {
    expect(
      inheritedSecrets([
        { id: 'a', heading: 'A', visibility: 'public', explicit: false },
      ]),
    ).toEqual([]);
  });

  it('pins every inherited secret at its CURRENT visibility, keeping explicit ones', () => {
    const patch = pinSectionsForReveal(sections);
    expect(patch).not.toBeNull();
    expect(patch?.map((s) => [s.id, s.visibility])).toEqual([
      ['cover-story', 'public'],
      ['the-price', 'gm'],
      ['what-he-wants', 'gm'],
    ]);
  });

  it('carries a per-player audience through the pin, dropping empty ones', () => {
    const patch = pinSectionsForReveal([
      { id: 'a', heading: 'A', visibility: 'gm_owner', audience: ['u1'], explicit: true },
      { id: 'b', heading: 'B', visibility: 'gm', audience: [], explicit: false },
    ]);
    expect(patch?.[0]).toEqual({ id: 'a', heading: 'A', visibility: 'gm_owner', audience: ['u1'] });
    expect(patch?.[1]).toEqual({ id: 'b', heading: 'B', visibility: 'gm' });
  });

  it('writes nothing when there is no secret to protect', () => {
    expect(pinSectionsForReveal([])).toBeNull();
    expect(
      pinSectionsForReveal([{ id: 'a', heading: 'A', visibility: 'gm', explicit: true }]),
    ).toBeNull();
  });
});

describe('runProgress (FR5.5)', () => {
  it('counts objective states and settled percentage', () => {
    expect(
      runProgress([
        { id: 'a', text: 'Get in', state: 'done' },
        { id: 'b', text: 'Get the data', state: 'done' },
        { id: 'c', text: 'Leave no trace', state: 'failed' },
        { id: 'd', text: 'Get out', state: 'open' },
      ]),
    ).toEqual({ total: 4, done: 2, failed: 1, open: 1, pct: 75 });
  });

  it('is zero-safe for a run with no objectives yet', () => {
    expect(runProgress([])).toEqual({ total: 0, done: 0, failed: 0, open: 0, pct: 0 });
  });
});

describe('payoutSummary', () => {
  it('formats nuyen and karma, omitting what is not agreed', () => {
    expect(payoutSummary({ nuyen: 12000, karma: 6 })).toBe('12,000¥ · 6 karma');
    expect(payoutSummary({ nuyen: 12000 })).toBe('12,000¥');
    expect(payoutSummary({ karma: 6 })).toBe('6 karma');
    expect(payoutSummary({})).toBe('');
    expect(payoutSummary({ nuyen: 0, karma: 0 })).toBe('');
  });
});

describe('nextObjectiveState', () => {
  it('cycles open → done → failed → open', () => {
    expect(nextObjectiveState('open')).toBe('done');
    expect(nextObjectiveState('done')).toBe('failed');
    expect(nextObjectiveState('failed')).toBe('open');
    expect(nextObjectiveState('nonsense')).toBe('open');
  });
});

describe('calendar helpers (FR5.7)', () => {
  const entries = [
    { id: 'a', date: '2076-05-14' },
    { id: 'b', date: '2076-05-12' },
    { id: 'c', date: '2076-05-14' },
  ];

  it('buckets by date, ascending', () => {
    expect(groupByDate(entries)).toEqual([
      { date: '2076-05-12', entries: [{ id: 'b', date: '2076-05-12' }] },
      {
        date: '2076-05-14',
        entries: [
          { id: 'a', date: '2076-05-14' },
          { id: 'c', date: '2076-05-14' },
        ],
      },
    ]);
  });

  it('counts whole days across month boundaries', () => {
    expect(daysBetween('2076-05-12', '2076-05-19')).toBe(7);
    expect(daysBetween('2076-05-31', '2076-06-01')).toBe(1);
    expect(daysBetween('2076-05-12', '2076-05-10')).toBe(-2);
    expect(daysBetween('nope', '2076-05-10')).toBeNull();
  });

  it('phrases dates against the in-game clock', () => {
    expect(relativeToClock('2076-05-12', '2076-05-12')).toBe('today');
    expect(relativeToClock('2076-05-13', '2076-05-12')).toBe('tomorrow');
    expect(relativeToClock('2076-05-11', '2076-05-12')).toBe('yesterday');
    expect(relativeToClock('2076-05-15', '2076-05-12')).toBe('in 3 days');
    expect(relativeToClock('2076-05-09', '2076-05-12')).toBe('3 days ago');
    expect(relativeToClock('2076-05-09', null)).toBe('');
  });

  it('knows what is still ahead (rent due, next meet)', () => {
    expect(isUpcoming('2076-05-12', '2076-05-12')).toBe(true);
    expect(isUpcoming('2076-05-13', '2076-05-12')).toBe(true);
    expect(isUpcoming('2076-05-11', '2076-05-12')).toBe(false);
    expect(isUpcoming('2076-05-11', null)).toBe(false);
  });
});

describe('contacts (FR5.8)', () => {
  it('nets favours from the runner’s side', () => {
    expect(favourBalance({ owed: 3, owing: 1 })).toBe(2);
    expect(favourLabel({ owed: 3, owing: 1 })).toBe('owes you 2');
    expect(favourLabel({ owed: 0, owing: 2 })).toBe('you owe 2');
    expect(favourLabel({ owed: 0, owing: 0 })).toBe('square');
    expect(favourLabel({ owed: 2, owing: 2 })).toBe('even');
  });

  it('prints the SR5 connection/loyalty shorthand', () => {
    expect(contactRating(4, 3)).toBe('C4/L3');
  });
});
