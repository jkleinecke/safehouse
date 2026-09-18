/**
 * Getting a constrained answer out of a model that nearly gave one.
 *
 * The outline and floor lanes ask for JSON against a schema, and a local
 * model gets it *almost* right more often than right: a lore kind the enum
 * does not have ("encounter"), a room width of 3.0, a summary two sentences
 * over its limit, twelve traits where eight is the cap. Every one of those
 * used to be a 502 that said which keys were sent and nothing else (the
 * Architect's "schema rejects" error), and the GM's only move was to click
 * again and hope.
 *
 * Two layers, cheapest first:
 *
 *  1. `coerce*` — bend what can be bent without changing meaning: clamp and
 *     round numbers, truncate strings to their limits, map an unknown enum
 *     value to the nearest sensible one, drop entries that are not objects,
 *     cut arrays at their caps. No model call.
 *  2. `repairJson` — when the schema still says no, one more turn on the
 *     same messages: here is what you sent, here is what was wrong, return
 *     the corrected JSON only. Temperature 0. One call, then the error, and
 *     that error now lists the issues by path so the GM can read them.
 */
import type { ZodIssue } from 'zod';
import { httpError } from '../services/auth.js';
import type { ChatMessage, ChatOptions, ChatRequest, ChatTurn } from './llm.js';
import { parseModelJson, unwrapEnvelope } from './vision.js';

// The bending helpers are exported for the lanes whose coercion lives beside
// their own schema (fixer/build-draft.ts), so there is one copy of each.
export type Rec = Record<string, unknown>;
export const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);

export const str = (v: unknown, max: number): string | undefined => {
  if (typeof v === 'number' && Number.isFinite(v)) v = String(v);
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t.length === 0 ? undefined : t.length > max ? t.slice(0, max).trimEnd() : t;
};

export const strList = (v: unknown, max: number, each: number): string[] => {
  if (typeof v === 'string') v = [v];
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const item of v) {
    const s = str(isRec(item) ? (item['text'] ?? item['name'] ?? item['title']) : item, each);
    if (s) out.push(s);
    if (out.length >= max) break;
  }
  return out;
};

export const int = (v: unknown, lo: number, hi: number, fallback?: number): number | undefined => {
  const n = typeof v === 'string' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, Math.round(n)));
};

// ---------------------------------------------------------------------------
// The Architect outline
// ---------------------------------------------------------------------------

const LORE_KINDS = ['page', 'location', 'faction', 'npc', 'run'] as const;
const LORE_KIND_ALIASES: Record<string, (typeof LORE_KINDS)[number]> = {
  place: 'location',
  site: 'location',
  district: 'location',
  building: 'location',
  gang: 'faction',
  corp: 'faction',
  corporation: 'faction',
  organisation: 'faction',
  organization: 'faction',
  group: 'faction',
  character: 'npc',
  person: 'npc',
  contact: 'npc',
  job: 'run',
  mission: 'run',
  encounter: 'run',
  event: 'run',
  scene: 'run',
  lore: 'page',
  history: 'page',
  item: 'page',
  rumour: 'page',
  rumor: 'page',
};

function loreKind(v: unknown): (typeof LORE_KINDS)[number] {
  const k = typeof v === 'string' ? v.trim().toLowerCase() : '';
  if ((LORE_KINDS as readonly string[]).includes(k)) return k as (typeof LORE_KINDS)[number];
  return LORE_KIND_ALIASES[k] ?? 'page';
}

function coercePersona(v: unknown): Rec {
  const p = isRec(v) ? v : {};
  const out: Rec = {
    traits: strList(p['traits'], 8, 80),
    goals: strList(p['goals'], 6, 160),
    secrets: strList(p['secrets'], 6, 200),
    knowledge: strList(p['knowledge'], 8, 200),
    mannerisms: strList(p['mannerisms'], 6, 120),
    hooks: strList(p['hooks'], 6, 200),
  };
  const voice = str(p['voice'], 200);
  if (voice) out['voice'] = voice;
  const backstory = str(p['backstory'], 1200);
  if (backstory) out['backstory'] = backstory;
  return out;
}

/** The outline, bent into the schema's bounds wherever that changes no meaning. */
export function coerceOutline(raw: unknown): unknown {
  if (!isRec(raw)) return raw;
  const out: Rec = {};
  const title = str(raw['title'] ?? raw['name'], 120);
  if (title) out['title'] = title;
  const premise = str(raw['premise'] ?? raw['summary'] ?? raw['description'], 1500);
  if (premise) out['premise'] = premise;

  const lore = Array.isArray(raw['lore']) ? raw['lore'] : Array.isArray(raw['pages']) ? raw['pages'] : [];
  out['lore'] = lore
    .filter(isRec)
    .map((l) => {
      const item: Rec = { kind: loreKind(l['kind'] ?? l['type']) };
      const t = str(l['title'] ?? l['name'], 120);
      const s = str(l['summary'] ?? l['description'] ?? l['content'], 600);
      if (t) item['title'] = t;
      if (s) item['summary'] = s;
      return item;
    })
    .filter((l) => l['title'] && l['summary'])
    .slice(0, 12);

  const npcs = Array.isArray(raw['npcs']) ? raw['npcs'] : Array.isArray(raw['characters']) ? raw['characters'] : [];
  out['npcs'] = npcs
    .filter(isRec)
    .map((n) => {
      const item: Rec = { persona: coercePersona(n['persona']) };
      const name = str(n['name'], 80);
      const role = str(n['role'] ?? n['description'] ?? n['title'], 120);
      const archetype = str(n['archetype'], 80);
      if (name) item['name'] = name;
      if (role) item['role'] = role;
      if (archetype) item['archetype'] = archetype;
      return item;
    })
    .filter((n) => n['name'] && n['role'])
    .slice(0, 12);

  const scenes = Array.isArray(raw['scenes']) ? raw['scenes'] : Array.isArray(raw['maps']) ? raw['maps'] : [];
  out['scenes'] = scenes
    .filter(isRec)
    .map((s) => {
      const item: Rec = {};
      const name = str(s['name'] ?? s['title'], 120);
      const purpose = str(s['purpose'] ?? s['summary'] ?? s['description'], 400);
      const floor = str(s['floor'] ?? s['layout'] ?? s['rooms'], 1200);
      const tileset = str(s['tileset'], 40);
      if (name) item['name'] = name;
      if (purpose) item['purpose'] = purpose;
      if (floor) item['floor'] = floor;
      if (tileset) item['tileset'] = tileset;
      const grid = isRec(s['grid']) ? s['grid'] : {};
      item['cols'] = int(s['cols'] ?? s['width'] ?? grid['cols'] ?? grid['width'], 10, 80, 30);
      item['rows'] = int(s['rows'] ?? s['height'] ?? grid['rows'] ?? grid['height'], 10, 60, 20);
      return item;
    })
    .filter((s) => s['name'] && s['purpose'] && s['floor'])
    .slice(0, 8);
  return out;
}

// ---------------------------------------------------------------------------
// The floor plan
// ---------------------------------------------------------------------------

const ROOM_KIND_ALIASES: Record<string, string> = {
  hall: 'corridor',
  hallway: 'corridor',
  passage: 'corridor',
  stairs: 'stair',
  stairwell: 'stair',
  bathroom: 'washroom',
  toilet: 'washroom',
  bedroom: 'room',
  apartment: 'room',
  lobby: 'room',
  storage: 'storeroom',
  store: 'storeroom',
  warehouse: 'storeroom',
  courtyard: 'yard',
  street: 'yard',
  alley: 'yard',
  outside: 'yard',
};

const WALLS: Record<string, 'n' | 's' | 'e' | 'w'> = {
  n: 'n',
  north: 'n',
  top: 'n',
  s: 's',
  south: 's',
  bottom: 's',
  e: 'e',
  east: 'e',
  right: 'e',
  w: 'w',
  west: 'w',
  left: 'w',
};

/**
 * The floor plan, bent into bounds. Room kinds outside the palette fall
 * back to the alias table and then to plain 'room', which the schema's
 * default also does — the point is the numbers: a model that writes 3.0,
 * "4" or a width of 1 gets a legal plan instead of a refusal.
 */
export function coerceFloorPlan(raw: unknown, roomKinds: readonly string[]): unknown {
  if (!isRec(raw)) return raw;
  const kindOf = (v: unknown): string | undefined => {
    const k = typeof v === 'string' ? v.trim().toLowerCase() : '';
    if (!k) return undefined;
    if (roomKinds.includes(k)) return k;
    const alias = ROOM_KIND_ALIASES[k];
    return alias && roomKinds.includes(alias) ? alias : undefined;
  };
  const out: Rec = {};
  const title = str(raw['title'] ?? raw['name'], 120);
  if (title) out['title'] = title;
  const notes = str(raw['notes'] ?? raw['description'], 2000);
  out['notes'] = notes ?? '';

  // The outside: a ground id, the areas of other ground on it, and a scatter
  // list, however the model spelled them ("exterior", "ground", a bare string
  // for the whole thing; "regions" or "zones" for the areas, inside the
  // outside or at the top of the plan).
  const rawOutside = raw['outside'] ?? raw['exterior'] ?? raw['ground'];
  const outside: Rec = { areas: [], scatter: [] };
  let rawAreas: unknown = raw['areas'] ?? raw['regions'] ?? raw['zones'];
  if (typeof rawOutside === 'string') {
    const g = str(rawOutside, 60);
    if (g) outside['ground'] = g;
  } else if (isRec(rawOutside)) {
    const g = str(rawOutside['ground'] ?? rawOutside['tile'] ?? rawOutside['floor'], 60);
    if (g) outside['ground'] = g;
    outside['scatter'] = strList(rawOutside['scatter'] ?? rawOutside['props'] ?? rawOutside['decoration'], 12, 60);
    rawAreas = rawOutside['areas'] ?? rawOutside['regions'] ?? rawOutside['zones'] ?? rawAreas;
  }
  outside['areas'] = (Array.isArray(rawAreas) ? rawAreas : [])
    .filter(isRec)
    .map((a) => {
      const area: Rec = {};
      const g = str(a['ground'] ?? a['tile'] ?? a['floor'], 60);
      const x = int(a['x'] ?? a['left'], 0, 999);
      const y = int(a['y'] ?? a['top'], 0, 999);
      const w = int(a['w'] ?? a['width'], 1, 999);
      const h = int(a['h'] ?? a['height'], 1, 999);
      if (g) area['ground'] = g;
      if (x !== undefined) area['x'] = x;
      if (y !== undefined) area['y'] = y;
      if (w !== undefined) area['w'] = w;
      if (h !== undefined) area['h'] = h;
      return area;
    })
    .filter((a) => a['ground'] && a['x'] !== undefined && a['y'] !== undefined && a['w'] !== undefined && a['h'] !== undefined)
    .slice(0, 40);
  out['outside'] = outside;

  const rooms = Array.isArray(raw['rooms']) ? raw['rooms'] : [];
  out['rooms'] = rooms
    .filter(isRec)
    .map((r) => {
      const item: Rec = {};
      const name = str(r['name'] ?? r['title'], 60);
      if (name) item['name'] = name;
      const kind = kindOf(r['kind'] ?? r['type']);
      if (kind) item['kind'] = kind;
      const x = int(r['x'] ?? r['left'], 0, 999);
      const y = int(r['y'] ?? r['top'], 0, 999);
      const w = int(r['w'] ?? r['width'], 2, 999);
      const h = int(r['h'] ?? r['height'], 2, 999);
      if (x !== undefined) item['x'] = x;
      if (y !== undefined) item['y'] = y;
      if (w !== undefined) item['w'] = w;
      if (h !== undefined) item['h'] = h;
      const floor = str(r['floor'], 60);
      if (floor) item['floor'] = floor;
      const props = Array.isArray(r['props']) ? r['props'] : [];
      item['props'] = props
        .filter(isRec)
        .map((p) => {
          const prop: Rec = {};
          const tile = str(p['tile'] ?? p['id'] ?? p['name'], 60);
          const px = int(p['x'], 0, 999);
          const py = int(p['y'], 0, 999);
          if (tile) prop['tile'] = tile;
          if (px !== undefined) prop['x'] = px;
          if (py !== undefined) prop['y'] = py;
          return prop;
        })
        .filter((p) => p['tile'] && p['x'] !== undefined && p['y'] !== undefined)
        .slice(0, 80);
      return item;
    })
    .filter((r) => r['name'] && r['x'] !== undefined && r['y'] !== undefined && r['w'] !== undefined && r['h'] !== undefined)
    .slice(0, 60);

  const openings = Array.isArray(raw['openings']) ? raw['openings'] : Array.isArray(raw['doors']) ? raw['doors'] : [];
  out['openings'] = openings
    .filter(isRec)
    .map((o) => {
      const item: Rec = {};
      const room = str(o['room'], 60);
      if (room) item['room'] = room;
      const wall = WALLS[typeof o['wall'] === 'string' ? o['wall'].trim().toLowerCase() : ''];
      if (wall) item['wall'] = wall;
      item['offset'] = int(o['offset'], 1, 999, 1);
      item['width'] = int(o['width'], 1, 20, 1);
      const kind = typeof o['kind'] === 'string' ? o['kind'].trim().toLowerCase() : '';
      item['kind'] = kind === 'window' ? 'window' : 'door';
      return item;
    })
    .filter((o) => o['room'] && o['wall'])
    .slice(0, 200);

  const stairs = Array.isArray(raw['stairs']) ? raw['stairs'] : [];
  out['stairs'] = stairs
    .filter(isRec)
    .map((s) => {
      const item: Rec = {};
      const x = int(s['x'], 0, 999);
      const y = int(s['y'], 0, 999);
      if (x !== undefined) item['x'] = x;
      if (y !== undefined) item['y'] = y;
      const d = typeof s['direction'] === 'string' ? s['direction'].trim().toLowerCase() : '';
      item['direction'] = d === 'down' ? 'down' : 'up';
      return item;
    })
    .filter((s) => s['x'] !== undefined && s['y'] !== undefined)
    .slice(0, 20);
  return out;
}

// ---------------------------------------------------------------------------
// The repair turn
// ---------------------------------------------------------------------------

/** "lore[2].kind: Invalid option" — the first few issues, one per line. */
export function issueLines(issues: readonly ZodIssue[], max = 6): string[] {
  return issues.slice(0, max).map((i) => {
    const path = i.path.map((p) => (typeof p === 'number' ? `[${p}]` : `.${String(p)}`)).join('').replace(/^\./, '');
    return `${path || '(root)'}: ${i.message}`;
  });
}

export interface RepairAsk {
  /** The messages the first attempt was made with. */
  messages: ChatMessage[];
  /** What the model sent, verbatim. */
  badContent: string;
  issues: readonly ZodIssue[];
  /** "the campaign outline" — for the parse error's wording. */
  what: string;
  /** The key the real object must have, for the envelope unwrap. */
  mustHave: string;
}

export interface RepairResult {
  parsed: unknown;
  turn: ChatTurn;
}

/**
 * One more turn: the bad answer, the validation issues, and a request for
 * the corrected JSON only. The model's own earlier output is in the thread
 * as an assistant message, so it fixes rather than starts over.
 */
export async function repairJson(
  client: { chat(req: ChatRequest, opts?: ChatOptions): Promise<ChatTurn> },
  req: Omit<ChatRequest, 'messages'>,
  opts: ChatOptions,
  ask: RepairAsk,
): Promise<RepairResult> {
  const lines = issueLines(ask.issues);
  const turn = await client.chat(
    {
      ...req,
      temperature: 0,
      messages: [
        ...ask.messages,
        { role: 'assistant', content: ask.badContent.slice(0, 24000) },
        {
          role: 'user',
          content: [
            'That JSON failed validation against the schema you were given:',
            ...lines.map((l) => `- ${l}`),
            '',
            'Return the corrected JSON only — the same object with those fields fixed. No prose, no markdown fence.',
          ].join('\n'),
        },
      ],
    },
    opts,
  );
  const parsed = unwrapEnvelope(parseModelJson(turn.content, ask.what), ask.mustHave);
  return { parsed, turn };
}

/** The error the GM reads when even the repair turn missed: the issues, by path. */
export function schemaMissError(what: string, issues: readonly ZodIssue[]): ReturnType<typeof httpError> {
  const lines = issueLines(issues, 4);
  return httpError(
    502,
    'ai_error',
    `the model's ${what} does not fit the schema even after one correction — ${lines.join('; ')}`,
    issues.slice(0, 8),
  );
}
