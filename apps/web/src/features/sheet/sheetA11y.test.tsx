/**
 * Rendered-markup regression suite for the sheet.
 *
 * Two defects found by driving the real app in a browser are pinned here, in
 * the markup rather than in a helper:
 *
 *  - **Accessibility.** `read_page` on the live sheet returned rows of
 *    "button" wrappers with no accessible name: the skill rows were `<div>`s
 *    carrying a click handler, so a screen reader had nothing to announce and
 *    a keyboard user had no way to roll. Every interactive row must now render
 *    a real `<button>` with a name that says what activating it does.
 *  - **LIVE-2.** The sheet showed Perception 5 and the dialog offered
 *    "Roll 4d6", because the active scene's environment was applied by the
 *    server AND added again by the dialog. The dialog's dice must equal the
 *    sheet's pool.
 *
 * Rendered with `react-dom/server`, so this needs no DOM: effects do not run,
 * but structure, roles and names all do — which is exactly what was broken.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import type { DerivedCharacter, PoolBreakdown, SheetV1 } from '@safehouse/contracts';
import { SheetV1Schema } from '@safehouse/contracts';
import { deriveCharacter } from '@safehouse/rules';
import type { CharacterRecord } from './api.js';
import type { ContactRecord } from './contacts.js';
import { skillRollConfig } from './rollDialogState.js';
import CloseCallOfferCard from './components/CloseCallOffer.js';
import ContactsPanel from './components/ContactsPanel.js';
import EdgeControl from './components/EdgeControl.js';
import MonitorRow from './components/MonitorRow.js';
import RollDialog from './components/RollDialog.js';
import CombatTab from './tabs/CombatTab.js';
import MagicTab from './tabs/MagicTab.js';
import SkillsTab from './tabs/SkillsTab.js';
import type { TabProps } from './tabs/shared.js';

// ---------------------------------------------------------------------------
// Fixtures — original fiction only (G6)
// ---------------------------------------------------------------------------

function makeSheet(): SheetV1 {
  return SheetV1Schema.parse({
    v: 1,
    identity: { alias: 'Kestrel Vane', metatype: 'human' },
    attributes: {
      bod: 4,
      agi: 5,
      rea: 4,
      str: 3,
      wil: 5,
      log: 3,
      int: 4,
      cha: 4,
      edg: { max: 4, current: 3 },
      ess: 6,
      mag: 4,
      res: 0,
    },
    skills: [
      { id: 'perception', rating: 2, attr: 'int', spec: 'visual' },
      { id: 'pistols', rating: 5, attr: 'agi' },
      { id: 'spellcasting', rating: 5, attr: 'mag' },
    ],
    spells: [{ name: 'Lantern Glare', drain: 'F-3' }],
    weapons: [
      { name: 'Wren Holdout', skillId: 'pistols', modes: ['SA'], acc: 5, ammo: { cap: 6, current: 6 } },
    ],
    armor: [{ name: 'Lined coat', rating: 9, worn: true }],
  } satisfies Record<string, unknown>);
}

const SHEET = makeSheet();

function makeCharacter(): CharacterRecord {
  return {
    id: 'char-1',
    campaignId: 'camp-1',
    name: 'Kestrel Vane',
    sheet: SHEET,
    condition: { physical: 2, stun: 0 },
    edgeBurned: 1,
    balances: { karma: 12, nuyen: 4200 },
  };
}

/**
 * The scene's environment, exactly as `activeSceneModifiers` supplies it to
 * the server's `deriveView` — so every pool below is already a point down.
 */
const DIM_LIGHT = [
  {
    id: 'env.scene',
    source: { kind: 'scene' as const },
    target: 'pool.all',
    op: 'add' as const,
    value: -1,
    active: true,
    note: 'environment: light 1 → light (-1)',
  },
];

const DERIVED: DerivedCharacter = deriveCharacter(SHEET, {
  situational: DIM_LIGHT,
  wounds: { physical: 2, stun: 0 },
});

function tabProps(overrides: Partial<TabProps> = {}): TabProps {
  return {
    character: makeCharacter(),
    derived: DERIVED,
    campaignId: 'camp-1',
    patchSheet: () => {},
    setCondition: () => {},
    roll: () => {},
    overrideFor: () => ({ set: () => {}, clear: () => {} }),
    ...overrides,
  };
}

function render(node: React.ReactElement): string {
  return renderToStaticMarkup(node);
}

/** Render something that reaches for TanStack Query (the macro rack does). */
function renderWithQuery(node: React.ReactElement): string {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderToStaticMarkup(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

/** Every `aria-label` in the markup, in document order. */
function labels(html: string): string[] {
  return [...html.matchAll(/aria-label="([^"]*)"/g)].map((m) => m[1] ?? '');
}

// ---------------------------------------------------------------------------

describe('skill rows are real buttons with real names', () => {
  const html = renderWithQuery(<SkillsTab {...tabProps()} />);

  it('has no unnamed div masquerading as a button', () => {
    // The exact shape found live: role="button" on a div, no accessible name.
    expect(html).not.toContain('role="button"');
  });

  it('names each row by the roll it makes', () => {
    const perception = labels(html).find((l) => l.startsWith('Roll perception'));
    expect(perception).toBeDefined();
    // INT 4 + rating 2 − wound 0 − scene 1 = 5, and the row says so.
    expect(perception).toContain(`pool ${DERIVED.pools['skill.perception']?.total}`);
    expect(perception).toContain('mental limit');
    expect(perception).toContain('specialization visual');
  });

  it('keeps the provenance button beside the row, never nested inside it', () => {
    // A button inside a button is invalid and swallows the inner one's focus.
    expect(html).not.toMatch(/<button(?:(?!<\/button>).)*<button/s);
  });

  it('names the provenance popover trigger and says it opens one', () => {
    expect(labels(html)).toContain('perception pool: 5. Show breakdown');
    expect(html).toContain('aria-haspopup="dialog"');
  });
});

describe('other tabs lost their handler-divs too', () => {
  it('gives the defense and soak quick rolls a spoken name', () => {
    const html = render(<CombatTab {...tabProps()} />);
    expect(html).not.toContain('role="button"');
    expect(labels(html).some((l) => l.startsWith('Roll Defense, pool'))).toBe(true);
    expect(labels(html).some((l) => l.startsWith('Roll Soak, pool'))).toBe(true);
  });

  it('names a spell row by what casting it costs', () => {
    const html = render(<MagicTab {...tabProps()} />);
    expect(html).not.toContain('role="button"');
    expect(labels(html).some((l) => l.startsWith('Cast Lantern Glare'))).toBe(true);
    expect(labels(html).some((l) => l.includes('drain F-3'))).toBe(true);
  });
});

describe('monitors, limits and pools announce themselves', () => {
  it('says what each condition box will do', () => {
    const html = render(
      <MonitorRow
        label="Physical"
        short="PHY"
        size={DERIVED.monitors.physical}
        filled={2}
        tone="physical"
        onSetFilled={() => {}}
      />,
    );
    const names = labels(html);
    expect(names).toContain(
      `Physical condition monitor, 2 of ${DERIVED.monitors.physical.value} boxes filled`,
    );
    expect(names.some((l) => l.includes('Activate to heal one box'))).toBe(true);
    expect(names.some((l) => l.includes('Activate to damage to'))).toBe(true);
  });

  it('expands the cramped vitals chips for a reader', () => {
    const html = renderWithQuery(<SkillsTab {...tabProps()} />);
    const names = labels(html);
    expect(names.some((l) => l.startsWith('Physical limit,'))).toBe(true);
    expect(names.some((l) => l.includes('initiative,') && l.includes('d6'))).toBe(true);
    expect(names.some((l) => l.includes('meters per combat turn'))).toBe(true);
  });
});

describe('LIVE-2 — the dialog offers the pool the sheet shows', () => {
  const pool = DERIVED.pools['skill.perception'] as PoolBreakdown;

  it('reads "Roll 5d6" for a Perception 5 sheet in a dim scene', () => {
    expect(pool.total).toBe(5);
    const html = render(
      <RollDialog
        open
        onClose={() => {}}
        campaignId="camp-1"
        characterId="char-1"
        edgeCurrent={3}
        config={skillRollConfig(SHEET.skills[0]!, pool)}
      />,
    );
    expect(html).toContain('Roll 5d6');
    expect(html).not.toContain('Roll 4d6');
  });

  it('shows the scene once, as context rather than as a removable chip', () => {
    const html = render(
      <RollDialog
        open
        onClose={() => {}}
        campaignId="camp-1"
        characterId="char-1"
        edgeCurrent={3}
        config={skillRollConfig(SHEET.skills[0]!, pool)}
      />,
    );
    expect(html).toContain('Already in this pool');
    const occurrences = html.split('environment: light 1').length - 1;
    expect(occurrences).toBe(1);
    // The specialization is still offered — only the scene stopped being a chip.
    expect(labels(html).some((l) => l.startsWith('spec: visual'))).toBe(true);
    expect(labels(html).some((l) => l.toLowerCase().includes('environment'))).toBe(false);
  });
});

describe('the provenance popover is a proper dialog', () => {
  const html = render(
    <RollDialog
      open
      onClose={() => {}}
      campaignId="camp-1"
      characterId="char-1"
      edgeCurrent={3}
      config={skillRollConfig(SHEET.skills[0]!, DERIVED.pools['skill.perception']!)}
    />,
  );

  it('is a labelled, modal dialog a reader can enter', () => {
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toMatch(/aria-labelledby="[^"]+"/);
  });

  it('is focusable itself, so focus has somewhere to land on open', () => {
    expect(html).toContain('tabindex="-1"');
  });

  it('carries a named close control as well as its Escape handler', () => {
    expect(labels(html)).toContain('Close');
  });

  it('states the dice count for a reader, not just in a big cyan number', () => {
    expect(html).toContain('role="status"');
    expect(html).toContain('5 dice');
  });
});

describe('Edge actions (FR2.3/FR4.4)', () => {
  const edge = { max: 4, current: 3 };

  it('offers Seize the Initiative and Blitz only in a live encounter', () => {
    const inCombat = render(
      <EdgeControl
        edge={edge}
        onOp={() => {}}
        actions={{ combatantId: 'cmb-1', onAction: () => {} }}
      />,
    );
    expect(inCombat).toContain('Seize the Initiative');
    expect(inCombat).toContain('Blitz');

    const outOfCombat = render(
      <EdgeControl edge={edge} onOp={() => {}} actions={{ combatantId: null, onAction: () => {} }} />,
    );
    expect(outOfCombat).not.toContain('Seize the Initiative');
  });

  it('disables them when there is no Edge left to spend', () => {
    const html = render(
      <EdgeControl
        edge={{ max: 4, current: 0 }}
        onOp={() => {}}
        actions={{ combatantId: 'cmb-1', onAction: () => {} }}
      />,
    );
    expect(html).toContain('No Edge left.');
    expect(html).toMatch(/Seize the Initiative[^<]*<\/button>/);
    expect(html.match(/<button[^>]*disabled[^>]*>Seize the Initiative/)).toBeTruthy();
  });

  it('speaks burned Edge, which the pips cannot show', () => {
    const html = render(<EdgeControl edge={{ max: 3, current: 1 }} burned={1} onOp={() => {}} />);
    expect(labels(html)).toContain('Edge 1 of 3, 1 burned permanently');
  });

  it('offers Close Call after a critical glitch', () => {
    const html = render(
      <CloseCallOfferCard
        offer={{ rollId: 'r1', glitch: 'critical', title: 'Wren Holdout — SA', eventId: 7 }}
        edgeCurrent={2}
        onSpend={() => {}}
        onDismiss={() => {}}
      />,
    );
    expect(html).toContain('Critical glitch');
    expect(labels(html).some((l) => l.includes('spend 1 Edge to negate the critical glitch'))).toBe(
      true,
    );
  });

  it('explains itself rather than offering a spend nobody can afford', () => {
    const html = render(
      <CloseCallOfferCard
        offer={{ rollId: 'r1', glitch: 'glitch', title: 'sneaking', eventId: 7 }}
        edgeCurrent={0}
        onSpend={() => {}}
        onDismiss={() => {}}
      />,
    );
    expect(html).toContain('No Edge left to buy this one off.');
    expect(html.match(/<button[^>]*disabled[^>]*>Close Call/)).toBeTruthy();
  });
});

describe('the contacts tab (FR3.2)', () => {
  const contacts: ContactRecord[] = [
    {
      id: 'c1',
      name: 'Dozer',
      archetype: 'fixer',
      connection: 4,
      loyalty: 3,
      notes: 'Runs the Redmond end.',
      favours: { owed: 2, owing: 1 },
      npcPageId: null,
    },
  ];

  it('renders reach and reliability with names a reader can use', () => {
    const html = render(<ContactsPanel contacts={contacts} />);
    expect(html).toContain('Dozer');
    expect(labels(html)).toContain('Connection 4');
    expect(labels(html)).toContain('Loyalty 3');
    expect(html).toContain('owes you 2');
    expect(html).toContain('you owe 1');
  });

  it('says so when the list is empty rather than looking broken', () => {
    expect(render(<ContactsPanel contacts={[]} />)).toContain('No contacts on file');
  });

  it('surfaces a refusal instead of pretending the book is empty', () => {
    const html = render(
      <ContactsPanel contacts={[]} error={new Error('only the owner or the GM may read this')} />,
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain('only the owner or the GM may read this');
  });
});
