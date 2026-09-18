/**
 * The builds list and the doors into the builder (docs/CHARGEN.md §6
 * decision 3, §8.6 "Entry points"), rendered to static markup.
 *
 * Pinned: a player sees their builds with state chips and "start a new
 * runner"; the GM sees every build with its owner's name and a "waiting for
 * review" filter; an observer or the table TV is told there is nothing to
 * make. The entry controls — "build a runner" beside the Chummer import, the
 * player's home card, the console's "builds waiting" card — each appear only
 * for the role they are for. Invented runners and device names only.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { CharacterBuild, Role } from '@safehouse/contracts';
import { BuildListView, canDelete, type BuildListViewProps } from './BuildListPage.js';
import { buildKeys, type BuildList, type BuildRecord } from './api.js';
import { BuildRunnerButton, BuildsWaitingCard, PlayerBuildsCard } from './entry.js';
import { CAMPAIGN, PLAYER_ID, blankBuild, conceptBuild, recordOf } from './testing.js';

const session = vi.hoisted(() => ({ role: null as string | null }));
vi.mock('../../api/session.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/session.js')>();
  return {
    ...actual,
    getSession: () => (session.role ? { token: 't', role: session.role, campaignId: 'c1', userId: 'u-player' } : null),
  };
});
afterEach(() => {
  session.role = null;
});

const noop = () => undefined;

function row(id: string, build: CharacterBuild, over: Partial<BuildRecord> = {}): BuildRecord {
  return recordOf(build, { id, ...over });
}

const ROWS: BuildRecord[] = [
  row('b-draft', conceptBuild('muscle', 'Kestrel Vane'), { updatedAt: '2026-09-12T10:00:00.000Z' }),
  row('b-waiting', { ...conceptBuild('decker', 'Quill Harrow'), state: 'submitted' }, {
    state: 'submitted',
    ownerUserId: 'u-other',
    updatedAt: '2026-09-11T10:00:00.000Z',
  }),
];

function view(over: Partial<BuildListViewProps>): string {
  const p: BuildListViewProps = {
    campaignId: CAMPAIGN,
    role: 'player',
    userId: PLAYER_ID,
    builds: ROWS,
    loading: false,
    error: null,
    unreadable: 0,
    owners: new Map([
      [PLAYER_ID, 'Rin'],
      ['u-other', 'Tomas'],
    ]),
    filter: 'all',
    onFilter: noop,
    onCreate: noop,
    creating: false,
    createError: null,
    onDelete: noop,
    deletingId: null,
    deleteError: null,
    ...over,
  };
  return renderToStaticMarkup(
    <MemoryRouter>
      <BuildListView {...p} />
    </MemoryRouter>,
  );
}

describe('the builds list', () => {
  it('a player sees their builds with state chips, a way to resume, and "start a new runner"', () => {
    const html = view({ builds: [ROWS[0]!] });
    expect(html).toContain('data-build-row="b-draft"');
    expect(html).toContain(`href="/c/${CAMPAIGN}/build/b-draft"`);
    expect(html).toMatch(/data-testid="build-state-chip">draft</);
    expect(html).toMatch(/<button[^>]*>start a new runner<\/button>/);
    expect(html).toMatch(/>resume</);
    expect(html).not.toContain('data-filter=');
    expect(html).not.toContain('data-testid="build-owner"');
  });

  it('the GM sees every build with its owner, waiting ones first, and a review filter', () => {
    const html = view({ role: 'gm' });
    const order = [...html.matchAll(/data-build-row="([^"]+)"/g)].map((m) => m[1]);
    expect(order).toEqual(['b-waiting', 'b-draft']);
    expect(html).toContain('by Tomas');
    expect(html).toContain('by Rin');
    expect(html).toContain('waiting for review (1)');
    expect(html).toMatch(/>review</);
  });

  it("the 'waiting for review' filter shows only submitted builds", () => {
    const html = view({ role: 'gm', filter: 'waiting' });
    expect(html).toContain('data-build-row="b-waiting"');
    expect(html).not.toContain('data-build-row="b-draft"');
    const none = view({ role: 'gm', filter: 'waiting', builds: [ROWS[0]!] });
    expect(none).toContain('data-testid="builds-empty"');
    expect(none).toContain('Nothing waiting for review');
  });

  it('a build saved under a level the campaign has since left says the settings changed; approved history does not', () => {
    const approved = row('b-done', { ...conceptBuild('face', 'Moth Calder'), state: 'approved' }, { state: 'approved' });
    const html = view({ role: 'gm', builds: [...ROWS, approved], settings: { level: 'street', table: 'sr5' } });
    const hints = [...html.matchAll(/data-build-row="([^"]+)"(?:(?!data-build-row=).)*?data-testid="build-settings-drift">([^<]+)</gs)];
    expect(hints.map((m) => m[1])).toEqual(['b-waiting', 'b-draft']);
    expect(hints[0]![2]).toContain('saved at Experienced, the campaign now runs Street level');
    expect(hints[0]![2]).toContain('checked against the new settings when opened');
    // Matching settings, or settings not read: no hint.
    expect(view({ builds: ROWS, settings: { level: 'experienced', table: 'sr5' } })).not.toContain('build-settings-drift');
    expect(view({ builds: ROWS })).not.toContain('build-settings-drift');
  });

  it('an observer or the table TV has nothing to make here', () => {
    for (const role of ['observer', 'display'] as Role[]) {
      const html = view({ role });
      expect(html).toContain('data-testid="builds-not-for-role"');
      expect(html).not.toContain('start a new runner');
    }
  });

  it('lists a build it cannot open by what is known of it, with delete for whoever may', () => {
    const at = '2026-09-10T08:00:00.000Z';
    const stub = { id: 'b-old', campaignId: CAMPAIGN, ownerUserId: PLAYER_ID, state: 'draft' as const, notes: null, characterId: null, unreadable: true as const, createdAt: at, updatedAt: at };
    const mine = view({ builds: [], stubs: [stub] });
    expect(mine).toContain('data-testid="build-stubs"');
    expect(mine).toContain('data-build-stub="b-old"');
    expect(mine).toContain('cannot open');
    expect(mine).toMatch(/<h2[^>]*>Builds that can no longer be opened<\/h2>/);
    expect(mine).toContain('aria-label="Delete the unreadable build from 2026-09-10"');
    // It is not an empty list, and it is not a link to a page that cannot load.
    expect(mine).not.toContain('data-testid="builds-empty"');
    expect(mine).not.toContain('href="/c/c1/build/b-old"');
    // Someone else's submitted stub: a player may not delete it; the GM may, and sees whose it is.
    const theirs = { ...stub, id: 'b-sent', state: 'submitted' as const, ownerUserId: 'u-other' };
    expect(view({ builds: [], stubs: [theirs] })).not.toContain('Delete the unreadable build');
    const gm = view({ role: 'gm', builds: [], stubs: [theirs] });
    expect(gm).toContain('by Tomas');
    expect(gm).toContain('aria-label="Delete the unreadable build from 2026-09-10"');
    // The waiting filter keeps only submitted stubs.
    expect(view({ role: 'gm', filter: 'waiting', builds: [], stubs: [stub, theirs] })).not.toContain('data-build-stub="b-old"');
  });

  it('who may delete: the owner while editable, the GM before approval, nobody after', () => {
    const draft = { state: 'draft' as const, ownerUserId: PLAYER_ID };
    expect(canDelete('player', PLAYER_ID, draft)).toBe(true);
    expect(canDelete('player', 'u-else', draft)).toBe(false);
    expect(canDelete('player', PLAYER_ID, { ...draft, state: 'submitted' })).toBe(false);
    expect(canDelete('gm', 'u-gm', { ...draft, state: 'submitted' })).toBe(true);
    expect(canDelete('gm', 'u-gm', { ...draft, state: 'approved' })).toBe(false);
    expect(canDelete('observer', undefined, draft)).toBe(false);
  });
});

function withClient(node: ReactNode, seed?: BuildList): string {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (seed) qc.setQueryData(buildKeys.list(CAMPAIGN), seed);
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{node}</MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('entry points are role-gated', () => {
  it('"build a runner" is offered to a GM and a player, never to an observer or the TV', () => {
    for (const role of ['gm', 'player']) {
      session.role = role;
      expect(withClient(<BuildRunnerButton campaignId={CAMPAIGN} name="Kestrel" />)).toMatch(
        /<button[^>]*data-testid="build-runner"[^>]*>build a runner<\/button>/,
      );
    }
    for (const role of ['observer', 'display']) {
      session.role = role;
      expect(withClient(<BuildRunnerButton campaignId={CAMPAIGN} />)).toBe('');
    }
  });

  it("the player's home card lists builds in progress and starts a new one — players only", () => {
    session.role = 'player';
    const html = withClient(<PlayerBuildsCard campaignId={CAMPAIGN} hasCharacter={false} />, {
      campaignId: CAMPAIGN,
      builds: [ROWS[0]!],
      stubs: [],
      unreadable: 0,
    });
    expect(html).toContain('data-testid="player-builds-card"');
    expect(html).toContain(`href="/c/${CAMPAIGN}/build/b-draft"`);
    expect(html).toContain(`href="/c/${CAMPAIGN}/build"`);
    const empty = withClient(<PlayerBuildsCard campaignId={CAMPAIGN} hasCharacter={false} />, {
      campaignId: CAMPAIGN,
      builds: [],
      stubs: [],
      unreadable: 0,
    });
    expect(empty).toContain('start a new runner');
    for (const role of ['gm', 'observer', 'display']) {
      session.role = role;
      expect(withClient(<PlayerBuildsCard campaignId={CAMPAIGN} hasCharacter={false} />)).toBe('');
    }
  });

  it("the console's card counts builds waiting for review and links to the filter — GM only", () => {
    session.role = 'gm';
    const html = withClient(<BuildsWaitingCard campaignId={CAMPAIGN} />, { campaignId: CAMPAIGN, builds: ROWS, stubs: [], unreadable: 0 });
    expect(html).toContain('data-waiting="1"');
    expect(html).toContain('1 build is waiting for your review.');
    expect(html).toContain(`href="/c/${CAMPAIGN}/build?filter=waiting"`);
    const quiet = withClient(<BuildsWaitingCard campaignId={CAMPAIGN} />, {
      campaignId: CAMPAIGN,
      builds: [row('b-x', blankBuild())],
      stubs: [],
      unreadable: 0,
    });
    expect(quiet).not.toContain('builds-review-link');
    expect(quiet).toContain('1 build is still being made');
    for (const role of ['player', 'observer', 'display']) {
      session.role = role;
      expect(withClient(<BuildsWaitingCard campaignId={CAMPAIGN} />)).toBe('');
    }
  });
});
