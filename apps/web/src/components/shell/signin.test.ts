import { describe, expect, it } from 'vitest';
import {
  destinationFor,
  joinRouteFor,
  normalizePairCode,
  parsePastedSession,
  roleLabel,
} from './signin.js';

describe('destinationFor', () => {
  it('sends each role where it belongs (FR1.1)', () => {
    expect(destinationFor({ role: 'gm', campaignId: 'c1' })).toBe('/c/c1/gm');
    expect(destinationFor({ role: 'player', campaignId: 'c1' })).toBe('/c/c1');
    expect(destinationFor({ role: 'observer', campaignId: 'c1' })).toBe('/c/c1');
    expect(destinationFor({ role: 'display', campaignId: 'c1' })).toBe('/tv/c1');
  });
});

describe('normalizePairCode', () => {
  it('accepts a bare code however it was typed', () => {
    expect(normalizePairCode('abcd2345')).toBe('ABCD2345');
    expect(normalizePairCode('  ABCD2345  ')).toBe('ABCD2345');
    expect(normalizePairCode('ABCD-2345')).toBe('ABCD2345');
    expect(normalizePairCode('abcd 2345')).toBe('ABCD2345');
  });

  it('digs the code out of a pasted join URL (the QR target)', () => {
    expect(normalizePairCode('http://192.168.1.20:5173/join/ABCD2345')).toBe('ABCD2345');
    expect(normalizePairCode('http://192.168.1.20:8787/join/abcd2345?x=1')).toBe('ABCD2345');
    // The API path is not what the QR encodes, but a GM may paste it anyway.
    expect(normalizePairCode('http://box.lan:8787/api/join/ABCD2345')).toBe('ABCD2345');
  });

  it('rejects empties and things too short to be a code', () => {
    expect(normalizePairCode('')).toBeNull();
    expect(normalizePairCode('   ')).toBeNull();
    expect(normalizePairCode('AB')).toBeNull();
    expect(normalizePairCode('----')).toBeNull();
  });
});

describe('joinRouteFor', () => {
  it('targets the SPA route, never the API path (LIVE-3)', () => {
    expect(joinRouteFor('ABCD2345')).toBe('/join/ABCD2345');
    expect(joinRouteFor('ABCD2345')).not.toContain('/api/');
  });
});

describe('parsePastedSession', () => {
  const token = 'wLq3Zx9-tokenish_valueThatIsLongEnough';

  it('accepts the old hand-written localStorage blob verbatim', () => {
    const blob = JSON.stringify({ token, role: 'gm', campaignId: 'camp-1' });
    expect(parsePastedSession(blob)).toEqual({ token, role: 'gm', campaignId: 'camp-1' });
  });

  it('accepts a bare token when the campaign id is supplied beside it', () => {
    expect(parsePastedSession(token, { campaignId: 'camp-1' })).toEqual({
      token,
      role: 'gm',
      campaignId: 'camp-1',
    });
    expect(parsePastedSession(`Bearer ${token}`, { campaignId: 'camp-1' })?.token).toBe(token);
  });

  it('honours an explicit role, defaulting to gm', () => {
    expect(parsePastedSession(token, { campaignId: 'c', role: 'display' })?.role).toBe('display');
    expect(
      parsePastedSession(JSON.stringify({ token, role: 'player', campaignId: 'c' }))?.role,
    ).toBe('player');
  });

  it('falls back to the typed campaign id when the blob omits one', () => {
    const blob = JSON.stringify({ token, role: 'gm' });
    expect(parsePastedSession(blob, { campaignId: 'camp-2' })?.campaignId).toBe('camp-2');
  });

  it('refuses anything that is not a usable session', () => {
    expect(parsePastedSession('')).toBeNull();
    expect(parsePastedSession('{ not json')).toBeNull();
    expect(parsePastedSession(JSON.stringify({ role: 'gm', campaignId: 'c' }))).toBeNull();
    expect(parsePastedSession(token)).toBeNull(); // no campaign id anywhere
    expect(parsePastedSession('short', { campaignId: 'c' })).toBeNull();
    expect(parsePastedSession('has spaces in it here', { campaignId: 'c' })).toBeNull();
  });

  it('ignores a bogus role rather than trusting the paste', () => {
    const blob = JSON.stringify({ token, role: 'admin', campaignId: 'c' });
    expect(parsePastedSession(blob)?.role).toBe('gm');
  });
});

describe('roleLabel', () => {
  it('names the kiosk in table language', () => {
    expect(roleLabel('display')).toBe('table TV');
    expect(roleLabel('gm')).toBe('gm');
  });
});
