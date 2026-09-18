/**
 * The Skills screen as markup (FR3.9, docs/CHARGEN.md §4.4 Step 6).
 *
 * `renderToStaticMarkup` draws the states a player meets — a draft with no
 * priority yet, a concept build fully spent, a pool spent past what it holds,
 * a skill at its creation maximum, a bought group, a Magic column grant, a
 * mundane's closed Magic skills, the knowledge pool and the native pick, a
 * read-only build and the GM's review — and asserts what a player (or a
 * screen reader) is told in each: the engine's own sentences and pages, tied
 * to the control they shut, headings in order under the frame's h1, lists as
 * lists. What a tap does is `model.test.ts`'s; here only what is on screen.
 * Every runner is invented, built from a concept card the way the app builds
 * one.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { CharacterBuild } from '@safehouse/contracts';
import { analyseBuild } from '../../analysis.js';
import { issuesForStep } from '../../lib.js';
import { BUILD_ID, CAMPAIGN, SETTINGS, blankBuild, conceptBuild } from '../../testing.js';
import SkillsStep, { initialSkillFilter } from '../Skills.js';
import { stepMeta } from '../meta.js';
import { inertActions, type StepProps } from '../types.js';
import SkillsView from './SkillsView.js';
import { SpecSlotView } from './parts.js';
import {
  addLanguage,
  knowledgeQuote,
  patchLanguage,
  setActivePoints,
  setActiveTarget,
  skillDice,
  diceWords,
  type SkillFilter,
} from './model.js';

const noop = () => undefined;

function propsFor(build: CharacterBuild, over: Partial<StepProps> = {}): StepProps {
  const a = analyseBuild(build, SETTINGS);
  return {
    campaignId: CAMPAIGN,
    buildId: BUILD_ID,
    characterId: null,
    isOwner: true,
    meta: stepMeta(6),
    build,
    settings: SETTINGS,
    settingsFromCampaign: true,
    budgets: a.budgets,
    issues: issuesForStep(a.issues, 6),
    allIssues: a.issues,
    status: a.steps[5]!,
    steps: a.steps,
    eligibility: a.eligibility,
    preview: a.preview,
    ratings: a.ratings,
    probe: a.probe,
    update: noop,
    goTo: noop,
    readOnly: false,
    reviewMode: false,
    mode: 'guided',
    role: 'player',
    actions: inertActions(),
    ...over,
  };
}

const ALL: SkillFilter = { query: '', onlyMine: false };

function view(build: CharacterBuild, filter: SkillFilter = ALL, over: Partial<StepProps> = {}): string {
  return renderToStaticMarkup(<SkillsView {...propsFor(build, over)} filter={filter} onFilter={noop} />);
}

/** The markup of one `<li>` row, by its data attribute. */
function row(html: string, attr: 'data-skill' | 'data-group', id: string): string {
  const start = html.indexOf(`${attr}="${id}"`);
  if (start < 0) throw new Error(`no row ${attr}=${id}`);
  const open = html.lastIndexOf('<li', start);
  // Rows hold nested lists (issue notes), so walk to the matching close.
  let depth = 0;
  let i = open;
  for (;;) {
    const nextOpen = html.indexOf('<li', i + 1);
    const nextClose = html.indexOf('</li>', i + 1);
    if (nextClose < 0) throw new Error(`unclosed row ${attr}=${id}`);
    if (nextOpen >= 0 && nextOpen < nextClose) {
      depth++;
      i = nextOpen;
    } else if (depth === 0) {
      return html.slice(open, nextClose + 5);
    } else {
      depth--;
      i = nextClose;
    }
  }
}

/** Visible text, tags stripped. */
const text = (html: string): string => html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/\s+/g, ' ');

/** The element whose id a control's aria-describedby names. */
function describedText(html: string, controlPattern: RegExp): string {
  const control = controlPattern.exec(html)?.[0];
  if (!control) throw new Error(`no control ${controlPattern}`);
  const id = /aria-describedby="([^"]+)"/.exec(control)?.[1];
  if (!id) throw new Error('control has no aria-describedby');
  const at = html.indexOf(`id="${id}"`);
  expect(at, `element #${id}`).toBeGreaterThan(-1);
  const open = html.lastIndexOf('<', at);
  const tag = /^<([a-z]+)/.exec(html.slice(open))?.[1] ?? 'p';
  return text(html.slice(open, html.indexOf(`</${tag}>`, at)));
}

describe('an empty draft', () => {
  it('names the missing priority, offers step 2, and still lists every skill and group', () => {
    const html = view(blankBuild());
    expect(text(html)).toContain('No priority is set for skills yet');
    expect(html).toContain('data-testid="skills-go-priorities"');
    expect(html.match(/data-testid="skill-row"/g)).toHaveLength(75);
    expect(html.match(/data-testid="group-row"/g)).toHaveLength(15);
    expect(text(html)).toContain('All 75 skills and 15 groups');
  });
});

describe('a spent build', () => {
  const build = conceptBuild('muscle');
  const html = view(build);

  it('says each pool where it is spent, never mixing them', () => {
    expect(html).toMatch(/data-pool="groups"[^>]*>0 of 0 group points left</);
    expect(html).toMatch(/data-pool="skills"[^>]*>0 of 22 skill points left</);
    expect(html).toMatch(/data-pool="knowledge"[^>]*>0 of 6 knowledge points left</);
    expect(text(html)).toContain('Priority D gives 22 skill points and 0 group points.');
  });

  it('gives each open skill a labelled stepper and its dice from the derived preview', () => {
    const automatics = row(html, 'data-skill', 'automatics');
    expect(automatics).toContain('aria-label="increase Automatics"');
    expect(automatics).toContain('data-refused="no"');
    const dice = skillDice(analyseBuild(build, SETTINGS).preview.derived, 'automatics')!;
    expect(text(automatics)).toContain(diceWords(dice));
    expect(automatics).toContain(`dice pool ${dice.total}`);
  });

  it("greys a mundane's Magic and Resonance skills with the engine's reason and page", () => {
    const spellcasting = row(html, 'data-skill', 'spellcasting');
    expect(spellcasting).toContain('data-closed="yes"');
    expect(text(spellcasting)).toContain('Spellcasting needs a Magic rating and a magic-using type.');
    expect(text(spellcasting)).toContain('SR5 p.89');
    expect(spellcasting).not.toContain('increase Spellcasting');
    expect(text(row(html, 'data-skill', 'registering'))).toContain('Registering is for technomancers only.');
    expect(text(row(html, 'data-group', 'sorcery'))).toContain('needs a Magic rating');
  });

  it('warns a group whose members hold points of their own', () => {
    expect(text(row(html, 'data-group', 'firearms'))).toContain('Automatics and Pistols already have ranks of their own; a group cannot be bought over them.');
  });

  it('offers a specialisation on a rated skill, and quotes its price, tied to the field, once it is open', () => {
    const automatics = row(html, 'data-skill', 'automatics');
    expect(automatics).toMatch(/<button[^>]*aria-label="\+ specialisation for Automatics"[^>]*data-testid="skill-spec-add"/);
    expect(row(html, 'data-skill', 'archery')).not.toContain('specialisation');
    const a = analyseBuild(build, SETTINGS);
    const open = renderToStaticMarkup(
      <SpecSlotView
        name="Automatics"
        spec=""
        rated
        readOnly={false}
        adding
        onAdding={noop}
        onChange={noop}
        price={() => ({ pool: 'skills', amount: 1 })}
        budgets={a.budgets}
        testId="skill-spec"
      />,
    );
    expect(open).toContain('Specialisation for Automatics');
    expect(describedText(open, /<input[^>]*data-testid="skill-spec-input"[^>]*>/)).toContain('costs 1 skill point — you have 0, 1 short');
    const named = renderToStaticMarkup(
      <SpecSlotView name="Automatics" spec="Assault rifles" rated readOnly={false} adding={false} onAdding={noop} onChange={noop} price={() => null} budgets={a.budgets} testId="skill-spec" />,
    );
    expect(named).toMatch(/<input[^>]*value="Assault rifles"/);
    expect(named).not.toContain('data-testid="cost-quote"');
  });

  it('keeps headings in order under the frame’s h1, and every list a list', () => {
    expect(html).not.toMatch(/<h1/);
    const levels = [...html.matchAll(/<h([1-6])/g)].map((m) => Number(m[1]));
    expect(levels[0]).toBe(2);
    for (let i = 1; i < levels.length; i++) expect(levels[i]! - levels[i - 1]!).toBeLessThanOrEqual(1);
    expect(text(html)).toMatch(/Skill groups .* Active skills .* Knowledge & languages/);
    expect(html).toContain('aria-label="Agility skills"');
    expect(html).toContain('aria-label="Skill groups"');
  });

  it('is one column of wrapping rows with thumb-sized controls for a phone', () => {
    expect(html).toMatch(/<input[^>]*type="search"/);
    expect(html).toMatch(/<label[^>]*class="sr-only"[^>]*>Find a skill or group<\/label>/);
    expect(html).toMatch(/<label class="inline-flex min-h-10[^"]*"><input type="checkbox"/);
    expect(html).toContain('pointer-coarse:h-10');
    // Nothing wider than a phone: no fixed widths past 12rem.
    for (const m of html.matchAll(/min-w-\[(\d+)rem\]/g)) expect(Number(m[1])).toBeLessThanOrEqual(12);
  });
});

describe('refusals', () => {
  it('spending past the pool is said in words, and does not shut the steppers', () => {
    const build = setActivePoints(conceptBuild('muscle'), { id: 'sneaking', index: null }, 3);
    const html = view(build);
    expect(html).toMatch(/data-pool="skills" data-over="yes"[^>]*>(<span[^>]*>✕ <\/span>)?3 skill points over: 25 spent of 22</);
    expect(row(html, 'data-skill', 'sneaking')).toMatch(/aria-label="increase Sneaking" data-refused="no"/);
  });

  it("a skill at its creation maximum refuses a seventh rank with the validator's sentence tied to the button", () => {
    const html = view(setActivePoints(conceptBuild('muscle'), { id: 'automatics', index: null }, 6));
    const automatics = row(html, 'data-skill', 'automatics');
    expect(automatics).toMatch(/aria-label="increase Automatics" aria-disabled="true"/);
    expect(describedText(automatics, /<button[^>]*aria-label="increase Automatics"[^>]*>/)).toContain(
      'Automatics 7 is over the creation maximum of 6.',
    );
    // Nobody pressed it yet: a quiet "at 6", the sentence for a screen reader, no red ⛔ (the press brings the ⛔ and page).
    expect(automatics).toContain('data-voice="quiet"');
    expect(automatics).toContain('<span aria-hidden="true">at 6</span>');
    expect(automatics).not.toContain('⛔');
    // The refusal sits under the whole row, not inside the stepper, so refused rows keep their buttons in line.
    const stepper = /data-testid="skill-stepper">(.*?)<\/div><\/div>/.exec(automatics)![1]!;
    expect(stepper).not.toContain('data-refusal');
  });

  it("a second native language refuses without Bilingual, the reason tied to the toggle", () => {
    let build = addLanguage(addLanguage(conceptBuild('muscle'), true), false);
    build = patchLanguage(patchLanguage(build, 0, { name: 'Tongue A' }), 1, { name: 'Tongue B', points: 0 });
    const html = view(build);
    const toggles = [...html.matchAll(/<button[^>]*data-testid="language-native"[^>]*>/g)].map((m) => m[0]);
    expect(toggles[0]).toContain('aria-pressed="true"');
    expect(toggles[1]).toContain('aria-disabled="true"');
    expect(describedText(html, /<button[^>]*aria-label="native — Tongue B"[^>]*>/)).toContain("Can't mark it native: 2 native languages; one is free.");
    // Said as what the tap would do, and quietly until it is pressed: nobody reads it as the build already having two.
    const tongueB = html.slice(html.indexOf('aria-label="native — Tongue B"'));
    expect(tongueB).toContain('data-voice="quiet"');
    expect(tongueB).toContain('<span aria-hidden="true">no free native slot left</span>');
    // With a free native slot left, no toggle is even asked about.
    const one = patchLanguage(addLanguage(conceptBuild('muscle'), false), 0, { name: 'Tongue C' });
    expect(view(one)).not.toContain('data-refusal="increase"');
  });
});

describe('the Skills step does not validate the build once per row', () => {
  it('probes only the rows one rank from a cap — a handful per render, not a hundred', () => {
    for (const concept of ['muscle', 'street-mage', 'face']) {
      const build = conceptBuild(concept);
      const props = propsFor(build);
      let calls = 0;
      const probe: StepProps['probe'] = (fn, key) => {
        calls += 1;
        return props.probe(fn, key);
      };
      renderToStaticMarkup(<SkillsView {...props} probe={probe} filter={ALL} onFilter={noop} />);
      expect(calls, concept).toBeLessThan(20);
    }
  });
});

describe('groups and grants', () => {
  it('locks the members of a bought group, and offers back the points of one that has its own', () => {
    const face = conceptBuild('face');
    const etiquette = row(view(face), 'data-skill', 'etiquette');
    expect(text(etiquette)).toContain('Rated 6 through the Influence group.');
    expect(etiquette).not.toContain('increase Etiquette');
    expect(etiquette).not.toContain('Specialisation for');

    const conflicted = row(view(setActivePoints(face, { id: 'etiquette', index: null }, 2)), 'data-skill', 'etiquette');
    expect(conflicted).toContain('data-issue="skill-in-bought-group"');
    expect(conflicted).toContain('data-testid="skill-return-points"');
  });

  it('shows a Magic column grant locked at its floor, and says where to change it', () => {
    const mage = conceptBuild('street-mage');
    const granted = row(view(mage), 'data-skill', 'spellcasting');
    expect(text(granted)).toContain('granted 5');
    expect(granted).toMatch(/<output[^>]*>6<\/output>/);
    const floor = row(view(setActivePoints(mage, { id: 'spellcasting', index: null }, 0)), 'data-skill', 'spellcasting');
    expect(floor).toMatch(/<output[^>]*>5<\/output>/);
    expect(describedText(floor, /<button[^>]*aria-label="decrease Spellcasting"[^>]*>/)).toContain(
      '5 of Spellcasting was granted in step 4; change it there.',
    );
  });

  it("closes an adept's magical groups with the engine's sentence", () => {
    const sorcery = row(view(conceptBuild('adept')), 'data-group', 'sorcery');
    expect(sorcery).toContain('data-closed="yes"');
    expect(text(sorcery)).toContain('Adepts cannot take Sorcery.');
    expect(sorcery).not.toContain('data-testid="group-stepper"');
  });
});

describe('specific skills', () => {
  it('asks which weapon, and offers another once this one is named', () => {
    const blank = row(view(conceptBuild('muscle')), 'data-skill', 'exotic-ranged');
    expect(blank).toContain('Weapon for Exotic Ranged Weapon');
    expect(blank).not.toContain('data-testid="skill-add-target"');

    const named = setActivePoints(setActiveTarget(conceptBuild('muscle'), { id: 'exotic-ranged', index: null }, 'Dart thrower'), {
      id: 'exotic-ranged',
      index: conceptBuild('muscle').skills.active.length,
    }, 2);
    const html = row(view(named), 'data-skill', 'exotic-ranged');
    expect(html).toMatch(/<input[^>]*value="Dart thrower"/);
    expect(html).toContain('aria-label="increase Exotic Ranged Weapon (Dart thrower)"');
    expect(html).toContain('data-testid="skill-add-target"');
    expect(html).toContain('aria-label="remove Exotic Ranged Weapon (Dart thrower)"');
  });
});

describe('knowledge and languages', () => {
  const build = conceptBuild('muscle');
  const html = view(build);

  it('quotes the free pool with the numbers from the ratings, and states the trade', () => {
    const a = analyseBuild(build, SETTINGS);
    const quote = knowledgeQuote(a.ratings, a.budgets.pools.knowledge);
    expect(text(html)).toContain(`${quote.text}.`);
    expect(text(html)).toContain('Any rank below can be paid from the active skill points instead, at 1 skill point a rank');
    expect(html.match(/data-testid="knowledge-category-section"/g)).toHaveLength(4);
    expect(html.match(/data-testid="knowledge-row"/g)).toHaveLength(build.skills.knowledge.length);
    expect(html).toContain('aria-label="increase Skill points on Gang turf lines"');
    expect(html).toContain('aria-label="increase Knowledge points on Gang turf lines"');
  });

  it("asks for a native language with the engine's warning, and offers the free pick", () => {
    expect(text(html)).toContain('Choose a native language: one is free.');
    expect(html).toMatch(/data-testid="language-list-issues"[\s\S]*Choose a native language\./);
    expect(html).toContain('data-testid="language-add-native"');
  });
});

describe('search and show only mine', () => {
  const build = conceptBuild('muscle');

  it('narrows both lists as a phone user types', () => {
    const html = view(build, { query: 'pist', onlyMine: false });
    expect(html.match(/data-testid="skill-row"/g)).toHaveLength(1);
    expect(html).toContain('data-skill="pistols"');
    expect(html.match(/data-testid="group-row"/g)).toHaveLength(1);
    expect(html).toContain('data-group="firearms"');
    expect(text(html)).toContain('Showing 1 of 75 skills and 1 of 15 groups');
  });

  it('hands back the whole list when nothing matches', () => {
    const html = view(build, { query: 'underwater basket', onlyMine: false });
    expect(text(html)).toContain('No skill or group matches “underwater basket”.');
    expect(html).toContain('data-testid="skills-filter-clear"');
  });
});

describe('read-only and review', () => {
  const build = conceptBuild('muscle');

  it("opens on the runner's own skills, with values and no edits", () => {
    expect(initialSkillFilter({ readOnly: true, reviewMode: false }).onlyMine).toBe(true);
    expect(initialSkillFilter({ readOnly: false, reviewMode: false }).onlyMine).toBe(false);
    const html = renderToStaticMarkup(<SkillsStep {...propsFor(build, { readOnly: true })} />);
    expect(html).toMatch(/<input type="checkbox"[^>]*checked=""/);
    expect(text(html)).toContain('Showing 6 of 75 skills and 0 of 15 groups');
    expect(html).not.toContain('aria-label="increase');
    expect(html).not.toMatch(/<input[^>]*type="text"/);
    expect(html).not.toContain('data-testid="language-add');
    expect(html).not.toContain('data-testid="knowledge-remove"');
    expect(html).not.toContain('data-testid="knowledge-trade"');
    expect(row(html, 'data-skill', 'automatics')).toMatch(/<output[^>]*>5<\/output>/);
    expect(text(html)).toContain('Gang turf lines');
  });

  it("shows the GM the runner's own skills in review", () => {
    const html = renderToStaticMarkup(<SkillsStep {...propsFor(build, { readOnly: true, reviewMode: true, role: 'gm', mode: 'free' })} />);
    expect(html.match(/data-testid="skill-row"/g)).toHaveLength(6);
    expect(html).not.toContain('data-testid="skills-go-priorities"');
  });
});

describe('rows closed to this runner, folded away', () => {
  it('puts a mundane runner\'s magic and resonance rows in one folded list under one line, each still saying why', () => {
    const html = view(conceptBuild('face'));
    const closed = html.slice(html.indexOf('data-testid="skills-closed"'));
    expect(closed).toMatch(/<h2[^>]*>Closed to this runner<\/h2>/);
    expect(closed).toMatch(/\d+ skills and \d+ groups are closed to this runner: none can take points here, and each says why\./);
    expect(closed).toContain('<details');
    expect(closed).toContain('data-skill="spellcasting"');
    expect(closed).toContain('Spellcasting needs a Magic rating and a magic-using type.');
    // Quiet: information, not a red refusal.
    expect(closed).not.toContain('⛔');
    // The open lists above no longer carry them.
    const active = html.slice(html.indexOf('data-testid="skills-active"'), html.indexOf('data-testid="skills-closed"'));
    expect(active).not.toContain('data-skill="spellcasting"');
    // A search opens the fold, and says the knowledge list is not searched.
    const searched = view(conceptBuild('face'), { query: 'spell', onlyMine: false });
    expect(searched).toMatch(/<details[^>]*open=""/);
    expect(searched).toContain('the knowledge skills and languages below are not searched');
  });

  it('starts "show only mine" on a phone once skills are bought, and not before', () => {
    const reader = { readOnly: false, reviewMode: false };
    expect(initialSkillFilter({ ...reader, build: conceptBuild('muscle') }, true).onlyMine).toBe(true);
    expect(initialSkillFilter({ ...reader, build: blankBuild() }, true).onlyMine).toBe(false);
    expect(initialSkillFilter({ ...reader, build: conceptBuild('muscle') }, false).onlyMine).toBe(false);
  });
});
