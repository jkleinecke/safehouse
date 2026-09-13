/**
 * The register an NPC speaks in reaches the converse prompt as examples,
 * and the GM's private notes never reach it at all (NPC manager, 4.3).
 */
import { describe, expect, it } from 'vitest';
import { DIALECTS } from '@safehouse/contracts';
import { dialectLines, npcSystemPrompt } from '../src/fixer/agent.js';

describe('dialectLines', () => {
  it('turns a palette id into its register and sample lines', () => {
    const lines = dialectLines('corp-formal');
    expect(lines[0]).toContain('Corporate formal');
    expect(lines[0]).toContain('euphemism');
    expect(lines[1]).toContain('Sound like these');
    for (const sample of DIALECTS.find((d) => d.id === 'corp-formal')!.samples) expect(lines[1]).toContain(sample);
  });

  it('passes a free description through, and says nothing for nothing', () => {
    expect(dialectLines('Glaswegian, cheerful')).toEqual(['Dialect: Glaswegian, cheerful — keep every line in that register.']);
    expect(dialectLines(undefined)).toEqual([]);
    expect(dialectLines('  ')).toEqual([]);
  });
});

describe('npcSystemPrompt', () => {
  it('carries the dialect and leaves the GM notes out', () => {
    const prompt = npcSystemPrompt(
      'Ratchet',
      { voice: 'flat', dialect: 'sprawl-street', notes: 'SECRET GM NOTE: she is the Johnson', knowledge: ['the pier'] },
      [],
    );
    expect(prompt).toContain('Dialect: Sprawl street');
    expect(prompt).toContain('Chummer');
    expect(prompt).not.toContain('SECRET GM NOTE');
    expect(prompt).toContain('- the pier');
  });
});
