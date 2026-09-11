/**
 * Handing the campaign over (FR1.2): only joined people who are not already
 * the owner are offered, a kiosk never is, the click is armed before it
 * fires, and an empty table says why there is nobody to hand it to.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import TransferPanel, { transferCandidates } from './TransferPanel.js';
import { ownerOptions } from './PartyPanel.js';
import type { DeviceInfo } from './api.js';

const DEVICES: DeviceInfo[] = [
  { id: 'd1', role: 'gm', userId: 'gm-1', userName: 'Whistler' },
  { id: 'd2', role: 'player', userId: 'p-1', userName: 'Torque' },
  { id: 'd3', role: 'player', userId: 'p-1', userName: 'Torque' }, // second phone, same person
  { id: 'd4', role: 'player', userId: 'p-2', userName: 'Static', revokedAt: '2076-06-01T00:00:00Z' },
  { id: 'd5', role: 'display', userId: 'tv-1', userName: 'Table TV' },
];

function render(node: React.ReactElement, seed?: (qc: QueryClient) => void): string {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  seed?.(qc);
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{node}</MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('who can take the campaign', () => {
  it('is every joined person except the owner — one entry per person, no kiosk, nobody revoked', () => {
    const got = transferCandidates(ownerOptions(DEVICES), ['gm-1', undefined]);
    expect(got).toEqual([{ userId: 'p-1', label: 'Torque' }]);
  });
});

describe('the panel', () => {
  it('offers the candidates and an armed button that names the consequence', () => {
    const html = render(<TransferPanel campaignId="c1" />, (qc) => {
      qc.setQueryData(['campaign', 'c1'], { id: 'c1', name: 'Neon Rain', gmUserId: 'gm-1' });
      qc.setQueryData(['campaign', 'c1', 'devices'], DEVICES);
    });
    expect(html).toContain('data-testid="transfer-panel"');
    expect(html).toContain('data-testid="transfer-to"');
    expect(html).toMatch(/<option value="p-1"[^>]*>Torque<\/option>/);
    expect(html).not.toContain('value="gm-1"');
    expect(html).not.toContain('value="tv-1"');
    expect(html).toContain('data-testid="transfer-confirm"');
    expect(html).toContain('data-armed="no"');
    expect(html).toContain('make Torque the GM');
    expect(html).toContain('You keep a seat as a player');
  });

  it('says why there is nobody when only the GM has joined', () => {
    const html = render(<TransferPanel campaignId="c1" />, (qc) => {
      qc.setQueryData(['campaign', 'c1'], { id: 'c1', name: 'Neon Rain', gmUserId: 'gm-1' });
      qc.setQueryData(['campaign', 'c1', 'devices'], DEVICES.slice(0, 1));
    });
    expect(html).toContain('data-testid="transfer-nobody"');
    expect(html).not.toContain('data-testid="transfer-confirm"');
  });
});
