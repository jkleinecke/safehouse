/** The press opens a popup; the popup's own button does it. Static markup: the closed face. */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import ConfirmButton from './ConfirmButton.js';

describe('<ConfirmButton>', () => {
  it('wears its own label and test id, with the popup closed', () => {
    const html = renderToStaticMarkup(
      <ConfirmButton
        label="delete"
        question="Delete it?"
        action="Delete"
        onConfirm={() => undefined}
        testId="kill"
        title="Remove it"
      />,
    );
    expect(html).toContain('data-testid="kill"');
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('title="Remove it"');
    expect(html).toMatch(/>delete</);
    expect(html).not.toContain('Delete it?');
  });

  it('passes disabled through, so a button with nothing to delete stays dead', () => {
    const html = renderToStaticMarkup(
      <ConfirmButton label="Clear" question="Clear it?" action="Clear" onConfirm={() => undefined} disabled />,
    );
    expect(html).toContain('disabled=""');
  });
});
