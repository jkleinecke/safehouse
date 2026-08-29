/**
 * The macro rack's rendered markup (FR2.8).
 *
 * Two things are pinned here rather than left to a helper. First, every macro
 * has to be a real `<button>` with a name that says what pressing it does —
 * the rack is the fastest path to a roll on a phone, and a chip a screen
 * reader cannot announce is not a path at all. Second, the sync line must be
 * honest in all three states: a rack that claims to have synced when it has
 * not is worse than one that says nothing.
 *
 * Rendered with `react-dom/server`, so no DOM is needed: effects do not run,
 * but structure, roles and accessible names all do.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import MacroRack, { syncNote } from './components/MacroRack.js';
import type { DiceMacro } from './macroStore.js';

const MACROS: DiceMacro[] = [
  { id: 'srv-1', name: 'Composure', pool: 8 },
  { id: 'srv-2', name: 'Sneak', pool: 11, limitKind: 'physical', limitValue: 5 },
];

function render(props: Partial<Parameters<typeof MacroRack>[0]> = {}): string {
  return renderToStaticMarkup(
    <MacroRack
      macros={MACROS}
      synced
      onSave={() => undefined}
      onRoll={() => undefined}
      {...props}
    />,
  );
}

describe('the rack', () => {
  it('gives every macro a button whose name says what it rolls', () => {
    const html = render();
    expect(html).toContain('aria-label="Roll Composure, 8 dice"');
    expect(html).toContain('aria-label="Roll Sneak, 11 dice, physical limit 5"');
    expect(html).toContain('aria-label="Delete the Composure macro"');
    expect(html).toContain('aria-label="Add a dice macro"');
    // The group itself is named, so the rack is one landmark and not a row of
    // orphan chips.
    expect(html).toContain('aria-label="Personal dice macros"');
  });

  it('says so when the rack is empty rather than rendering nothing', () => {
    expect(render({ macros: [] })).toContain('No macros yet');
  });
});

describe('the sync line', () => {
  it('is silent when the macros are on the account', () => {
    expect(syncNote(true, false)).toBe('');
    expect(render()).not.toContain('this device only');
  });

  it('warns when this server has no macro route', () => {
    expect(render({ synced: false })).toContain('this device only');
  });

  it('distinguishes "not saved yet" from "device only"', () => {
    const html = render({ synced: true, degraded: true });
    expect(html).toContain('not yet on the server');
    expect(html).not.toContain('this device only');
  });

  /** Degraded is a detail of a synced rack; it never overrides the louder state. */
  it('keeps "device only" the louder of the two', () => {
    expect(syncNote(false, true)).toBe(' — this device only');
  });
});
