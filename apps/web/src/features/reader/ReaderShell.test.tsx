/**
 * The reader's chrome, rendered to markup (no DOM environment in this package —
 * `react-dom/server` is enough to assert the phone layout and the fallback).
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import NativeBookFrame from './NativeBookFrame.js';
import ReaderShell from './ReaderShell.js';
import { MOBILE_VIEWPORT_WIDTH } from './layout.js';
import { resolvePdfPage } from './pageMath.js';

/** SR5 p.426 at the measured +5 offset, in a 494-page file. */
const SR5_426 = resolvePdfPage(426, 5, 494);

function shell(overrides: Partial<Parameters<typeof ReaderShell>[0]> = {}) {
  return renderToStaticMarkup(
    <ReaderShell
      code="SR5"
      title="Core Rulebook"
      mapping={SR5_426}
      pageCount={494}
      mode="pdfjs"
      onStep={() => undefined}
      onJump={() => undefined}
      {...overrides}
    >
      {overrides.children ?? <div data-testid="surface" />}
    </ReaderShell>,
  );
}

/** Every hard-coded CSS width in the markup, in px. */
function inlinePixelWidths(markup: string): number[] {
  const out: number[] = [];
  for (const m of markup.matchAll(/(?:^|;|")\s*(?:min-)?width:\s*(\d+(?:\.\d+)?)px/g)) {
    const raw = m[1];
    if (raw) out.push(Number.parseFloat(raw));
  }
  for (const m of markup.matchAll(/\bmin-w-\[(\d+)px\]|\bw-\[(\d+)px\]/g)) {
    const raw = m[1] ?? m[2];
    if (raw) out.push(Number.parseInt(raw, 10));
  }
  return out;
}

describe('reader chrome at 390 px', () => {
  it('lays out in a column with nothing wider than a phone', () => {
    const markup = shell();
    expect(markup).toContain('flex h-dvh min-h-0 w-full flex-col');
    for (const width of inlinePixelWidths(markup)) {
      expect(width).toBeLessThanOrEqual(MOBILE_VIEWPORT_WIDTH);
    }
  });

  it('gives every control a 44 px touch target', () => {
    const markup = shell({ zoom: { value: 1, onIn: () => {}, onOut: () => {}, onFit: () => {} } });
    const buttons = markup.match(/<button[^>]*>/g) ?? [];
    expect(buttons.length).toBeGreaterThanOrEqual(6);
    for (const button of buttons) expect(button).toContain('min-h-11');
  });

  it('opens on the printed page the ref chip asked for', () => {
    const markup = shell();
    expect(markup).toContain('value="426"');
    expect(markup).toContain('aria-label="Jump to printed page"');
    // A phone must get the number pad, not the alphabet. (React 19 emits these
    // attributes camel-cased; HTML attribute names are case-insensitive.)
    expect(markup.toLowerCase()).toContain('inputmode="numeric"');
    expect(markup.toLowerCase()).toContain('enterkeyhint="go"');
  });

  it('shows where the page came from (Principle 3)', () => {
    expect(shell()).toContain('printed 426 · pdf 431 of 494 · offset +5');
  });

  it('offers page turn in both directions, and stops at the covers', () => {
    const markup = shell();
    expect(markup).toContain('aria-label="Previous page"');
    expect(markup).toContain('aria-label="Next page"');
    expect(markup).not.toMatch(/aria-label="Previous page"[^>]*disabled/);

    const front = shell({ mapping: resolvePdfPage(1, 0, 494) });
    expect(front).toMatch(/<button[^>]*disabled[^>]*aria-label="Previous page"/);

    const back = shell({ mapping: resolvePdfPage(489, 5, 494) });
    expect(back).toMatch(/<button[^>]*disabled[^>]*aria-label="Next page"/);

    // Asking past the back cover lands on the last page and says so.
    expect(shell({ mapping: resolvePdfPage(600, 5, 494) })).toContain('last page');
  });

  it('carries the zoom controls only when pdf.js is drawing the page', () => {
    const zoom = { value: 1.25, onIn: () => {}, onOut: () => {}, onFit: () => {} };
    expect(shell({ zoom })).toContain('125%');
    expect(shell({ mode: 'native' })).not.toContain('aria-label="Zoom in"');
  });

  it('renders the calibration nudge when the GM is measuring an offset', () => {
    const markup = shell({
      calibrate: { offset: 5, onNudge: () => {}, onSave: () => {}, saving: false },
    });
    expect(markup).toContain('aria-label="Offset +1"');
    expect(markup).toContain('save offset');
  });

  it('names the mode it is in, and offers the other one', () => {
    const markup = shell({ mode: 'native', onToggleNative: () => {} });
    expect(markup).toContain('data-reader-mode="native"');
    expect(markup).toContain('in-app viewer');
    expect(shell({ onToggleNative: () => {} })).toContain('browser viewer');
  });

  it('replaces the page with an escape hatch when the viewer fails', () => {
    const markup = shell({ error: 'this book has no file', onToggleNative: () => {} });
    expect(markup).toContain('this book has no file');
    expect(markup).toContain('open in the browser viewer');
    expect(markup).not.toContain('data-testid="surface"');
  });
});

describe('the native fallback frame', () => {
  it('anchors the browser viewer at the mapped PDF page', () => {
    const markup = renderToStaticMarkup(
      <NativeBookFrame code="SR5" pdfPage={SR5_426.pdf} printedPage={426} token="dev-token" />,
    );
    expect(markup).toContain('src="/files/books/SR5?token=dev-token#page=431"');
    expect(markup).toContain('title="SR5 p.426"');
  });

  it('fills the reader without its own width', () => {
    const markup = renderToStaticMarkup(
      <NativeBookFrame code="SR5" pdfPage={431} printedPage={426} />,
    );
    expect(markup).toContain('h-full w-full');
    expect(inlinePixelWidths(markup)).toHaveLength(0);
  });

  it('renders inside the shell as the page surface', () => {
    const markup = shell({
      mode: 'native',
      children: <NativeBookFrame code="SR5" pdfPage={431} printedPage={426} />,
    });
    expect(markup).toContain('data-testid="native-book-frame"');
    expect(markup).toContain('#page=431');
  });
});
