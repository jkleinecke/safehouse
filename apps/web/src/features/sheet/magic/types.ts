/**
 * Wire shapes for the magic toolkit (DESIGN.md FR8.2–FR8.4).
 *
 * The server keeps spirits, foci and reagent counters on the campaign's magic
 * shelf (`services/magic-store.ts`) and hands a mage their whole picture in one
 * read: `GET /api/characters/:id/magic/derived` → `MagicDerivedView`. These are
 * the client mirrors of that, plus tolerant normalizers in the house style — a
 * body that arrives half-shaped degrades to "nothing tracked", never to a
 * thrown render.
 *
 * Nothing here filters anything: a GM-side spirit (no summoner) is dropped by
 * the hub and by the route before it reaches this device (Principle 4), so the
 * client's job is only to render what it was given.
 */
import type { DerivedCharacter, Modifier, Ref } from '@safehouse/contracts';
import type { SustainingReport } from '@safehouse/rules';

export type SpiritStatus = 'summoned' | 'dismissed';
export type FocusSourceKind = 'power' | 'spell';

/** One tracked spirit (`SpiritRecord` server-side). */
export interface SpiritRow {
  id: string;
  /** The summoner; `null` is a GM-side spirit and never reaches a player. */
  characterId: string | null;
  name: string;
  /** The GM's own label for the kind — the app ships no bestiary (§14). */
  spiritType: string;
  force: number;
  bound: boolean;
  services: number;
  servicesInitial: number;
  status: SpiritStatus;
  /** Sustained-entry id this spirit is holding for its summoner (FR8.2). */
  sustainingSpellId: string | null;
  combatantId: string | null;
  encounterId: string | null;
  note: string;
}

/** One bonded focus (`FocusRecord` server-side). */
export interface FocusRow {
  id: string;
  characterId: string;
  name: string;
  kind: string;
  force: number;
  /** Unbonded foci are inert however switched-on they look (FR8.4). */
  bonded: boolean;
  active: boolean;
  sourceKind: FocusSourceKind;
  /** Pipeline targets fed at Force when no explicit `mods` are given. */
  targets: string[];
  mods: Modifier[];
  ref?: Ref;
  note: string;
}

/**
 * `GET /api/characters/:id/magic/derived` — the mage's whole surface.
 *
 * `derived` here is the character derived WITH bonded foci and spirit
 * sustaining folded into the pipeline, which is what makes a focus toggle move
 * a pool. `situational` is every modifier that produced it (Principle 3).
 */
export interface MagicView {
  characterId: string;
  name: string;
  derived: DerivedCharacter | null;
  situational: Modifier[];
  /** The focus half of `situational`, called out for the toggle rack. */
  focusModifiers: Modifier[];
  foci: FocusRow[];
  spirits: SpiritRow[];
  sustaining: SustainingReport;
  reagents: number;
  activeSceneId: string | null;
}

// ---------------------------------------------------------------------------
// Normalizers
// ---------------------------------------------------------------------------

function rec(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};
}

function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

function nullableStr(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

function int(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : fallback;
}

function bool(v: unknown, fallback = false): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

function list(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function modifiers(v: unknown): Modifier[] {
  return list(v).filter(
    (m): m is Modifier => typeof rec(m)['target'] === 'string' && typeof rec(m)['id'] === 'string',
  );
}

function refOf(v: unknown): Ref | undefined {
  const r = rec(v);
  if (typeof r['book'] !== 'string' || typeof r['page'] !== 'number') return undefined;
  return { book: r['book'], page: r['page'], ...(typeof r['note'] === 'string' ? { note: r['note'] } : {}) };
}

export function normalizeSpirit(raw: unknown): SpiritRow | null {
  const s = rec(raw);
  if (typeof s['id'] !== 'string') return null;
  const services = int(s['services']);
  return {
    id: s['id'],
    characterId: nullableStr(s['characterId']),
    name: str(s['name'], 'Spirit'),
    spiritType: str(s['spiritType'], 'spirit'),
    force: Math.max(1, int(s['force'], 1)),
    bound: bool(s['bound']),
    services: Math.max(0, services),
    servicesInitial: Math.max(Math.max(0, services), int(s['servicesInitial'], services)),
    status: s['status'] === 'dismissed' ? 'dismissed' : 'summoned',
    sustainingSpellId: nullableStr(s['sustainingSpellId']),
    combatantId: nullableStr(s['combatantId']),
    encounterId: nullableStr(s['encounterId']),
    note: str(s['note']),
  };
}

export function normalizeFocus(raw: unknown): FocusRow | null {
  const f = rec(raw);
  if (typeof f['id'] !== 'string' || typeof f['characterId'] !== 'string') return null;
  const ref = refOf(f['ref']);
  return {
    id: f['id'],
    characterId: f['characterId'],
    name: str(f['name'], 'Focus'),
    kind: str(f['kind']),
    force: Math.max(0, int(f['force'])),
    bonded: bool(f['bonded']),
    active: bool(f['active']),
    sourceKind: f['sourceKind'] === 'spell' ? 'spell' : 'power',
    targets: list(f['targets']).filter((t): t is string => typeof t === 'string'),
    mods: modifiers(f['mods']),
    ...(ref ? { ref } : {}),
    note: str(f['note']),
  };
}

function looksDerived(v: unknown): v is DerivedCharacter {
  return typeof v === 'object' && v !== null && 'pools' in v && 'limits' in v;
}

const EMPTY_REPORT: SustainingReport = { lines: [], penalty: 0, selfSustained: 0 };

function normalizeSustaining(raw: unknown): SustainingReport {
  const r = rec(raw);
  const lines = list(r['lines']).flatMap((entry) => {
    const l = rec(entry);
    if (typeof l['id'] !== 'string') return [];
    const exempt = bool(l['exempt']);
    const by = l['exemptBy'];
    return [
      {
        id: l['id'],
        name: str(l['name'], l['id']),
        exempt,
        exemptBy:
          by === 'spirit' || by === 'focus_or_quickening'
            ? (by as 'spirit' | 'focus_or_quickening')
            : null,
        spiritId: nullableStr(l['spiritId']),
        spiritName: nullableStr(l['spiritName']),
        penalty: int(l['penalty'], exempt ? 0 : -2),
      },
    ];
  });
  return {
    lines,
    penalty: lines.reduce((sum, l) => sum + l.penalty, 0),
    selfSustained: lines.filter((l) => !l.exempt).length,
  };
}

/** `MagicDerivedView` off the wire. A body it cannot read becomes an empty rack. */
export function normalizeMagicView(raw: unknown, characterId: string): MagicView {
  const r = rec(raw);
  return {
    characterId: str(r['characterId'], characterId),
    name: str(r['name']),
    derived: looksDerived(r['derived']) ? r['derived'] : null,
    situational: modifiers(r['situational']),
    focusModifiers: modifiers(r['focusModifiers']),
    foci: list(r['foci']).flatMap((f) => {
      const row = normalizeFocus(f);
      return row ? [row] : [];
    }),
    spirits: list(r['spirits']).flatMap((s) => {
      const row = normalizeSpirit(s);
      return row ? [row] : [];
    }),
    sustaining: normalizeSustaining(r['sustaining']),
    reagents: Math.max(0, int(r['reagents'])),
    activeSceneId: nullableStr(r['activeSceneId']),
  };
}

export function emptyMagicView(characterId: string): MagicView {
  return {
    characterId,
    name: '',
    derived: null,
    situational: [],
    focusModifiers: [],
    foci: [],
    spirits: [],
    sustaining: EMPTY_REPORT,
    reagents: 0,
    activeSceneId: null,
  };
}
