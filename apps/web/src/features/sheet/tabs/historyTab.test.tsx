/**
 * The History tab (FR3.8, FR3.1): revisions listed newest first with the
 * current one marked, a diff that reads field · now · after, a re-import
 * that will not apply without a second click, and nothing offered to a
 * device that may not edit. Static markup, as everywhere in this package.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { revisionsKey, type RevisionSummary, type SheetDiffEntry } from '../api.js';
import {
  DiffTable,
  HistoryPanel,
  ReimportPanel,
  describeRevision,
  formatWho,
  newestFirst,
  reportLines,
  showValue,
} from './HistoryTab.js';

const REVISIONS: RevisionSummary[] = [
  { seq: 1, cause: 'chummer import', createdBy: 'Whistler', createdAt: '2076-06-01T20:00:00.000Z' },
  { seq: 3, cause: 'rollback to r1', createdBy: 'Whistler', createdAt: '2076-06-12T21:04:00.000Z' },
  { seq: 2, cause: 'override attributes.bod', createdBy: null, createdAt: '2076-06-05T19:30:00.000Z' },
];

const DIFF: SheetDiffEntry[] = [
  { path: 'attributes.bod', op: 'changed', from: 4, to: 5 },
  { path: 'weapons[Kestrel A4].ammo.cap', op: 'removed', from: 30 },
  { path: 'skills[pistols]', op: 'added', to: { rating: 3 } },
];

function render(node: React.ReactElement, seed?: (qc: QueryClient) => void): string {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  seed?.(qc);
  return renderToStaticMarkup(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}

describe('the helpers say what a revision is', () => {
  it('orders newest first and describes a revision in one line', () => {
    expect(newestFirst(REVISIONS).map((r) => r.seq)).toEqual([3, 2, 1]);
    expect(describeRevision(REVISIONS[1]!)).toBe('r3 · rollback to r1 · Whistler · 2076-06-12 21:04');
    expect(describeRevision(REVISIONS[2]!)).toBe('r2 · override attributes.bod · 2076-06-05 19:30');
    // A user id is not a name: it is dropped rather than printed.
    expect(formatWho('300dc930-d008-4ce8-8bdc-80ad0ccaf94e')).toBe('');
    expect(formatWho('Whistler')).toBe('Whistler');
    // The joined name wins over whatever the id column holds.
    expect(formatWho('300dc930-d008-4ce8-8bdc-80ad0ccaf94e', 'Whistler')).toBe('Whistler');
    expect(
      describeRevision({ ...REVISIONS[0]!, createdBy: '300dc930-d008-4ce8-8bdc-80ad0ccaf94e' }),
    ).toBe('r1 · chummer import · 2076-06-01 20:00');
  });

  it('prints any value short, and never as [object Object]', () => {
    expect(showValue(undefined)).toBe('—');
    expect(showValue(null)).toBe('null');
    expect(showValue(5)).toBe('5');
    expect(showValue({ rating: 3 })).toBe('{"rating":3}');
    expect(showValue('x'.repeat(80))).toBe(`${'x'.repeat(57)}…`);
  });

  it('surfaces every list the import report carries, whatever it is called', () => {
    const lines = reportLines({
      format: 'chummer5',
      counts: { skills: 12 },
      unmapped: ['lifestyles'],
      notes: ["assumed skill 'pistols' from category 'Pistols'"],
    });
    expect(lines).toEqual([
      'unmapped: lifestyles',
      "notes: assumed skill 'pistols' from category 'Pistols'",
    ]);
    expect(reportLines(undefined)).toEqual([]);
  });
});

describe('the revision list', () => {
  it('lists newest first and marks the current one', () => {
    const html = render(<HistoryPanel characterId="c1" canEdit />, (qc) =>
      qc.setQueryData(revisionsKey('c1'), REVISIONS),
    );
    expect(html).toContain('data-testid="revision-list"');
    const order = [...html.matchAll(/data-seq="(\d+)"/g)].map((m) => m[1]);
    expect(order).toEqual(['3', '2', '1']);
    expect(html).toContain('3 kept');
    // The current revision is marked once, on the newest.
    expect(html.split('>current<')).toHaveLength(2);
    expect(html).toContain('rollback to r1');
    // Nothing is picked yet, so nothing offers to roll back.
    expect(html).not.toContain('data-testid="rollback"');
    expect(html).toContain('history only grows');
  });
});

describe('the diff table', () => {
  it('reads field · now · after, and colours the operation', () => {
    const html = renderToStaticMarkup(<DiffTable diff={DIFF} emptyText="nothing" />);
    expect(html).toContain('data-testid="sheet-diff"');
    expect(html).toContain('data-op="changed"');
    expect(html).toContain('data-op="removed"');
    expect(html).toContain('data-op="added"');
    expect(html).toContain('attributes.bod');
    expect(html).toContain('weapons[Kestrel A4].ammo.cap');
    expect(html).toContain('{&quot;rating&quot;:3}');
    expect(html).toContain('<th class="text-left font-normal">now</th>');
    expect(html).toContain('<th class="text-left font-normal">after</th>');
  });

  it('says so when there is nothing to show', () => {
    expect(renderToStaticMarkup(<DiffTable diff={[]} emptyText="identical" />)).toContain('identical');
  });
});

describe('re-import', () => {
  it('offers the file picker to an editor, and only a sentence to anyone else', () => {
    const editor = render(<ReimportPanel characterId="c1" canEdit />);
    expect(editor).toContain('data-testid="reimport-choose"');
    expect(editor).toContain('accept=".chum5,.xml,text/xml,application/xml"');
    expect(editor).toContain('manual overrides survive a re-import');
    // Nothing chosen yet: no preview, so no apply button to click by accident.
    expect(editor).not.toContain('data-testid="reimport-apply"');

    const viewer = render(<ReimportPanel characterId="c1" canEdit={false} />);
    expect(viewer).not.toContain('data-testid="reimport-choose"');
    expect(viewer).toContain('Only the sheet');
  });
});
