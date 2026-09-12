/**
 * Wayfinding (the round's whole point).
 *
 * The complaint was not "the feature is missing", it was "I cannot find it" —
 * a GM console with no party anywhere, a sidebar entry that landed on a card
 * reading "Placeholder", and screens reachable only by pasting a UUID into the
 * address bar. These lock that shut:
 *
 *   1. every path the GM sidebar and the phone nav offer resolves to a real
 *      route with an element, not to the 404 catch-all;
 *   2. the prep screens behind those links render no placeholder copy;
 *   3. every empty surface ships a working control, not a shrug;
 *   4. the roster links to each sheet by href, so nobody types an id.
 *
 * There is no DOM in this package (no jsdom, no testing-library), so the
 * components are rendered to static markup and asserted on as markup — the
 * honest half of the loop, and enough to prove a link exists and points where
 * it claims.
 */
import { describe, expect, it } from 'vitest';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes, matchRoutes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { routes } from '../../routes.js';
import BottomNav from './BottomNav.js';
import CampaignHome from './CampaignHome.js';
import GmSidebar from './GmSidebar.js';
import { GM_NAV, PLAYER_NAV, gmHref } from './gmNav.js';
import PartyPanel from '../../features/gm/home/PartyPanel.js';
import { SharedShelf } from '../../features/library/LibraryPage.js';

const CAMPAIGN = 'c1';

// --- session plumbing (no DOM, so localStorage is faked) --------------------

function fakeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: () => null,
    get length() {
      return map.size;
    },
  } as Storage;
}

/** Render `node` as a device of `role`, with `seed` already in the cache. */
function renderAs(
  role: 'gm' | 'player',
  node: ReactNode,
  opts: { seed?: Array<[unknown[], unknown]>; path?: string; pattern?: string } = {},
): string {
  const store = fakeStorage();
  store.setItem(
    `safehouse.session.${role}`,
    JSON.stringify({ token: 't', role, campaignId: CAMPAIGN, userId: 'u-gm' }),
  );
  const prevLocal = Reflect.get(globalThis, 'localStorage');
  const prevTab = Reflect.get(globalThis, 'sessionStorage');
  Object.defineProperty(globalThis, 'localStorage', { value: store, configurable: true });
  Object.defineProperty(globalThis, 'sessionStorage', { value: fakeStorage(), configurable: true });
  try {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    for (const [key, value] of opts.seed ?? []) qc.setQueryData(key, value);
    const path = opts.path ?? `/c/${CAMPAIGN}`;
    const pattern = opts.pattern ?? '/c/:campaignId';
    return renderToStaticMarkup(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path={pattern} element={node} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  } finally {
    Object.defineProperty(globalThis, 'localStorage', { value: prevLocal, configurable: true });
    Object.defineProperty(globalThis, 'sessionStorage', { value: prevTab, configurable: true });
  }
}

/** `data-nav="…"` values in render order. */
function navOrder(html: string): string[] {
  return [...html.matchAll(/data-nav="([^"]+)"/g)].map((m) => m[1]!);
}

// ---------------------------------------------------------------------------
// 1. Every advertised path is a real screen
// ---------------------------------------------------------------------------

describe('no dead links', () => {
  it('every GM sidebar entry resolves to a route with an element', () => {
    for (const entry of GM_NAV) {
      const href = gmHref(CAMPAIGN, entry);
      const matched = matchRoutes(routes, href);
      expect(matched, `${entry.key} → ${href}`).not.toBeNull();
      const leaf = matched!.at(-1)!;
      // The catch-all is the 404 page; landing there is the defect.
      expect(leaf.route.path, `${entry.key} fell through to NotFound`).not.toBe('*');
      expect(leaf.route.element, `${entry.key} has no element`).toBeTruthy();
    }
  });

  it('every player nav entry resolves too', () => {
    for (const entry of PLAYER_NAV) {
      const href = `/c/${CAMPAIGN}${entry.to}`;
      const matched = matchRoutes(routes, href);
      expect(matched, `${entry.key} → ${href}`).not.toBeNull();
      expect(matched!.at(-1)!.route.path, entry.key).not.toBe('*');
    }
  });

  // The sidebar asks /healthz for the build stamp now, so it needs a query
  // client like every other data-bearing shell piece.
  const sidebar = () =>
    renderToStaticMarkup(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={[`/c/${CAMPAIGN}/gm`]}>
          <GmSidebar campaignId={CAMPAIGN} onShowQr={() => undefined} />
        </MemoryRouter>
      </QueryClientProvider>,
    );

  it('the sidebar offers every entry, in the order a GM works', () => {
    const html = sidebar();
    const order = navOrder(html).filter((k) => GM_NAV.some((e) => e.key === k));
    expect(order).toEqual([
      'overview',
      'party',
      'ai',
      'table',
      'grid',
      'scenes',
      'codex',
      'calendar',
      'runs',
      'generator',
      'fixer',
      'architect',
      'books',
      'sessions',
    ]);
    // Party is the entry the console never had at all.
    expect(html).toContain(`href="/c/${CAMPAIGN}/gm/party"`);
  });

  it('names the display invite instead of only linking the kiosk', () => {
    const html = sidebar();
    expect(html).toContain('data-nav="display-qr"');
    expect(html).toMatch(/its own display invite/i);
  });
});

// ---------------------------------------------------------------------------
// 2. Nothing behind those links is a placeholder
// ---------------------------------------------------------------------------

/**
 * The GM prep screens, rendered for real. The four table screens are left out
 * on purpose: `grid` drives a WebGL stage, and `codex`/`calendar`/`runs` are a
 * `React.lazy` chunk whose static render is the Suspense fallback — neither
 * proves anything about placeholder copy here. Test 1 above still walks them.
 */
const PREP_SCREENS = ['overview', 'party', 'ai', 'scenes', 'generator', 'fixer', 'architect', 'books', 'sessions'];

describe('no placeholder screens behind the nav', () => {
  for (const key of PREP_SCREENS) {
    it(`${key} renders a real screen`, () => {
      const entry = GM_NAV.find((e) => e.key === key)!;
      const href = gmHref(CAMPAIGN, entry);
      const leaf = matchRoutes(routes, href)!.at(-1)!;
      const html = renderAs('gm', leaf.route.element as ReactNode, {
        path: href,
        pattern: `/c/:campaignId${entry.to}`,
      });
      expect(html.length, `${key} rendered nothing`).toBeGreaterThan(0);
      // Assert on the TEXT the GM reads, not the markup: `placeholder="…"` on
      // an input and Tailwind's `placeholder:text-faint` are both real UI. What
      // must not survive is the word in copy — "Placeholder — scene authoring,
      // activation, fog regions land here" was a live sidebar destination until
      // this round.
      const copy = html.replace(/<[^>]*>/g, ' ');
      expect(copy, `${key} still renders placeholder copy`).not.toMatch(/placeholder/i);
      expect(copy, `${key} is still a stub`).not.toMatch(/coming soon|not implemented|lands here/i);
      // "GM only" would mean the guard swallowed the screen, not that it exists.
      expect(html, `${key} was gated away`).not.toContain('This console needs a GM device');
    });
  }
});

// ---------------------------------------------------------------------------
// 3. Empty states carry a working control
// ---------------------------------------------------------------------------

describe('empty states hand over the control that fixes them', () => {
  it('an empty party offers Chummer import and a blank sheet', () => {
    const html = renderAs('gm', <PartyPanel campaignId={CAMPAIGN} />, {
      seed: [
        [['characters', CAMPAIGN], []],
        [['campaign', CAMPAIGN, 'devices'], []],
      ],
    });
    expect(html).toContain('data-testid="party-empty"');
    expect(html).toContain('data-testid="empty-state-actions"');
    expect(html).toContain('data-testid="add-character"');
    expect(html).toContain('import .chum5');
    expect(html).toContain('new blank sheet');
    // A control, not prose about one.
    expect(html).toMatch(/<button[^>]*>new blank sheet<\/button>/);
  });

  it('an empty shared library says who can fix it and links back', () => {
    const html = renderAs('player', <SharedShelf campaignId={CAMPAIGN} />, {
      seed: [[['campaign', CAMPAIGN, 'books'], []]],
    });
    expect(html).toContain('data-testid="library-empty"');
    expect(html).toContain('data-testid="empty-state-actions"');
    expect(html).toContain(`href="/c/${CAMPAIGN}"`);
    expect(html).toMatch(/flip a book to shared/i);
  });

  it('an empty device list offers the join QR', () => {
    const entry = GM_NAV.find((e) => e.key === 'overview')!;
    const leaf = matchRoutes(routes, gmHref(CAMPAIGN, entry))!.at(-1)!;
    const html = renderAs('gm', leaf.route.element as ReactNode, {
      path: `/c/${CAMPAIGN}/gm`,
      pattern: '/c/:campaignId/gm',
      seed: [
        [['campaign', CAMPAIGN, 'devices'], []],
        [['characters', CAMPAIGN], []],
      ],
    });
    expect(html).toContain('data-testid="devices-empty"');
    expect(html).toMatch(/<button[^>]*>show join QR<\/button>/);
  });

  it('the console leads with what is set up and what is not', () => {
    const entry = GM_NAV.find((e) => e.key === 'overview')!;
    const leaf = matchRoutes(routes, gmHref(CAMPAIGN, entry))!.at(-1)!;
    const html = renderAs('gm', leaf.route.element as ReactNode, {
      path: `/c/${CAMPAIGN}/gm`,
      pattern: '/c/:campaignId/gm',
      seed: [
        [['characters', CAMPAIGN], []],
        [['campaign', CAMPAIGN, 'devices'], []],
        [['scenes', CAMPAIGN], []],
        [['campaign', CAMPAIGN, 'books'], []],
        [['campaign', CAMPAIGN, 'npc-templates'], []],
      ],
    });
    expect(html).toContain('data-testid="setup-checklist"');
    // Every unfinished row carries the link that finishes it.
    expect(html).toContain('data-check="party"');
    expect(html).toContain('data-done="no"');
    expect(html).toContain(`href="/c/${CAMPAIGN}/gm/party"`);
    expect(html).toContain(`href="/c/${CAMPAIGN}/books"`);
    // The Opposition Kit's cold start: an empty campaign is pointed at the
    // starter library, which is the tab the deep link exists for. Without this
    // row `?tab=library` was a URL nothing in the app ever produced.
    expect(html).toContain('data-check="opposition"');
    expect(html).toContain(`href="/c/${CAMPAIGN}/gm/generator?tab=library"`);
    // And the console names every screen rather than listing bare chips.
    expect(html).toContain('data-nav-card="generator"');
    expect(html).toContain('data-nav-card="sessions"');
  });
});

// ---------------------------------------------------------------------------
// 4. Nobody types a UUID
// ---------------------------------------------------------------------------

describe('the roster is the way into a sheet', () => {
  const roster = [
    {
      id: 'ch-torque',
      name: 'Torque',
      ownerUserId: 'u-player',
      sheet: { identity: { alias: 'Torque', metatype: 'ork' } },
      balances: { karma: 12, nuyen: 4200 },
    },
    {
      id: 'ch-quill',
      name: 'Quill',
      ownerUserId: null,
      sheet: { identity: { alias: 'Quill', metatype: 'elf' } },
      balances: { karma: 3, nuyen: 800 },
    },
  ];
  const devices = [
    { id: 'd1', role: 'player', userId: 'u-player', userName: 'Rin' },
    { id: 'd2', role: 'display', userId: 'u-tv', userName: 'Table TV' },
  ];

  const html = () =>
    renderAs('gm', <PartyPanel campaignId={CAMPAIGN} />, {
      seed: [
        [['characters', CAMPAIGN], roster],
        [['campaign', CAMPAIGN, 'devices'], devices],
      ],
    });

  it('links every character to its own sheet', () => {
    const out = html();
    expect(out).toContain(`href="/c/${CAMPAIGN}/sheet/ch-torque"`);
    expect(out).toContain(`href="/c/${CAMPAIGN}/sheet/ch-quill"`);
    expect(out).toContain('Torque');
    expect(out).toContain('ork');
  });

  it('shows which sheets no device is holding, and offers to hand them over', () => {
    const out = html();
    expect(out).toContain('data-testid="unclaimed-note"');
    expect(out).toMatch(/1 sheet not handed to a device yet/);
    expect(out).toContain('no device');
    // The kiosk is not a person and is never offered as an owner.
    expect(out).toContain('>Rin</option>');
    expect(out).not.toContain('>Table TV</option>');
  });

  it('reads karma and nuyen off the ledger balances, not the sheet', () => {
    expect(html()).toContain('12 karma');
  });
});

// ---------------------------------------------------------------------------
// 5. The player's phone
// ---------------------------------------------------------------------------

describe('player wayfinding', () => {
  it('puts the shared rules library on the bottom nav', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter initialEntries={[`/c/${CAMPAIGN}/table`]}>
        <BottomNav campaignId={CAMPAIGN} role="player" characterId="ch-torque" />
      </MemoryRouter>,
    );
    expect(navOrder(html)).toEqual(['sheet', 'table', 'grid', 'codex', 'books']);
    expect(html).toContain(`href="/c/${CAMPAIGN}/books"`);
  });

  it('tells a player with no sheet what to ask the GM for', () => {
    const html = renderAs('player', <CampaignHome />, {
      seed: [[['characters', CAMPAIGN], []]],
    });
    expect(html).toContain('data-testid="no-character-note"');
    expect(html).toMatch(/Party roster/);
    expect(html).toContain(`href="/c/${CAMPAIGN}/books"`);
  });
});
