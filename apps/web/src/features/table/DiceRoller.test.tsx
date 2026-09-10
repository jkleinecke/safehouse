/**
 * The free-form roller's strip (docs/UX_SITE.md, Chunking and Jakob's Law):
 * pool and roll in view, limit and visibility folded behind one chip that
 * says what it hides, and a macro named on the strip rather than in a
 * browser prompt. Static markup, no DOM; the fold's state is a pure function.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import DiceRoller, { moreSummary } from './DiceRoller.js';

function render(): string {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}>
      <DiceRoller campaignId="c1" />
    </QueryClientProvider>,
  );
}

describe('moreSummary', () => {
  it('is empty at the defaults, and names whatever is set', () => {
    expect(moreSummary(false, 'physical', 4, 'public')).toBe('');
    expect(moreSummary(true, 'social', 5, 'public')).toBe('social limit 5');
    expect(moreSummary(false, 'physical', 4, 'gm_owner')).toBe('behind the screen');
    expect(moreSummary(true, 'mental', 3, 'gm')).toBe('mental limit 3 · GM only');
  });
});

describe('<DiceRoller>', () => {
  it('keeps pool, Edge and Roll in view and folds limit and visibility behind one chip', () => {
    const html = render();
    expect(html).toContain('Roll 6d6');
    expect(html).toMatch(/>Edge</);
    expect(html).toContain('data-testid="roller-more"');
    expect(html).toMatch(/limit · visibility/);
    expect(html).not.toContain('data-testid="roller-more-panel"');
    expect(html).not.toMatch(/>Visibility</);
  });

  it('offers to save a macro without a browser prompt', () => {
    const html = render();
    expect(html).toContain('aria-label="Save as macro"');
    expect(html).not.toContain('aria-label="Macro name"');
  });
});
