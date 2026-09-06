/**
 * The token-image control (FR9.4).
 *
 * One control, two audiences: a player on their own sheet, the GM on anybody's.
 * What is worth pinning is the GATE, because getting it wrong is invisible
 * until somebody at the table taps a button and gets a 403 they cannot read —
 * and the opposite mistake, hiding it from the GM, would quietly remove the
 * "or the GM can do it for them" half of the feature.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import PortraitControl, { type PortraitSubject } from './components/PortraitControl.js';

const session = vi.hoisted(() => ({
  current: null as { userId: string; role: string } | null,
}));

vi.mock('../../api/session.js', () => ({
  getSession: () => session.current,
}));

vi.mock('../grid/api.js', () => ({
  fileUrl: (id: string) => `/files/${id}?token=t`,
}));

function character(over: Partial<PortraitSubject> = {}): PortraitSubject {
  return {
    id: 'c1',
    name: 'Torque',
    alias: 'Torque',
    ownerUserId: 'player-1',
    portraitId: null,
    ...over,
  };
}

/** Markup, the way every other component test here works — no DOM library. */
function show(subject: PortraitSubject): string {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}>
      <PortraitControl subject={subject} />
    </QueryClientProvider>,
  );
}

const buttons = (html: string): number => (html.match(/<button/g) ?? []).length;

describe('PortraitControl', () => {
  beforeEach(() => {
    session.current = null;
  });

  it('lets the owning player add a token image', () => {
    session.current = { userId: 'player-1', role: 'player' };
    expect(show(character())).toContain('add token image');
  });

  it('lets the GM do it for somebody else', () => {
    // The other half of the ask. A GM owns nobody's sheet, so a naive
    // ownership check would lock them out of the feature entirely.
    session.current = { userId: 'the-gm', role: 'gm' };
    expect(show(character({ ownerUserId: 'player-1' }))).toContain('add token image');
  });

  it('shows another player the picture and no buttons', () => {
    session.current = { userId: 'player-2', role: 'player' };
    expect(buttons(show(character({ ownerUserId: 'player-1' })))).toBe(0);
  });

  it('offers nothing at all to a device with no session', () => {
    expect(buttons(show(character()))).toBe(0);
  });

  it('offers the control when the device has no user id to compare', () => {
    // A device that signed in by pasting a token has a role and a campaign and
    // no user id — a supported way in. Treating that as "not the owner" hid
    // the control from the person it belongs to and explained nothing. The
    // server still decides; at worst this costs one 403 with a sentence.
    session.current = { userId: undefined as unknown as string, role: 'player' };
    expect(show(character())).toContain('add token image');
  });

  it('still refuses an observer, who cannot own anything', () => {
    session.current = { userId: 'watcher', role: 'observer' };
    expect(buttons(show(character({ ownerUserId: 'watcher' })))).toBe(0);
  });

  it('treats an unclaimed character as nobody’s but the GM’s', () => {
    // `ownerUserId` is nullable — a character the GM made and never assigned.
    // A player must not be able to dress it just because it has no owner.
    session.current = { userId: 'player-1', role: 'player' };
    expect(buttons(show(character({ ownerUserId: null })))).toBe(0);
  });

  it('stands in with the initial letter until there is a picture', () => {
    session.current = { userId: 'player-1', role: 'player' };
    const html = show(character());
    expect(html).not.toContain('<img');
    expect(html).toContain('>T<');
  });

  it('shows the portrait, and offers replace and remove, once there is one', () => {
    session.current = { userId: 'player-1', role: 'player' };
    const html = show(character({ portraitId: 'att-9' }));
    expect(html).toContain('/files/att-9');
    expect(html).toContain('replace');
    expect(html).toContain('remove');
    expect(html).not.toContain('add token image');
  });

  it('accepts only the image types the server will take', () => {
    // Mirrored from the server's own list so the picker filters, rather than
    // letting somebody choose a PDF and learn about it after the upload.
    session.current = { userId: 'player-1', role: 'player' };
    expect(show(character())).toContain('accept="image/png,image/jpeg,image/webp,image/gif"');
  });
});
