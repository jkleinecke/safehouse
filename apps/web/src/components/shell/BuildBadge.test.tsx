/**
 * The build line: names the server's build, and says when this page is from
 * another one — the tab-left-open-across-a-rebuild case a reload fixes.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchServerBuild, type ServerBuild } from '../../api/health.js';
import { CLIENT_BUILD, commitOf } from '../../build.js';
import BuildBadge, { buildLine } from './BuildBadge.js';

const server = (over: Partial<ServerBuild> = {}): ServerBuild => ({
  ok: true,
  ts: '2026-09-07T10:00:00Z',
  version: 'abc1234',
  builtAt: '2026-09-07T09:58:00Z',
  source: 'image',
  ...over,
});

describe('buildLine', () => {
  it('names the server build and when it was built', () => {
    const line = buildLine(server(), { version: 'abc1234', builtAt: null });
    expect(line.text).toBe('build abc1234');
    expect(line.detail).toMatch(/^built /);
    expect(line.stale).toBe(false);
  });

  it('says a checkout is a checkout', () => {
    expect(buildLine(server({ builtAt: null, source: 'checkout' }), { version: 'abc1234', builtAt: null }).detail).toBe(
      'running from the checkout',
    );
  });

  it('flags this page when it came from a different commit than the server', () => {
    expect(buildLine(server(), { version: 'def5678', builtAt: null }).stale).toBe(true);
  });

  it('does not flag a dirty build of the same commit, or an unknown one', () => {
    expect(buildLine(server(), { version: 'abc1234-dirty', builtAt: null }).stale).toBe(false);
    expect(buildLine(server({ version: 'abc1234-dirty' }), { version: 'abc1234', builtAt: null }).stale).toBe(false);
    expect(buildLine(server(), { version: 'dev', builtAt: null }).stale).toBe(false);
    expect(buildLine(server({ version: 'dev' }), { version: 'abc1234', builtAt: null }).stale).toBe(false);
    expect(commitOf('abc1234-dirty')).toBe('abc1234');
  });

  it('is honest before the server has answered', () => {
    const line = buildLine(undefined, { version: 'abc1234', builtAt: null });
    expect(line.text).toBe('build abc1234');
    expect(line.detail).toBe('server not reached yet');
    expect(line.stale).toBe(false);
  });
});

describe('<BuildBadge>', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('renders this bundle’s build before the server has answered', () => {
    const html = renderToStaticMarkup(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <BuildBadge />
      </QueryClientProvider>,
    );
    expect(html).toContain('data-testid="build-badge"');
    expect(html).toContain(`build ${CLIENT_BUILD.version}`);
    expect(html).toContain('data-stale="no"');
  });

  it('asks /healthz with no token attached — the front door has none', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify(server({ version: 'feed123' })), {
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    expect((await fetchServerBuild()).version).toBe('feed123');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit | undefined];
    expect(url).toBe('/healthz');
    expect(init?.headers).toBeUndefined();
  });
});
