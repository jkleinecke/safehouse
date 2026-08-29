/**
 * The resolve-chain dialog's one job, tested where it can actually go wrong
 * (FR10.8 / G5).
 *
 * The dialog used to preview the exchange with `resolveAttackChain` in the
 * browser and commit only the final boxes. The damage that landed was always
 * server-applied, so the record was sound — but the dice the GM read out to the
 * table were the browser's and never reached the log. G5 is a promise about
 * *those* dice ("server-side dice with an immutable, visible roll log"), so the
 * assertions here are all one shape: the numbers on the cards are the numbers
 * the server sent, and when the server sends none there are none.
 *
 * There is no DOM in this suite (apps/web tests run in node), which is why the
 * lifecycle lives in `createChainStore` and the cards in `ChainResultView`:
 * the store is driven directly, and the view is rendered to static markup —
 * the payload, not the pixels, in the spirit of `trackerHints.test.tsx`.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiPost } from '../../api/client.js';
import { sendCommand } from './commands.js';
import {
  ChainResultView,
  chainRequest,
  chainView,
  commitBoxes,
  createChainStore,
  parseDvOverride,
  type ChainForm,
  type ChainResponse,
  type ChainState,
} from './ResolveChainDialog.js';

vi.mock('../../api/client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/client.js')>();
  return { ...actual, apiPost: vi.fn() };
});
vi.mock('./commands.js', () => ({ sendCommand: vi.fn(() => true) }));

const post = vi.mocked(apiPost);
const send = vi.mocked(sendCommand);

// ---------------------------------------------------------------------------
// One exchange, exactly as `POST /api/encounters/:id/resolve-chain` answers.
// ---------------------------------------------------------------------------

const ATTACK_FACES = [6, 6, 5, 2, 4, 1, 3, 6, 5];
const DEFENSE_FACES = [2, 3, 5, 1, 4, 6, 2];
const SOAK_FACES = [5, 1, 2, 3, 6, 4, 4, 2, 5, 1, 3, 6];

/**
 * Note the soak row: twelve faces of which four are 5+, but the server says
 * `hits: 5`. That disagreement is deliberate — a client that renders "5 hits"
 * is echoing the server, and one that renders "4" is counting dice itself.
 */
function chain(over: Partial<ChainResponse> = {}): ChainResponse {
  return {
    encounterId: 'enc-1',
    attackerId: 'cb-atk',
    defenderId: 'cb-def',
    weapon: 'snub pistol',
    bullets: 1,
    cards: [
      {
        step: 'attack',
        label: 'Attack — snub pistol',
        overridable: true,
        data: {
          pool: 9,
          breakdown: [
            { label: 'snub pistol pool', value: 10 },
            { label: 'Wounds', value: -1, source: 'wound' },
          ],
          limit: { kind: 'accuracy', value: 5 },
          roll: { faces: ATTACK_FACES, hits: 5, ones: 1, glitch: 'none', limitedHits: 4 },
        },
      },
      {
        step: 'defense',
        label: 'Defense',
        overridable: true,
        data: {
          pool: 7,
          breakdown: [
            { label: 'REA', value: 4 },
            { label: 'INT', value: 3 },
          ],
          roll: { faces: DEFENSE_FACES, hits: 2, ones: 1, glitch: 'none', limitedHits: 2 },
          netHits: 2,
          outcome: 'hit',
        },
      },
      {
        step: 'damage',
        label: 'Modified DV 9P',
        overridable: true,
        data: {
          base: { value: 7, type: 'P', raw: '7P' },
          modifiedDv: 9,
          ap: -1,
          armor: 9,
          modifiedArmor: 8,
          type: 'P',
          convertedToStun: false,
        },
      },
      {
        step: 'soak',
        label: 'Soak — 4 box(es) through',
        overridable: true,
        data: {
          pool: 12,
          breakdown: [
            { label: 'BOD', value: 4 },
            { label: 'armor', value: 8 },
          ],
          roll: { faces: SOAK_FACES, hits: 5, ones: 2, glitch: 'none', limitedHits: 5 },
          boxes: 4,
          track: 'physical',
        },
      },
      {
        step: 'apply',
        label: 'Apply 4 to physical',
        overridable: true,
        data: { boxes: 4, track: 'physical', projected: null, woundModifier: null },
      },
    ],
    suggested: { boxes: 4, track: 'physical' },
    notes: ['Modified DV beat armor.'],
    chainId: 'ab12cd34-5678-4abc-9def-000000000001',
    rolls: [
      { step: 'attack', rollId: 'roll-a' },
      { step: 'defense', rollId: 'roll-d' },
      { step: 'soak', rollId: 'roll-s' },
    ],
    committed: false,
    ...over,
  };
}

const FORM: ChainForm = {
  attackerId: 'cb-atk',
  defenderId: 'cb-def',
  weaponName: 'snub pistol',
  fullDefense: false,
  attackMod: 0,
  defenseMod: 0,
  dv: '',
  ap: '',
};

function store() {
  return createChainStore({ campaignId: 'camp-1', encounterId: 'enc-1' });
}

function ready(over: Partial<ChainState> = {}): ChainState {
  return { status: 'ready', result: chain(), error: null, boxes: 4, committed: false, ...over };
}

function markup(state: ChainState): string {
  return renderToStaticMarkup(
    <ChainResultView
      state={state}
      onBoxes={() => undefined}
      onCommit={() => undefined}
      onDiscard={() => undefined}
    />,
  );
}

/** Every die tile the view drew, in order (`DiceFaces` labels each one). */
function renderedFaces(html: string): number[] {
  return [...html.matchAll(/d6: (\d)/g)].map((m) => Number(m[1]));
}

beforeEach(() => {
  post.mockReset();
  send.mockReset();
  send.mockReturnValue(true);
});

describe('the dice are the server’s (G5)', () => {
  it('makes exactly one authoritative call, even if the button is hit twice', async () => {
    const s = store();
    post.mockResolvedValue(chain());

    // Two presses, no await between them — the second must not become a second
    // exchange on the record.
    await Promise.all([s.roll(chainRequest(FORM)), s.roll(chainRequest(FORM))]);

    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0]?.[0]).toBe('/api/encounters/enc-1/resolve-chain');
    expect(post.mock.calls[0]?.[1]).toEqual({
      attackerId: 'cb-atk',
      defenderId: 'cb-def',
      weaponName: 'snub pistol',
    });
    expect(s.getState().status).toBe('ready');
    expect(s.getState().result?.chainId).toBe('ab12cd34-5678-4abc-9def-000000000001');
    expect(s.getState().boxes).toBe(4);
  });

  it('renders the faces the endpoint rolled — all of them, and no others', () => {
    const faces = renderedFaces(markup(ready()));
    expect(faces).toEqual([...ATTACK_FACES, ...DEFENSE_FACES, ...SOAK_FACES]);
  });

  it('reports the server’s hit counts rather than recounting the faces', () => {
    const html = markup(ready());
    // Attack shows limited hits (4 of 5 — the accuracy limit), defence 2, and
    // soak the server's 5 even though only four of its twelve faces are 5+.
    expect(html).toContain('4 hits');
    expect(html).toContain('2 hits');
    expect(html).toContain('5 hits');
    expect(html).not.toContain('>4</span> hits');
  });

  it('shows that the exchange is already on the record', () => {
    const html = markup(ready());
    expect(html).toContain('3 pools on the record');
    expect(html).toContain('ab12cd34');
  });

  it('keeps no dice engine of its own', () => {
    const src = readFileSync(
      fileURLToPath(new URL('./ResolveChainDialog.tsx', import.meta.url)),
      'utf8',
    );
    // The three ways browser dice could come back: the rules chain, a raw RNG,
    // or the rules package at all.
    expect(src).not.toContain('resolveAttackChain');
    expect(src).not.toContain('Math.random');
    expect(src).not.toContain('@safehouse/rules');
    expect(src).toContain('/resolve-chain');
  });
});

describe('the GM still overrides before anything lands (Principle 2 / FR10.8)', () => {
  it('commits the GM’s boxes, not the server’s suggestion', async () => {
    const s = store();
    post.mockResolvedValue(chain());
    await s.roll(chainRequest(FORM));

    s.setBoxes(2); // the server suggested 4
    expect(commitBoxes(s.getState())).toBe(2);
    expect(s.commit({ attackerName: 'Wrecker' })).toBe(true);

    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[0]).toBe('camp-1');
    expect(send.mock.calls[0]?.[1]).toMatchObject({
      cmd: 'damage.apply',
      combatantId: 'cb-def',
      encounterId: 'enc-1',
      monitor: 'physical',
      boxes: 2,
    });
    // The applied damage points back at the recorded dice (Principle 3).
    expect(String((send.mock.calls[0]?.[1] as { note?: string }).note)).toContain('ab12cd34');
  });

  it('puts the override in the commit field, so the GM sees what will land', () => {
    expect(markup(ready({ boxes: 2 }))).toContain('value="2"');
  });

  it('applies the damage once however many times commit is pressed', async () => {
    const s = store();
    post.mockResolvedValue(chain());
    await s.roll(chainRequest(FORM));

    expect(s.commit()).toBe(true);
    expect(s.commit()).toBe(false);
    expect(s.commit()).toBe(false);
    expect(send).toHaveBeenCalledTimes(1);
    expect(markup({ ...s.getState() })).toContain('disabled=""');
  });

  it('refuses to commit a miss', async () => {
    const s = store();
    post.mockResolvedValue(chain({ suggested: null, cards: [] }));
    await s.roll(chainRequest(FORM));

    expect(commitBoxes(s.getState())).toBe(0);
    expect(s.commit()).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it('lets the GM try again when the socket refused the command', async () => {
    const s = store();
    post.mockResolvedValue(chain());
    await s.roll(chainRequest(FORM));

    send.mockReturnValueOnce(false);
    expect(s.commit()).toBe(false);
    expect(s.getState().committed).toBe(false);
    expect(s.getState().error).toContain('not connected');

    expect(s.commit()).toBe(true);
    expect(send).toHaveBeenCalledTimes(2);
  });
});

describe('a server that cannot answer is reported, never replaced', () => {
  it('surfaces an unreachable server and shows no dice at all', async () => {
    const s = store();
    post.mockRejectedValue(new ApiError(0, 'network_error', 'fetch failed'));
    await s.roll(chainRequest(FORM));

    const state = s.getState();
    expect(state.status).toBe('error');
    expect(state.result).toBeNull();
    expect(state.error).toContain('could not be reached');

    const html = markup(state);
    expect(html).toContain('role="alert"');
    expect(html).toContain('fetch failed');
    expect(renderedFaces(html)).toEqual([]);
    expect(html).not.toContain('Commit damage');
  });

  it('passes the server’s own refusal through (a sheet-less combatant, 409)', async () => {
    const s = store();
    post.mockRejectedValue(
      new ApiError(409, 'conflict', 'both sides need a sheet to resolve a chain (FR10.8)'),
    );
    await s.roll(chainRequest(FORM));

    const html = markup(s.getState());
    expect(html).toContain('both sides need a sheet');
    expect(html).toContain('conflict');
    expect(renderedFaces(html)).toEqual([]);
  });

  it('never commits off a failed exchange', async () => {
    const s = store();
    post.mockRejectedValue(new ApiError(500, 'internal', 'boom'));
    await s.roll(chainRequest(FORM));

    expect(s.commit()).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it('clears a stale exchange when the GM edits an input', async () => {
    const s = store();
    post.mockResolvedValue(chain());
    await s.roll(chainRequest(FORM));
    expect(s.getState().result).not.toBeNull();

    s.clear();
    expect(s.getState()).toEqual({
      status: 'idle',
      result: null,
      error: null,
      boxes: null,
      committed: false,
    });
    expect(markup(s.getState())).toBe('');
  });
});

describe('the request carries only what the GM set', () => {
  it('omits every untouched knob', () => {
    expect(chainRequest(FORM)).toEqual({
      attackerId: 'cb-atk',
      defenderId: 'cb-def',
      weaponName: 'snub pistol',
    });
  });

  it('sends overrides and situational dice for the SERVER to apply', () => {
    expect(
      chainRequest({ ...FORM, fullDefense: true, dv: '9s', ap: '-3', attackMod: -2, defenseMod: 1 }),
    ).toEqual({
      attackerId: 'cb-atk',
      defenderId: 'cb-def',
      weaponName: 'snub pistol',
      fullDefense: true,
      dvOverride: { value: 9, type: 'S' },
      apOverride: -3,
      attackModifiers: [{ label: 'GM situational (attack)', value: -2, source: 'situational' }],
      defenseModifiers: [{ label: 'GM situational (defense)', value: 1, source: 'situational' }],
    });
  });

  it('reads a damage code, and refuses one it cannot', () => {
    expect(parseDvOverride('8')).toEqual({ value: 8, type: 'P' });
    expect(parseDvOverride(' 10S ')).toEqual({ value: 10, type: 'S' });
    expect(parseDvOverride('')).toBeNull();
    expect(parseDvOverride('STR+2')).toBeNull();
  });
});

describe('the cards are read, not recomputed', () => {
  it('takes every displayed number straight off the wire', () => {
    const view = chainView(chain());
    expect(view.attack?.pool).toBe(9);
    expect(view.attack?.limit).toEqual({ kind: 'accuracy', value: 5 });
    expect(view.attack?.roll?.faces).toEqual(ATTACK_FACES);
    expect(view.defense?.netHits).toBe(2);
    expect(view.defense?.outcome).toBe('hit');
    expect(view.damage?.modifiedDv).toBe(9);
    expect(view.damage?.modifiedArmor).toBe(8);
    expect(view.soak?.boxes).toBe(4);
    expect(view.soak?.track).toBe('physical');
    expect(view.soak?.roll?.hits).toBe(5);
  });

  it('survives a card the server did not send (a miss has no soak)', () => {
    const missed = chain({
      cards: chain().cards.filter((c) => c.step === 'attack' || c.step === 'defense'),
      suggested: null,
      rolls: [
        { step: 'attack', rollId: 'roll-a' },
        { step: 'defense', rollId: 'roll-d' },
      ],
      notes: ['Tie — the defense holds.'],
    });
    const view = chainView(missed);
    expect(view.damage).toBeNull();
    expect(view.soak).toBeNull();

    const html = markup({ status: 'ready', result: missed, error: null, boxes: 0, committed: false });
    expect(html).toContain('Tie — the defense holds.');
    expect(renderedFaces(html)).toEqual([...ATTACK_FACES, ...DEFENSE_FACES]);
    expect(html).toContain('2 pools on the record');
  });

  it('marks the Full Defense card as such', () => {
    const full = chain({
      cards: chain().cards.map((c) =>
        c.step === 'defense' ? { ...c, label: 'Defense (Full Defense)' } : c,
      ),
    });
    expect(chainView(full).defense?.fullDefense).toBe(true);
    expect(markup({ ...ready(), result: full })).toContain('full def.');
  });
});
