/**
 * The hints toggle in the tracker header (FR10.10 — "optional").
 *
 * A feature that is off by default is only optional if the switch is somewhere
 * the GM will actually find it. The tracker header is that place: it is the one
 * screen a hint ever appears on, and it already holds the sibling control for
 * where copilot rolls land.
 *
 * The switch is also the one piece of the feature a player must never be
 * offered — `campaigns.settings` is filtered out of a player's campaign read
 * server-side, so the toggle has nothing to render from. That is asserted here
 * rather than assumed.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Role } from '@safehouse/contracts';
import type { CampaignSummary } from '../../api/campaigns.js';
import { ACTIVE_ROLE_KEY, SESSION_PREFIX } from '../../api/session.js';
import Tracker from './Tracker.js';
import { HINTS_SETTING } from './hints.js';
import { liveKeys } from '../../api/live.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubSession(role: Role) {
  const data: Record<string, string> = {
    [`${SESSION_PREFIX}${role}`]: JSON.stringify({
      token: 't',
      role,
      campaignId: 'camp-1',
      userId: 'u1',
    }),
    [ACTIVE_ROLE_KEY]: role,
  };
  const store = {
    getItem: (k: string) => data[k] ?? null,
    setItem: (k: string, v: string) => {
      data[k] = v;
    },
    removeItem: (k: string) => {
      delete data[k];
    },
    key: (i: number) => Object.keys(data)[i] ?? null,
    get length() {
      return Object.keys(data).length;
    },
  };
  vi.stubGlobal('localStorage', store);
  vi.stubGlobal('sessionStorage', undefined);
}

/** A live encounter with no combatants — enough for the header to render. */
function render(role: Role, settings: Record<string, unknown> | undefined): string {
  stubSession(role);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const campaign: CampaignSummary = {
    id: 'camp-1',
    name: 'Night shift',
    ...(settings ? { settings } : {}),
  };
  qc.setQueryData(['campaign', 'camp-1'], campaign);
  qc.setQueryData(liveKeys.encounter('camp-1'), {
    id: 'enc-1',
    campaignId: 'camp-1',
    name: 'Rooftop',
    state: 'live',
    turn: 1,
    pass: 1,
    combatants: [],
  });
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}>
      <Tracker campaignId="camp-1" />
    </QueryClientProvider>,
  );
}

describe('the hints toggle', () => {
  it('offers the GM an off switch, and says off is the default', () => {
    const html = render('gm', {});
    expect(html).toContain('hints off');
    expect(html).toContain('aria-pressed="false"');
    // The title has to explain what turning it on does, because a GM who has
    // never met the feature is the only person who ever reads it.
    expect(html).toContain('never acts');
  });

  it('shows it lit once the campaign turned hints on', () => {
    const html = render('gm', { [HINTS_SETTING]: true });
    expect(html).toContain('hints on');
    expect(html).toContain('aria-pressed="true"');
  });

  it('does not render for a player — they never get the settings to read', () => {
    // Exactly what a player's `GET /api/campaigns/:id` answers: no `settings`.
    const html = render('player', undefined);
    expect(html).not.toContain('hints o');
  });

  it('withholds the switch until the campaign read lands, rather than guessing "off"', () => {
    const html = render('gm', undefined);
    expect(html).not.toContain('hints o');
  });
});
