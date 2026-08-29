import { describe, expect, it } from 'vitest';
import {
  NATIVE_STORAGE_KEY,
  bookRangeUrl,
  nativeBookHref,
  parseBoolFlag,
  readerDeepLinkHref,
  readerHref,
  resolveReaderMode,
  setNativePreference,
  triageReaderError,
  withNativeFlag,
  type StorageLike,
} from './mode.js';
import { BookRangeError, RangeUnsupportedError } from './range.js';

function fakeStorage(initial: Record<string, string> = {}): StorageLike & { map: Map<string, string> } {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

/** A storage that throws on every access, as private mode can. */
const hostileStorage: StorageLike = {
  getItem() {
    throw new Error('blocked');
  },
  setItem() {
    throw new Error('blocked');
  },
  removeItem() {
    throw new Error('blocked');
  },
};

describe('parseBoolFlag', () => {
  it('reads the usual truthy spellings, bare flag included', () => {
    for (const v of ['1', 'true', 'yes', 'on', '']) expect(parseBoolFlag(v)).toBe(true);
  });
  it('reads the usual falsy spellings', () => {
    for (const v of ['0', 'false', 'no', 'off']) expect(parseBoolFlag(v)).toBe(false);
  });
  it('is undecided about anything else', () => {
    expect(parseBoolFlag('maybe')).toBeNull();
    expect(parseBoolFlag(null)).toBeNull();
  });
});

describe('resolveReaderMode', () => {
  it('defaults to the self-hosted pdf.js viewer', () => {
    expect(resolveReaderMode('?p=426')).toBe('pdfjs');
    expect(resolveReaderMode(null, fakeStorage())).toBe('pdfjs');
  });

  it('honours the documented ?native=1 fallback flag', () => {
    expect(resolveReaderMode('?p=426&native=1')).toBe('native');
    expect(resolveReaderMode('?native')).toBe('native');
  });

  it('remembers a per-device preference', () => {
    const storage = fakeStorage({ [NATIVE_STORAGE_KEY]: '1' });
    expect(resolveReaderMode('?p=426', storage)).toBe('native');
  });

  it('lets an explicit link override the stored preference in both directions', () => {
    const prefersNative = fakeStorage({ [NATIVE_STORAGE_KEY]: '1' });
    expect(resolveReaderMode('?native=0', prefersNative)).toBe('pdfjs');
    expect(resolveReaderMode('?native=1', fakeStorage())).toBe('native');
  });

  it('does not throw when storage is blocked', () => {
    expect(() => resolveReaderMode('?p=1', hostileStorage)).not.toThrow();
    expect(resolveReaderMode('?p=1', hostileStorage)).toBe('pdfjs');
  });
});

describe('setNativePreference', () => {
  it('stores and clears the flag', () => {
    const storage = fakeStorage();
    setNativePreference(true, storage);
    expect(storage.map.get(NATIVE_STORAGE_KEY)).toBe('1');
    setNativePreference(false, storage);
    expect(storage.map.has(NATIVE_STORAGE_KEY)).toBe(false);
  });

  it('survives blocked storage', () => {
    expect(() => setNativePreference(true, hostileStorage)).not.toThrow();
    expect(() => setNativePreference(true, null)).not.toThrow();
  });
});

describe('triageReaderError', () => {
  it('tells the reader the truth when the book is the problem, not the viewer', () => {
    // FR11.5: a per-book GM-only toggle. Falling back to the browser's viewer
    // would refetch the same URL with the same token and show the same 403.
    for (const status of [401, 403]) {
      const failure = triageReaderError(new BookRangeError(status, 'nope'));
      expect(failure.kind).toBe('blocked');
      expect(failure).toHaveProperty('message', expect.stringContaining('GM'));
    }
  });

  it('names a registry row with no PDF behind it', () => {
    const failure = triageReaderError(new BookRangeError(404, 'no file'));
    expect(failure).toEqual({ kind: 'blocked', message: expect.stringContaining('file store') });
  });

  it('degrades to the native viewer for everything else', () => {
    expect(triageReaderError(new RangeUnsupportedError())).toEqual({ kind: 'degrade' });
    expect(triageReaderError(new BookRangeError(500, 'boom'))).toEqual({ kind: 'degrade' });
    expect(triageReaderError(new Error('pdf.js is not vendored'))).toEqual({ kind: 'degrade' });
    expect(triageReaderError(null)).toEqual({ kind: 'degrade' });
    expect(triageReaderError(undefined)).toEqual({ kind: 'degrade' });
  });
});

describe('urls', () => {
  it('reads the book through the authenticated byte-range endpoint, tokenless', () => {
    expect(bookRangeUrl('SR5')).toBe('/files/books/SR5');
    expect(bookRangeUrl('R5 rev')).toBe('/files/books/R5%20rev');
  });

  it('only the iframe fallback carries a token, because it cannot send a header', () => {
    expect(nativeBookHref('SR5', 431, 'dev-token')).toBe(
      '/files/books/SR5?token=dev-token#page=431',
    );
    expect(nativeBookHref('SR5', 431)).toBe('/files/books/SR5#page=431');
    expect(nativeBookHref('SR5', 0)).toContain('#page=1');
  });

  it('links a ref chip at a printed page (DESIGN §12)', () => {
    expect(readerHref('SR5', 426)).toBe('/read/SR5?p=426');
    expect(readerHref('SR5', 426, { native: true })).toBe('/read/SR5?p=426&native=1');
  });

  it('gives hard navigations a path the server does not already claim', () => {
    // `/read/:code` is also the server's JSON offset route. It content-
    // negotiates now (`plugins/books.ts#wantsSpaShell`), so `/read` is the
    // address to share; `/book` stays as the belt for any client whose Accept
    // header the negotiation cannot read as a navigation.
    expect(readerDeepLinkHref('SR5', 426)).toBe('/book/SR5?p=426');
    expect(readerDeepLinkHref('SR5', 426, { native: true })).toBe('/book/SR5?p=426&native=1');
    expect(readerDeepLinkHref('SR5', 426).startsWith('/read')).toBe(false);
  });

  it('flips the flag without losing the rest of the query', () => {
    expect(withNativeFlag('p=426', true)).toBe('p=426&native=1');
    expect(withNativeFlag('p=426&native=1', false)).toBe('p=426');
  });
});
