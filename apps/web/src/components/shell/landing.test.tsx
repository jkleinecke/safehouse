/**
 * The front door, as the GM meets it between sessions.
 *
 * Three things this screen has to get right, and each of them was broken:
 *
 *   1. one stored device still means "just take me in" — reopening the browser
 *      on the GM's laptop costs no input at all;
 *   2. several campaigns means a list, not a guess, and every table this
 *      browser has ever paired with is on it;
 *   3. a token the server rejected lands here with `?expired=1`, and the
 *      screen must NOT bounce straight back into the campaign that just
 *      refused it — that is the loop.
 *
 * There is no DOM in this package, so the screens are rendered to static
 * markup: effects (the silent `POST /api/gm/recover` probe and the campaign
 * fetch) do not run, which is exactly the state a returning GM sees on first
 * paint — everything below is what storage alone can produce.
 */
import { describe, expect, it } from 'vitest';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Role } from '@safehouse/contracts';
import CampaignPicker from './CampaignPicker.js';
import Landing from './Landing.js';
import { saveSession, type Session } from '../../api/session.js';

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

function session(role: Role, token: string, campaignId: string, campaignName?: string): Session {
  return { token, role, campaignId, ...(campaignName ? { campaignName } : {}) };
}

/** Render `node` at `path` with `sessions` already stored in this browser. */
function renderWith(sessions: Session[], node: ReactNode, path = '/'): string {
  const prevLocal = Reflect.get(globalThis, 'localStorage');
  const prevTab = Reflect.get(globalThis, 'sessionStorage');
  Object.defineProperty(globalThis, 'localStorage', { value: fakeStorage(), configurable: true });
  Object.defineProperty(globalThis, 'sessionStorage', { value: fakeStorage(), configurable: true });
  try {
    for (const s of sessions) saveSession(s);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return renderToStaticMarkup(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[path]}>{node}</MemoryRouter>
      </QueryClientProvider>,
    );
  } finally {
    Object.defineProperty(globalThis, 'localStorage', { value: prevLocal, configurable: true });
    Object.defineProperty(globalThis, 'sessionStorage', { value: prevTab, configurable: true });
  }
}

describe('reopening the browser', () => {
  it('takes a single stored device straight in, with no input', () => {
    const html = renderWith([session('gm', 'gm-a', 'camp-a')], <Landing />);
    // `<Navigate>` renders nothing: the sign-in screen never appears.
    expect(html).not.toContain('SAFEHOUSE');
    expect(html).not.toContain('data-testid="campaign-picker"');
  });

  it('offers the list instead of guessing once there are two', () => {
    const html = renderWith(
      [session('gm', 'gm-a', 'camp-a', 'Static on the Line'), session('gm', 'gm-b', 'camp-b')],
      <Landing />,
    );
    expect(html).toContain('SAFEHOUSE');
    expect(html).toContain('data-testid="campaign-picker"');
    expect(html).toContain('data-campaign="camp-a"');
    expect(html).toContain('data-campaign="camp-b"');
    expect(html).toContain('Static on the Line');
  });

  it('still shows the three sign-in tabs under the list', () => {
    const html = renderWith(
      [session('gm', 'gm-a', 'camp-a'), session('player', 'p-b', 'camp-b')],
      <Landing />,
    );
    expect(html).toContain('id="signin-tab-pair"');
    expect(html).toContain('id="signin-tab-start"');
    expect(html).toContain('id="signin-tab-token"');
  });

  it('shows the sign-in tabs and nothing else when the browser is empty', () => {
    const html = renderWith([], <Landing />);
    expect(html).toContain('SAFEHOUSE');
    expect(html).not.toContain('data-testid="campaign-picker"');
  });
});

describe('a token the server rejected', () => {
  it('does not bounce back into the campaign it just failed to open', () => {
    const html = renderWith([session('gm', 'gm-a', 'camp-a')], <Landing />, '/?expired=1');
    expect(html).toContain('SAFEHOUSE');
    expect(html).toContain('data-testid="session-expired-note"');
    // …and the other devices this browser still holds remain one tap away.
    expect(html).toContain('data-campaign="camp-a"');
  });

  it('says what happened without calling it a failure', () => {
    const html = renderWith([], <Landing />, '/?expired=1');
    expect(html).toContain('data-testid="session-expired-note"');
    expect(html).toMatch(/revoke a device/i);
    expect(html).not.toMatch(/error|failed/i);
  });
});

describe('the campaign picker', () => {
  const held = {
    campaignId: 'camp-a',
    name: 'Static on the Line',
    role: 'gm' as Role,
    session: session('gm', 'gm-a', 'camp-a'),
  };
  const elsewhere = { campaignId: 'camp-b', name: 'Bad Debts', role: 'gm' as Role };

  it('marks which rows this browser can open and which need a device', () => {
    const html = renderWith([], <CampaignPicker cards={[held, elsewhere]} />);
    expect(html).toContain('data-campaign="camp-a"');
    expect(html).toContain('data-held="yes"');
    expect(html).toContain('data-campaign="camp-b"');
    expect(html).toContain('data-held="no"');
  });

  it('offers a campaign whose device is on the other laptop rather than hiding it', () => {
    const html = renderWith([], <CampaignPicker cards={[elsewhere]} />);
    expect(html).toContain('Bad Debts');
    expect(html).toContain('aria-label="Open Bad Debts as gm"');
  });

  it('falls back to the campaign id when the server has not named it', () => {
    const html = renderWith(
      [],
      <CampaignPicker cards={[{ campaignId: 'abcdef01-2345', name: '', role: 'player' }]} />,
    );
    expect(html).toContain('Campaign abcdef01');
  });

  it('renders nothing at all when there is nothing to pick', () => {
    expect(renderWith([], <CampaignPicker cards={[]} />)).toBe('');
  });
});
