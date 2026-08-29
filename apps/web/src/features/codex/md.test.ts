import { describe, expect, it } from 'vitest';
import {
  excerpt,
  normalizeTitle,
  parseInline,
  parseMarkdown,
  sectionOutline,
  slugify,
  wikiLinkTargets,
  type Block,
} from './md.js';

function headings(md: string): string[] {
  return parseMarkdown(md).flatMap((b) => (b.kind === 'heading' ? [b.id] : []));
}

describe('slugify + section ids (must match the server, FR5.2)', () => {
  it('slugs headings the way services/codex.ts does', () => {
    expect(slugify('The Johnson')).toBe('the-johnson');
    expect(slugify('What *he* really wants')).toBe('what-he-really-wants');
    expect(slugify('Renraku — Seattle branch')).toBe('renraku-seattle-branch');
    expect(slugify('###')).toBe('section');
  });

  it('suffixes duplicate headings so reveal targets stay distinct', () => {
    expect(headings('## Secrets\ntext\n## Secrets\nmore\n## Secrets')).toEqual([
      'secrets',
      'secrets-2',
      'secrets-3',
    ]);
  });

  it('ignores headings inside fenced code, exactly like the server', () => {
    const md = '## Real\n\n```\n## Not a heading\n```\n\n## Also real';
    expect(headings(md)).toEqual(['real', 'also-real']);
  });

  it('sectionOutline reports level and heading text for the reveal controls', () => {
    expect(sectionOutline('# Top\n\n## Under\n\n### Deep')).toEqual([
      { id: 'top', heading: 'Top', level: 1 },
      { id: 'under', heading: 'Under', level: 2 },
      { id: 'deep', heading: 'Deep', level: 3 },
    ]);
  });
});

describe('inline parsing', () => {
  it('reads [[wiki-links]] with and without a label (FR5.3)', () => {
    expect(parseInline('see [[The Johnson]] now')).toEqual([
      { kind: 'text', text: 'see ' },
      { kind: 'wikilink', target: 'The Johnson', label: 'The Johnson' },
      { kind: 'text', text: ' now' },
    ]);
    expect(parseInline('[[Renraku Arcology|the arcology]]')).toEqual([
      { kind: 'wikilink', target: 'Renraku Arcology', label: 'the arcology' },
    ]);
  });

  it('turns SR5 p.426 into a ref token (FR11.4)', () => {
    expect(parseInline('grenades scatter, SR5 p.426, badly')).toEqual([
      { kind: 'text', text: 'grenades scatter, ' },
      { kind: 'ref', book: 'SR5', page: 426, text: 'SR5 p.426' },
      { kind: 'text', text: ', badly' },
    ]);
  });

  it('does not find refs inside code spans or link targets', () => {
    expect(parseInline('`SR5 p.426`')).toEqual([{ kind: 'code', text: 'SR5 p.426' }]);
    expect(parseInline('[[SR5 p.426]]')).toEqual([
      { kind: 'wikilink', target: 'SR5 p.426', label: 'SR5 p.426' },
    ]);
  });

  it('handles bold, italic and underscores', () => {
    expect(parseInline('**hard** and *soft* and _quiet_')).toEqual([
      { kind: 'strong', text: 'hard' },
      { kind: 'text', text: ' and ' },
      { kind: 'em', text: 'soft' },
      { kind: 'text', text: ' and ' },
      { kind: 'em', text: 'quiet' },
    ]);
  });

  it('leaves an empty link target as plain text rather than a dead chip', () => {
    expect(parseInline('[[|label]]')).toEqual([{ kind: 'text', text: '[[|label]]' }]);
  });
});

describe('block parsing', () => {
  it('reads paragraphs, lists, quotes, rules and fences', () => {
    const md = [
      '# Renraku',
      '',
      'A corp with a',
      'soft-wrapped paragraph.',
      '',
      '- one',
      '- two',
      '',
      '1. first',
      '2. second',
      '',
      '> they lie',
      '',
      '---',
      '',
      '```json',
      '{"a":1}',
      '```',
    ].join('\n');
    const kinds = parseMarkdown(md).map((b: Block) => b.kind);
    expect(kinds).toEqual([
      'heading',
      'paragraph',
      'list',
      'list',
      'quote',
      'rule',
      'code',
    ]);
  });

  it('joins soft-wrapped paragraph lines', () => {
    const [block] = parseMarkdown('A corp with a\nsoft-wrapped paragraph.');
    expect(block?.kind).toBe('paragraph');
    expect(block?.kind === 'paragraph' && block.inline[0]).toEqual({
      kind: 'text',
      text: 'A corp with a soft-wrapped paragraph.',
    });
  });

  it('keeps ordered and unordered runs apart', () => {
    const blocks = parseMarkdown('- a\n1. b');
    expect(blocks.map((b) => b.kind === 'list' && b.ordered)).toEqual([false, true]);
  });

  it('preserves code fence contents verbatim, language included', () => {
    const [block] = parseMarkdown('```ts\nconst a = 1;\n// **not bold**\n```');
    expect(block).toEqual({ kind: 'code', text: 'const a = 1;\n// **not bold**', lang: 'ts' });
  });

  it('closes an unterminated fence at end of document', () => {
    const [block] = parseMarkdown('```\nstill open');
    expect(block).toEqual({ kind: 'code', text: 'still open', lang: null });
  });

  it('returns nothing for an empty page', () => {
    expect(parseMarkdown('')).toEqual([]);
    expect(parseMarkdown('\n\n  \n')).toEqual([]);
  });
});

describe('wikiLinkTargets', () => {
  it('collects every distinct target, case- and space-insensitively', () => {
    const md = 'see [[The Johnson]] and [[the  johnson]] and [[Docks|the docks]]';
    expect(wikiLinkTargets(md)).toEqual(['The Johnson', 'Docks']);
  });

  it('skips targets that only appear inside code', () => {
    expect(wikiLinkTargets('```\n[[Not A Page]]\n```')).toEqual([]);
  });
});

describe('normalizeTitle', () => {
  it('matches the server rule so create-prompts line up', () => {
    expect(normalizeTitle('  The   Johnson ')).toBe('the johnson');
  });
});

describe('excerpt', () => {
  it('takes the first prose line, skipping headings and lists', () => {
    expect(excerpt('# Title\n\n- bullet\n\nThe actual blurb.')).toBe('The actual blurb.');
  });

  it('flattens links and refs into readable text', () => {
    expect(excerpt('Met [[The Johnson|him]] about SR5 p.12 rules.')).toBe(
      'Met him about SR5 p.12 rules.',
    );
  });

  it('truncates long prose with an ellipsis', () => {
    expect(excerpt('x'.repeat(200), 20)).toHaveLength(20);
    expect(excerpt('x'.repeat(200), 20).endsWith('…')).toBe(true);
  });

  it('is empty when there is no prose at all', () => {
    expect(excerpt('# Just a heading')).toBe('');
  });
});
