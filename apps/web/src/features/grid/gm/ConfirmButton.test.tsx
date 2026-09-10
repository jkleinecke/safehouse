/** A destructive action takes two clicks (docs/UX_MAP_BUILDER.md §3.6). Static markup: the unarmed face. */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import ConfirmButton from './ConfirmButton.js';

describe('<ConfirmButton>', () => {
  it('starts unarmed, wearing its own label and its own test id', () => {
    const html = renderToStaticMarkup(
      <ConfirmButton label="delete" onConfirm={() => undefined} testId="kill" title="Remove it" />,
    );
    expect(html).toContain('data-testid="kill"');
    expect(html).toContain('data-armed="no"');
    expect(html).toContain('title="Remove it"');
    expect(html).toMatch(/>delete</);
    expect(html).not.toMatch(/delete\?/);
  });

  it('passes disabled through, so a button with nothing to delete stays dead', () => {
    const html = renderToStaticMarkup(<ConfirmButton label="Clear floor" onConfirm={() => undefined} disabled />);
    expect(html).toContain('disabled=""');
  });
});
