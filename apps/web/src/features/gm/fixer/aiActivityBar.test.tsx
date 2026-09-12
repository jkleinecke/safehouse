/**
 * The activity bar: says what is running, for how long, whose work it is,
 * and offers the cancel — and renders nothing at all when nothing is.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ActivityBarView, KIND_NOUN, elapsedLabel } from './AiActivityBar.js';
import { useAiPending, pendingFor } from './api.js';

const T0 = Date.parse('2026-09-11T20:00:00.000Z');

describe('elapsedLabel', () => {
  it('counts seconds, then minutes and seconds', () => {
    expect(elapsedLabel('2026-09-11T20:00:00.000Z', T0 + 12_000)).toBe('12s');
    expect(elapsedLabel('2026-09-11T20:00:00.000Z', T0 + 95_000)).toBe('1m 35s');
    expect(elapsedLabel('2026-09-11T20:00:10.000Z', T0)).toBe('0s'); // never negative
  });
});

describe('the bar', () => {
  it('renders nothing when the AI is idle', () => {
    expect(renderToStaticMarkup(<ActivityBarView activity={null} cancelling={false} now={T0} onCancel={() => undefined} />)).toBe('');
  });

  it('says what is running, for how long, whose work it is, and offers cancel', () => {
    const html = renderToStaticMarkup(
      <ActivityBarView
        activity={{ kind: 'floor', label: 'drafting a floor from the description', since: '2026-09-11T20:00:00.000Z' }}
        cancelling={false}
        now={T0 + 7_000}
        onCancel={() => undefined}
      />,
    );
    expect(html).toContain('data-testid="ai-activity"');
    expect(html).toContain('data-state="busy"');
    expect(html).toContain('working · drafting a floor from the description');
    expect(html).toContain('7s');
    expect(html).toContain(KIND_NOUN['floor']!);
    expect(html).toContain('data-testid="ai-cancel"');
    expect(html).toContain('>cancel<');
  });

  it('reads as stopping once the cancel is on its way, and disables the button', () => {
    const html = renderToStaticMarkup(
      <ActivityBarView
        activity={{ kind: 'chat', label: 'answering the Fixer chat', since: '2026-09-11T20:00:00.000Z' }}
        cancelling
        now={T0}
        onCancel={() => undefined}
      />,
    );
    expect(html).toContain('data-state="cancelling"');
    expect(html).toContain('stopping · answering the Fixer chat');
    expect(html).toContain('stopping…');
    expect(html).toMatch(/<button[^>]*disabled/);
  });
});

describe('the pending store', () => {
  it('follows a mutation from click to settle', () => {
    const hooks = pendingFor('npc', 'speaking as an NPC');
    expect(useAiPending.getState().pending).toBeNull();
    hooks.onMutate();
    expect(useAiPending.getState().pending).toMatchObject({ kind: 'npc', label: 'speaking as an NPC' });
    hooks.onSettled();
    expect(useAiPending.getState().pending).toBeNull();
  });
});
