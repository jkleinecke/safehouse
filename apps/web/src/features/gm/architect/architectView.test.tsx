/**
 * The Architect's screen: the brief, the outline as a checklist, what landed —
 * and the offline note when the AI is off.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import ArchitectView, { landedLine, tickedCount, type ArchitectViewProps } from './ArchitectView.js';
import { selectAll, toggled } from '../ArchitectPage.js';
import type { ArchitectOutline } from '../fixer/api.js';

const OUTLINE: ArchitectOutline = {
  title: 'Rust on the Water',
  premise: 'A dockside smuggling ring, hired from both sides.',
  lore: [
    { title: 'Pier 23', kind: 'location', summary: 'A container pier that answers to nobody.' },
    { title: 'The Rusted Halo', kind: 'faction', summary: 'Six boats, one warehouse, a lot of debt.' },
  ],
  npcs: [
    {
      name: 'Marisol Kane',
      role: 'dock foreman',
      archetype: 'Street enforcer',
      persona: { traits: [], goals: ['keep the pier hers'], secrets: [], knowledge: [], mannerisms: [], hooks: [], voice: 'low and dry' },
    },
  ],
  scenes: [{ name: 'Warehouse 9', purpose: 'The exchange goes wrong here.', floor: 'One big floor, an office.', cols: 24, rows: 16, tileset: 'docklands' }],
};

const noop = () => undefined;
const base: ArchitectViewProps = {
  campaignId: 'c1',
  offline: false,
  brief: 'A dockside smuggling ring over three sessions.',
  onBrief: noop,
  outline: null,
  ticked: { lore: [], npcs: [], scenes: [] },
  onToggle: noop,
  onToggleAll: noop,
  outlining: false,
  building: false,
  progress: null,
  cancelling: false,
  result: null,
  outlineError: null,
  buildError: null,
  outlineCancelled: false,
  buildCancelled: false,
  onOutline: noop,
  onBuild: noop,
  onCancel: noop,
  onStartOver: noop,
};

const render = (props: Partial<ArchitectViewProps>) =>
  renderToStaticMarkup(
    <MemoryRouter>
      <ArchitectView {...base} {...props} />
    </MemoryRouter>,
  );

describe('the Architect screen', () => {
  it('says where to turn the AI on when it is off, and shows no form', () => {
    const html = render({ offline: true });
    expect(html).toContain('data-testid="architect-offline"');
    expect(html).toContain('href="/c/c1/gm/ai"');
    expect(html).not.toContain('data-testid="architect-brief"');
  });

  it('starts with the brief and a rough-it-out button, nothing written', () => {
    const html = render({});
    expect(html).toContain('data-testid="architect-brief"');
    expect(html).toContain('data-testid="architect-outline"');
    expect(html).toContain('nothing is written until you build');
    expect(html).not.toContain('data-testid="architect-plan"');
  });

  it('shows the outline as three checklists with counts, and the build button names the tally', () => {
    const html = render({ outline: OUTLINE, ticked: selectAll(OUTLINE) });
    expect(html).toContain('Rust on the Water');
    expect(html).toContain('data-testid="architect-lore"');
    expect(html).toContain('2 of 2');
    expect(html).toContain('data-testid="architect-npcs"');
    expect(html).toContain('Street enforcer');
    expect(html).toContain('voice: low and dry');
    expect(html).toContain('data-testid="architect-scenes"');
    expect(html).toContain('24×16 · docklands');
    expect(html).toContain('>build 4 items<');
    expect(html).toContain('pages and NPCs land in the drafts inbox');
  });

  it('reads the server\'s label as progress while building, with a cancel beside it', () => {
    const html = render({ outline: OUTLINE, ticked: selectAll(OUTLINE), building: true, progress: 'writing “Pier 23” (1 of 4)' });
    expect(html).toContain('writing “Pier 23” (1 of 4)');
    expect(html).toContain('data-testid="architect-cancel"');
    expect(html).toContain('>building…<');
  });

  it('lists what landed, with a link to each place, and says when it was stopped', () => {
    const html = render({
      outline: OUTLINE,
      ticked: selectAll(OUTLINE),
      result: {
        results: [
          { type: 'lore', index: 0, name: 'Pier 23', ok: true, id: 'd1', landed: 'drafts' },
          { type: 'npc', index: 0, name: 'Marisol Kane', ok: false, note: 'no archetypes on file' },
          { type: 'scene', index: 0, name: 'Warehouse 9', ok: true, id: 's1', landed: 'scenes', note: '2 rooms, 150 floor squares, 2 doors — staged in Docklands' },
        ],
        cancelled: true,
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        latencyMs: 0,
      },
    });
    expect(html).toContain('stopped — what landed before that');
    expect(html).toContain('2 of 3 ok');
    expect(html).toContain('data-testid="architect-landed-npc-0" data-ok="false"');
    expect(html).toContain('no archetypes on file');
    expect(html).toContain('staged as a scene — 2 rooms');
    expect(html).toContain('href="/c/c1/gm/fixer"');
    expect(html).toContain('href="/c/c1/gm/scenes"');
  });
});

describe('the selection helpers', () => {
  it('ticks everything by default and toggles one at a time', () => {
    const all = selectAll(OUTLINE);
    expect(all).toEqual({ lore: [0, 1], npcs: [0], scenes: [0] });
    expect(tickedCount(all)).toBe(4);
    const less = toggled(all, 'lore', 0);
    expect(less.lore).toEqual([1]);
    expect(toggled(less, 'lore', 0).lore).toEqual([0, 1]);
  });
  it('says where an item landed', () => {
    expect(landedLine({ type: 'lore', index: 0, name: 'x', ok: true, landed: 'drafts' })).toBe('in the drafts inbox');
    expect(landedLine({ type: 'npc', index: 0, name: 'x', ok: true, landed: 'drafts', note: 'rolled from Ganger' })).toBe('in the drafts inbox — rolled from Ganger');
    expect(landedLine({ type: 'npc', index: 0, name: 'x', ok: false, note: 'nope' })).toBe('nope');
  });
});
