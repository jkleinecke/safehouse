/**
 * Improve with Karma, rendered (FR3.7, docs/CHARGEN.md §8.5) — the panel's
 * states through `ImprovePanelView`, which is a pure function of its props;
 * the default export only adds the ledger query, the mutation and the
 * session, each tested on its own.
 *
 * Pinned: the Karma line reads the ledger's projection; the price and the
 * training time are quoted before anything is sent, and the training line
 * says it is not enforced; a rule that stops the spend is the ⛔ sentence
 * with its page and the confirm is shut and tied to it, while something still
 * to type is said quietly; the confirm asks the GM for a player and improves
 * at once for the GM; the advances below carry their state in words, not only
 * in colour; and the form's controls are a thumb's target on a phone.
 *
 * Invented names (§14). Node + `renderToStaticMarkup`, no jsdom.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SheetV1Schema, type KarmaSpend, type LedgerEntry, type SheetV1, type SheetV1Input } from '@safehouse/contracts';
import { trainingTimeOf } from '@safehouse/rules';
import { ImprovePanelView, advanceErrorText, type ImprovePanelViewProps } from './ImprovePanel.js';
import { draftFor, skillTargetValue, type ImproveDraft } from './logic.js';
import { ApiError } from '../../../api/client.js';

const SHEET: SheetV1 = SheetV1Schema.parse({
  v: 1,
  identity: { alias: 'Marrowlight', metatype: 'human' },
  attributes: { bod: 3, agi: 4, rea: 3, str: 3, wil: 3, log: 3, int: 4, cha: 2, edg: { max: 3, current: 2 } },
  skills: [
    { id: 'pistols', rating: 3, attr: 'agi' },
    { id: 'con', rating: 2, attr: 'cha' },
  ],
  knowledge: [{ name: 'Dock Gangs', category: 'street', rating: 2 }],
  languages: [{ name: 'Sperethiel', native: true }],
} as SheetV1Input);

const noop = () => undefined;

function entry(over: Partial<LedgerEntry> = {}): LedgerEntry {
  return {
    id: over.id ?? 'e1',
    characterId: 'ch-1',
    currency: 'karma',
    delta: 40,
    reason: 'Run pay',
    state: 'approved',
    createdAt: '2076-05-10T09:00:00.000Z',
    ...over,
  };
}

/** The engine's training time as the wire carries it (the route copies it the same way). */
const trainingOf = (spend: KarmaSpend) => {
  const t = trainingTimeOf(spend);
  return { steps: [...t.steps], total: t.total };
};

function advanceEntry(id: string, spend: KarmaSpend, cost: number, label: string, over: Partial<LedgerEntry> = {}): LedgerEntry {
  return entry({
    id,
    delta: -cost,
    reason: `${label} · ${cost} Karma`,
    state: 'pending',
    advance: { kind: 'advance', spend, cost, trainingTime: trainingOf(spend), label },
    ...over,
  });
}

const PAID = [entry({ id: 'pay', delta: 40 })];

function props(over: Partial<ImprovePanelViewProps> = {}): ImprovePanelViewProps {
  return {
    sheet: SHEET,
    entries: PAID,
    role: 'player',
    draft: draftFor(SHEET, 'skill', skillTargetValue('pistols')),
    onDraft: noop,
    onConfirm: noop,
    ...over,
  };
}

const render = (p: ImprovePanelViewProps) => renderToStaticMarkup(<ImprovePanelView {...p} />);
const copy = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
/** The whole opening tag of the element with this test id. */
const tag = (html: string, testId: string) => new RegExp(`<[a-z]+[^>]*data-testid="${testId}"[^>]*>`).exec(html)?.[0] ?? '';

describe('the panel before anything is sent', () => {
  it('quotes the price, the training time and the Karma available', () => {
    const html = render(props());
    const text = copy(html);
    expect(text).toContain('Raise Pistols 3 → 4');
    expect(text).toContain('costs 8 Karma');
    expect(text).toContain('Trains for 4 days.');
    expect(text).toContain('Training time is shown, not enforced.');
    expect(text).toContain('40 Karma available');
    expect(text).toContain('40 approved');
  });

  it('says the downtime ceiling a long raise passes, with its page, and nothing when it fits (pp. 105–106)', () => {
    const fits = render(props({ draft: { ...draftFor(SHEET, 'skill', skillTargetValue('pistols')), to: 6 } }));
    expect(fits).not.toContain('data-testid="improve-note"');
    const far = render(
      props({ entries: [entry({ id: 'pay', delta: 200 })], draft: { ...draftFor(SHEET, 'skill', skillTargetValue('pistols')), to: 7 } }),
    );
    const text = copy(far);
    expect(text).toContain('One downtime raises a skill by 3 ratings; this asks for 4.');
    expect(far).toContain('data-testid="improve-note"');
    // The rule is said, never enforced: the confirm is still open (the Karma allows it).
    expect(tag(far, 'improve-confirm')).not.toContain('aria-disabled');
    expect(far).toMatch(/p\.?\s*106|page=106/);
  });

  it('counts the pending entries into what is available, and says so', () => {
    const text = copy(render(props({ entries: [...PAID, advanceEntry('p1', { kind: 'attribute', id: 'agi', from: 4, to: 5 }, 25, 'Raise Agility 4 → 5')] })));
    expect(text).toContain('15 Karma available');
    expect(text).toContain('-25 waiting on the GM');
  });

  it('offers the confirm, described by the quote, in the words of who is asking', () => {
    const player = render(props());
    expect(copy(player)).toContain('Ask the GM · 8 Karma');
    expect(copy(player)).toContain('The GM approves it in the ledger');
    expect(tag(player, 'improve-confirm')).not.toContain('aria-disabled');
    // The + button and the button both point at the quote, so the price is read with them.
    const quoteId = /id="([^"]+)" class="panel[^"]*" data-testid="improve-quote"/.exec(player)?.[1];
    expect(quoteId).toBeTruthy();
    expect(tag(player, 'improve-confirm')).toContain(`aria-describedby="${quoteId}"`);

    const gm = render(props({ role: 'gm' }));
    expect(copy(gm)).toContain('Improve now · 8 Karma');
    expect(copy(gm)).toContain('Yours goes on the sheet at once.');
  });

  it('waits while the ledger is still being read', () => {
    const html = render(props({ ledgerLoading: true }));
    expect(copy(html)).toContain('Reading the ledger…');
    expect(tag(html, 'improve-confirm')).toContain('aria-disabled="true"');
  });

  it('is a thumb’s target on a phone', () => {
    const html = render(props({ draft: { ...draftFor(SHEET, 'newKnowledge'), name: 'Harbour Rumours' } }));
    for (const m of html.matchAll(/<(?:input|select)[^>]*class="([^"]*)"/g)) {
      expect(m[1], m[0]).toContain('pointer-coarse:min-h-10');
    }
    expect(html).toContain('pointer-coarse:h-10');
  });
});

describe('what stops a spend', () => {
  it('says a rule’s refusal as the answer to the press, with its page, and shuts the confirm on it', () => {
    const maxed = SheetV1Schema.parse({ ...SHEET, skills: [{ id: 'pistols', rating: 12, attr: 'agi' }] } as SheetV1Input);
    const html = render(props({ sheet: maxed, entries: [entry({ delta: 400 })], draft: draftFor(maxed, 'skill', skillTargetValue('pistols')) }));
    expect(html).toContain('data-voice="pressed"');
    expect(copy(html)).toContain('⛔');
    expect(copy(html)).toMatch(/12/);
    expect(copy(html)).toContain('SR5 p.');
    const confirm = tag(html, 'improve-confirm');
    expect(confirm).toContain('aria-disabled="true"');
    const refusalId = /<p id="([^"]+)"[^>]*data-refusal="increase" data-voice="pressed"/.exec(html)?.[1];
    expect(refusalId).toBeTruthy();
    expect(confirm).toContain(`aria-describedby="${refusalId}"`);
  });

  it('says something still to type quietly, and prices nothing yet', () => {
    const html = render(props({ draft: draftFor(SHEET, 'newKnowledge') }));
    expect(copy(html)).toContain('Nothing to price yet.');
    expect(copy(html)).toContain('Name the knowledge skill.');
    expect(html).toContain('data-voice="quiet"');
    expect(html).not.toContain('data-voice="pressed"');
    expect(tag(html, 'improve-confirm')).toContain('aria-disabled="true"');
  });

  it('refuses a price the Karma cannot pay', () => {
    const html = render(props({ entries: [entry({ delta: 3 })] }));
    expect(copy(html)).toContain('This costs 8 Karma; 3 is available.');
    expect(copy(html)).toContain('8 Karma — you have 3, 5 short');
    expect(tag(html, 'improve-confirm')).toContain('aria-disabled="true"');
  });
});

describe('the fields each kind asks for', () => {
  it('asks a new knowledge skill for a name and a category, and a specialisation for its words', () => {
    const know = render(props({ draft: draftFor(SHEET, 'newKnowledge') }));
    expect(copy(know)).toContain('Name');
    expect(copy(know)).toContain('Category');
    expect(know).toContain('data-testid="improve-rating"');

    const spec: ImproveDraft = { ...draftFor(SHEET, 'specialization', 'active|pistols'), spec: 'Revolvers' };
    const html = render(props({ draft: spec }));
    expect(copy(html)).toContain('Specialisation');
    expect(copy(html)).toContain('Specialise Pistols: Revolvers');
    expect(copy(html)).toContain('costs 7 Karma');
    // A specialisation has no rating to step.
    expect(html).not.toContain('data-testid="improve-rating"');
  });
});

describe('the advances below the form', () => {
  it('lists each with its price, training time, day and state in words', () => {
    const html = render(
      props({
        entries: [
          entry({ id: 'pay', delta: 60 }),
          advanceEntry('a1', { kind: 'attribute', id: 'agi', from: 4, to: 5 }, 25, 'Raise Agility 4 → 5', { createdAt: '2076-05-12T09:00:00.000Z' }),
          advanceEntry('a2', { kind: 'spell', name: 'Harbour Fog' }, 5, 'Learn spell Harbour Fog', {
            state: 'approved',
            createdAt: '2076-05-02T09:00:00.000Z',
          }),
        ],
      }),
    );
    const list = html.slice(html.indexOf('data-testid="improve-list"'));
    const text = copy(list);
    expect(text).toContain('Raise Agility 4 → 5');
    expect(text).toContain('25 Karma · 5 weeks · 2076-05-12');
    expect(text).toContain('waiting on the GM');
    expect(text).toContain('Learn spell Harbour Fog');
    expect(text).toContain('on the sheet');
    // Newest first.
    expect(list.indexOf('Raise Agility')).toBeLessThan(list.indexOf('Learn spell'));
  });

  it('says so when there are none', () => {
    expect(copy(render(props({ entries: PAID })))).toContain('None asked for yet.');
  });
});

describe('after the request', () => {
  it('announces what happened, and an error as an alert', () => {
    const done = render(props({ done: 'Sent to the GM: Raise Pistols 3 → 4.' }));
    expect(done).toContain('role="status"');
    expect(copy(done)).toContain('Sent to the GM: Raise Pistols 3 → 4.');
    const bad = render(props({ error: 'Raise Pistols 3 → 4 costs 8 Karma; 3 is available.' }));
    expect(bad).toContain('role="alert"');
    expect(copy(bad)).toContain('3 is available');
  });

  it('keeps the server’s own words for a refusal, and says when the server was unreachable', () => {
    expect(advanceErrorText(new ApiError(409, 'advance_refused', 'Pistols is already 12, the most a skill reaches in play.'))).toContain(
      'already 12',
    );
    expect(advanceErrorText(new ApiError(0, 'network', 'fetch failed'))).toBe('Could not reach the server. Try again.');
    expect(advanceErrorText(new Error('boom'))).toBe('boom');
    expect(advanceErrorText('nothing useful')).toBe('The request failed.');
  });
});
