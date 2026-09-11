/**
 * Speak as an NPC (FR12.6): archetypes with a persona lead the list, the
 * persona is on screen while the GM types, the panel goes quiet with the
 * Fixer (NG7), and an empty campaign is pointed at the starter library.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { NpcTemplate } from '@safehouse/contracts';
import NpcVoice, { hasVoice, personaLine, voiceOrder } from './NpcVoice.js';

const TEMPLATES: NpcTemplate[] = [
  { id: 't-mute', name: 'Ganger', persona: { traits: [], goals: [], secrets: [], knowledge: [], mannerisms: [], hooks: [] } },
  {
    id: 't-halo',
    name: 'Rusted Halo',
    persona: {
      voice: 'slow, amused, never raises it',
      traits: ['patient', 'greedy', 'sentimental about the docks', 'fourth trait'],
      goals: ['keep the pier'],
      secrets: [],
      knowledge: ['who runs the night shift'],
      mannerisms: ['taps the table'],
      hooks: [],
    },
  },
  { id: 't-none', name: 'Corp Sec', persona: undefined as never },
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

const ON = { enabled: true, models: { primary: 'big', fast: 'small' } };

describe('who can speak', () => {
  it('knows a persona from an empty one, and leads with the ones that have a voice', () => {
    expect(hasVoice(TEMPLATES[1]!)).toBe(true);
    expect(hasVoice(TEMPLATES[0]!)).toBe(false);
    expect(hasVoice(TEMPLATES[2]!)).toBe(false);
    expect(voiceOrder(TEMPLATES).map((t) => t.id)).toEqual(['t-halo', 't-none', 't-mute']);
  });

  it('folds the persona into one line the GM can keep in view', () => {
    expect(personaLine(TEMPLATES[1])).toBe(
      'slow, amused, never raises it · patient · greedy · sentimental about the docks · taps the table',
    );
    expect(personaLine(TEMPLATES[2])).toBeNull();
    expect(personaLine(undefined)).toBeNull();
  });
});

describe('the panel', () => {
  it('lists the archetypes, persona first, with the persona under the picker', () => {
    const html = render(<NpcVoice campaignId="c1" />, (qc) => {
      qc.setQueryData(['fixer', 'status'], ON);
      qc.setQueryData(['campaign', 'c1', 'npc-templates'], TEMPLATES);
    });
    expect(html).toContain('data-testid="npc-voice"');
    expect(html).toContain('data-testid="npc-voice-pick"');
    const options = [...html.matchAll(/<option[^>]*value="([^"]+)"/g)].map((m) => m[1]);
    expect(options).toEqual(['t-halo', 't-none', 't-mute']);
    expect(html).toContain('Ganger (no persona yet)');
    expect(html).toContain('data-testid="npc-voice-persona"');
    expect(html).toContain('slow, amused, never raises it');
    expect(html).toContain('Say something to Rusted Halo');
    expect(html).toContain('ctrl+enter speaks');
  });

  it('goes quiet when the Fixer is off, and says what brings it back', () => {
    const html = render(<NpcVoice campaignId="c1" />, (qc) => {
      qc.setQueryData(['fixer', 'status'], { enabled: false, models: null });
      qc.setQueryData(['campaign', 'c1', 'npc-templates'], TEMPLATES);
    });
    expect(html).toContain('data-testid="npc-voice-offline"');
    expect(html).not.toContain('data-testid="npc-voice-pick"');
    expect(html).toContain('inference endpoint');
  });

  it('points an empty campaign at the starter library', () => {
    const html = render(<NpcVoice campaignId="c1" />, (qc) => {
      qc.setQueryData(['fixer', 'status'], ON);
      qc.setQueryData(['campaign', 'c1', 'npc-templates'], []);
    });
    expect(html).toContain('data-testid="npc-voice-empty"');
    expect(html).toContain('href="/c/c1/gm/generator?tab=library"');
    expect(html).toContain('pick an archetype first');
  });

  it('defaults to the fast slot while a session is live', () => {
    const live = render(<NpcVoice campaignId="c1" sessionLive />, (qc) => {
      qc.setQueryData(['fixer', 'status'], ON);
      qc.setQueryData(['campaign', 'c1', 'npc-templates'], TEMPLATES);
    });
    expect(live).toContain('title="Model slot">fast<');
  });
});
