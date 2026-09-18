/**
 * The progress strip (docs/CHARGEN.md §4.4 "ticks the finished ones, and marks
 * any that a later change broke"; free mode "the progress strip is a tab
 * bar").
 *
 * The "broken" mark is the one that matters: a player moves skills to a
 * poorer priority on step 2 after spending skill points on step 6, and step 6
 * — *ahead* of them — must turn into a mark that says so, not read "not done
 * yet" like a step never opened. That walk is reproduced with the real engine
 * over an invented runner, from the step where the change is made. So is the
 * other half: a step never visited is not ticked just because nothing in it
 * is wrong yet.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { setPriority } from '@safehouse/rules';
import ProgressStrip from './ProgressStrip.js';
import { analysisOf, blankBuild, conceptBuild } from '../testing.js';

const noop = () => undefined;

function marks(html: string): Record<string, string> {
  return Object.fromEntries([...html.matchAll(/data-step="(\d)" data-mark="(\w+)"/g)].map((m) => [m[1]!, m[2]!]));
}

describe('ProgressStrip', () => {
  it('names nine steps, ticks the complete ones and shows the current one', () => {
    const build = conceptBuild('muscle');
    const a = analysisOf(build);
    const html = renderToStaticMarkup(<ProgressStrip steps={a.steps} current={1} mode="guided" onSelect={noop} build={build} />);
    expect([...html.matchAll(/data-step="/g)]).toHaveLength(9);
    const m = marks(html);
    expect(m['1']).toBe('current');
    // A concept card fills priorities; their step is ticked ahead of the player.
    expect(m['2']).toBe('done');
    expect(html).toContain('aria-current="step"');
    // The name starts with the word the button shows (WCAG 2.5.3).
    expect(html).toContain('aria-label="Priorities — Step 2, Priorities: done"');
  });

  it('marks a step ahead of the player that the change they are making broke', () => {
    const muscle = conceptBuild('muscle');
    expect(analysisOf(muscle).steps[5]!.complete).toBe(true);
    // On step 2, move the skills column to a poorer row: step 6's spend no longer fits.
    const worse = { ...setPriority(muscle, 'skills', 'E'), step: 2 };
    const after = analysisOf(worse);
    expect(after.steps[5]!.complete).toBe(false);
    const html = renderToStaticMarkup(<ProgressStrip steps={after.steps} current={2} mode="guided" onSelect={noop} build={worse} />);
    expect(marks(html)['6']).toBe('broken');
    expect(html).toMatch(/aria-label="Skills — Step 6, Skills: needs attention/);
  });

  it('marks a step behind the player that a later change broke', () => {
    const worse = { ...setPriority(conceptBuild('muscle'), 'skills', 'E'), step: 8 };
    const html = renderToStaticMarkup(
      <ProgressStrip steps={analysisOf(worse).steps} current={8} mode="guided" onSelect={noop} build={worse} />,
    );
    expect(marks(html)['6']).toBe('broken');
  });

  it('ticks no step a blank build has never reached', () => {
    const blank = blankBuild();
    const a = analysisOf(blank);
    const m = marks(renderToStaticMarkup(<ProgressStrip steps={a.steps} current={1} mode="free" onSelect={noop} build={blank} />));
    // Nothing is wrong with the Magic and Qualities steps yet — because nothing is in them.
    expect(m['4']).toBe('todo');
    expect(m['5']).toBe('todo');
    expect(Object.values(m).filter((mark) => mark === 'done' || mark === 'broken')).toEqual([]);
  });

  it('in guided mode a step past the first unfinished one is out of reach, and says why', () => {
    const a = analysisOf({ ...conceptBuild('muscle'), identity: { alias: '' } });
    const html = renderToStaticMarkup(<ProgressStrip steps={a.steps} current={1} mode="guided" onSelect={noop} />);
    expect(html).toMatch(/data-step="3"[^>]*aria-disabled="true"/);
    expect(html).toContain('finish the steps before it first');
    expect(html).not.toContain('role="tablist"');
  });

  it('in free mode it is a tablist with every step reachable', () => {
    const a = analysisOf({ ...conceptBuild('muscle'), identity: { alias: '' } });
    const html = renderToStaticMarkup(
      <ProgressStrip steps={a.steps} current={4} mode="free" onSelect={noop} panelId="panel" />,
    );
    expect(html).toContain('role="tablist"');
    expect([...html.matchAll(/role="tab"/g)]).toHaveLength(9);
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain('aria-controls="panel"');
    expect(html).not.toContain('aria-disabled');
  });

  it("marks the step the GM's note is pinned to", () => {
    const a = analysisOf(conceptBuild('muscle'));
    const html = renderToStaticMarkup(<ProgressStrip steps={a.steps} current={1} mode="free" onSelect={noop} noteStep={7} />);
    expect(html).toMatch(/Step 7, Gear: [^"]*, the GM left a note here/);
  });
});
