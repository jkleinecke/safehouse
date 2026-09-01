/**
 * `/files/:id` is an authenticated route, and every consumer of `fileUrl` is a
 * thing that cannot send a header: an `<img src>` on the Scenes list, pixi's
 * texture loader on the Grid and the TV, an `<a href>` on a pin.
 *
 * Found by driving the real app as the GM: the demo campaign's floor plan sat
 * in the file store, the Scenes card asked for `/files/<uuid>`, the server
 * answered 401, and the GM got a broken thumbnail and a blank tactical map with
 * no error anywhere on screen. `app.ts` already accepts `?token=` on `/files`
 * (QUERY_TOKEN_PREFIXES) — nothing was passing it.
 *
 * These tests pin the query parameter and the `#rot=` fragment stripping that
 * has to survive it.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SESSION_PREFIX, type Session } from '../../api/session.js';
import { fileUrl } from './api.js';

class Mem {
  private readonly map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
}

const GM: Session = { token: 'tok/en+1', role: 'gm', campaignId: 'c1' };

function signIn(session: Session | null): void {
  const store = new Mem();
  if (session) store.setItem(`${SESSION_PREFIX}${session.role}`, JSON.stringify(session));
  Object.defineProperty(globalThis, 'localStorage', {
    value: store,
    configurable: true,
    writable: true,
  });
}

beforeEach(() => signIn(GM));

afterEach(() => {
  Reflect.deleteProperty(globalThis as object, 'localStorage');
});

describe('fileUrl carries the device token (an <img> cannot)', () => {
  it('appends the signed-in device token', () => {
    expect(fileUrl('45bfe45e-7d1f-4633-92e3-55a36b7170d1')).toBe(
      '/files/45bfe45e-7d1f-4633-92e3-55a36b7170d1?token=tok%2Fen%2B1',
    );
  });

  it('percent-encodes it, so a token with URL punctuation still authenticates', () => {
    const url = fileUrl('img-1');
    expect(url).toContain('token=tok%2Fen%2B1');
    expect(new URL(url, 'http://x').searchParams.get('token')).toBe('tok/en+1');
  });

  it('strips the map ref adjustment fragment before the query', () => {
    // `mapImage.ts` hangs `#rot=90&c=1.2` off a map attachment id; the file
    // route wants the bare uuid and the token must land after it, not inside
    // the fragment where the server would never see it.
    const url = fileUrl('img-1#rot=90&contrast=1.2');
    expect(url).toBe('/files/img-1?token=tok%2Fen%2B1');
    expect(url).not.toContain('#');
  });

  it('degrades to the bare path when no device is signed in', () => {
    // A signed-out browser has nothing to send; emitting `?token=` with an
    // empty value would turn a 401 into a confusing 401.
    signIn(null);
    expect(fileUrl('img-1')).toBe('/files/img-1');
  });
});
