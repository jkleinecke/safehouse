/**
 * The sheet's shared bottom sheet (`ui.tsx` `Sheet`), rendered to static
 * markup: what a thumb has to hit.
 *
 * The builder opens its pools and issues in this sheet on a phone, beside
 * buttons that are 40 px on touch; the close ✕ was a bare glyph, a target a
 * few pixels wide. It keeps its look on a mouse and grows to 40 px square
 * under a coarse pointer, like every other control the builder offers there.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Sheet } from './ui.js';

const noop = () => undefined;

describe('Sheet', () => {
  it('gives its close button a 40 px target on touch, named for what it does', () => {
    const html = renderToStaticMarkup(
      <Sheet open onClose={noop} title="Pools & issues">
        body
      </Sheet>,
    );
    const close = /<button[^>]*aria-label="Close"[^>]*>/.exec(html)![0];
    expect(close).toContain('pointer-coarse:min-h-10');
    expect(close).toContain('pointer-coarse:min-w-10');
    expect(close).toContain('items-center');
    expect(html).toContain('role="dialog"');
  });

  it('renders nothing while closed', () => {
    expect(renderToStaticMarkup(<Sheet open={false} onClose={noop} title="Pools & issues">body</Sheet>)).toBe('');
  });
});
