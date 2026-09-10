/**
 * The fight menu (FR4.1, FR4.8): make a fight, name it, tie it to a scene,
 * add a row by hand, delete it — every control the GM needs, none a player
 * ever sees. Static markup, like the other tracker tests.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Encounter } from '@safehouse/contracts';
import FightMenu from './FightMenu.js';

const FIGHT: Encounter = { id: 'enc-1', campaignId: 'camp-1', name: 'Pier 23 ambush', state: 'prep', turn: 0, pass: 0, sceneId: 's1', combatants: [] };

function render(encounter: Encounter | null): string {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(['scenes', 'camp-1'], [{ id: 's1', name: 'Pier 23 Warehouse' }, { id: 's2', name: 'Rooftop' }]);
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}>
      <FightMenu campaignId="camp-1" encounter={encounter} onPick={() => undefined} onClose={() => undefined} />
    </QueryClientProvider>,
  );
}

describe('<FightMenu>', () => {
  it('always offers a new fight, and points at the two other ways to make one', () => {
    const html = render(null);
    expect(html).toContain('aria-label="New fight name"');
    expect(html).toContain('>create<');
    expect(html).toMatch(/Grid \(Scenes ▸ Fight\)/);
    expect(html).toMatch(/Generator/);
    // Nothing to rename, add to or delete without a fight.
    expect(html).not.toContain('Fight name');
    expect(html).not.toContain('Delete this fight');
  });

  it('with a fight: rename, the scene link with every scene, the hand-added row, and delete', () => {
    const html = render(FIGHT);
    expect(html).toContain('aria-label="Fight name"');
    expect(html).toContain('value="Pier 23 ambush"');
    expect(html).toContain('aria-label="Linked scene"');
    expect(html).toContain('Pier 23 Warehouse');
    expect(html).toContain('Rooftop');
    for (const label of ['Combatant name', 'Initiative base', 'Initiative dice', 'Initiative kind', 'Physical boxes', 'Stun boxes', 'Hidden from players']) {
      expect(html).toContain(`aria-label="${label}"`);
    }
    // The line the row will have reads back before it is added.
    expect(html).toContain('8+1d6 · P10/S10');
    expect(html).toContain('Delete this fight');
    // …and the delete needs a second click.
    expect(html).not.toContain('yes, delete it');
  });
});
