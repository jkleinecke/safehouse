/**
 * Guided roll cards: one action for one actor, built from the sheet on the
 * server (DESIGN.md §10.1). Pure; `roll-cards-load.ts` reads the db.
 *
 * GM rulings: nothing is refused or hidden for seeming not to apply, only
 * ordered; every number the engine infers is an offer the roller can strike.
 */
import type {
  ActionType,
  AttackKind,
  CardAction,
  CardActor,
  CardLimit,
  CardLine,
  CardLineTone,
  CardOffer,
  CardRequest,
  CardTest,
  DeclaredBy,
  DerivedCharacter,
  Exchange,
  ExchangeDeclaration,
  FireModeCode,
  LimitKind,
  LimitRef,
  Modifier,
  ProvenanceEntry,
  RollCard,
  SheetV1,
  SheetWeapon,
} from '@safehouse/contracts';
import {
  ACTION_TYPES,
  ATTRIBUTE_REFS,
  COMBAT_ACTIONS,
  FIRE_MODE_ACTIONS,
  FIRE_MODE_CODES,
  armorAfterAp,
  attackActionsFor,
  attributeCode,
  combatAction,
  defenseModifierFor,
  defenseOptions,
  deriveCharacter,
  environmentCompensationFor,
  eyesOnly,
  foldEnvironment,
  isMeleeSkill,
  lineRef,
  offersFor,
  parseDamageCode,
  rangeModifier,
  recoilLine,
  skillKey,
  skillPoolKey,
  skillRef,
  woundModifierFor,
  type CombatAction,
  type RuleRef,
  type SituationalModifier,
} from '@safehouse/rules';
import { httpError } from './auth.js';

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/** Where a token stands, for the distance between two of them. */
export interface TokenAt {
  sceneId: string;
  x: number;
  y: number;
  unitM: number;
}

/** The actor as the loader found them. */
export interface CardBody {
  actor: CardActor;
  sheet: SheetV1 | null;
  /** Filled boxes, for the wound line. */
  wounds: { physical: number; stun: number } | null;
  /** Foci and status effects: part of the pools as the sheet shows them. */
  mods?: Modifier[];
  /** An NPC or a hidden row: its rolls default to the GM's eyes. */
  secret: boolean;
  initScore?: number;
  delayedAction?: boolean;
  prone?: boolean;
  /** Rounds already fired this turn, per weapon (p.175). */
  recoilFired?: Record<string, number>;
  /** Spells sustained that cost dice (p.282). */
  sustaining?: number;
  /** Defense tests since the row last acted (p.189). */
  defended?: number;
  /** On Full Defense this Combat Turn (p.168). */
  fullDefense?: boolean;
  token?: TokenAt;
}

export interface CardScene {
  id: string;
  mods: Modifier[];
}

export interface CardTarget {
  actor: CardActor;
  token?: TokenAt;
  prone?: boolean;
}

export interface CardInputs {
  body: CardBody;
  req: CardRequest;
  gm: boolean;
  scene?: CardScene | null;
  target?: CardTarget | null;
  exchange?: Exchange | null;
  /** Reuse a derivation (the actions list builds dozens of cards). */
  derived?: DerivedCharacter | null;
  /** Who declares an attack, when not the viewer (the GM entering a player's roll). */
  by?: DeclaredBy;
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const toRef = (r: RuleRef) => ({ book: r.book, page: r.page, note: r.topic });
const attr = (d: DerivedCharacter | null, code: string): number => d?.attributes[code]?.value ?? 0;
const sum = (lines: readonly { value: number }[]): number => lines.reduce((n, l) => n + l.value, 0);
const toneOf = (v: number): CardLineTone => (v > 0 ? 'buff' : v < 0 ? 'debuff' : 'neutral');
const BASE_SOURCES = new Set(['attribute', 'skill', 'armor', 'racial', 'base', 'weapon', 'limit']);

function attrLine(d: DerivedCharacter | null, code: string): ProvenanceEntry {
  return { label: code.toUpperCase(), value: attr(d, code), source: 'attribute' };
}

/** A page for every base line: attributes and skills name their own. */
function withRef(e: ProvenanceEntry): ProvenanceEntry {
  if (e.ref) return e;
  const code = attributeCode(e.label);
  const attrRef = code ? ATTRIBUTE_REFS[code] : undefined;
  if (attrRef) return { ...e, ref: toRef(attrRef) };
  if (e.source === 'skill') return { ...e, ref: toRef(skillRef(e.label.split(' (')[0] ?? e.label)) };
  if (e.source === 'armor') return { ...e, ref: lineRef('soak') };
  return e;
}

function baseLine(e: ProvenanceEntry): CardLine {
  const tone = BASE_SOURCES.has(e.source ?? 'base') && e.value >= 0 ? 'base' : toneOf(e.value);
  return { ...withRef(e), tone };
}

function derive(body: CardBody): DerivedCharacter | null {
  // No wounds or scene here: those are offers the roller can strike.
  return body.sheet ? deriveCharacter(body.sheet, { situational: body.mods ?? [] }) : null;
}

/** Worn armor before AP; 0 with no sheet. */
export function armorOf(body: CardBody): number {
  return derive(body)?.pools['armor']?.total ?? 0;
}

/** The fire mode a firing action is made in. */
function fireModeOf(action: CombatAction): FireModeCode | undefined {
  return FIRE_MODE_CODES.find((code) => FIRE_MODE_ACTIONS[code].includes(action.id));
}

function skillOf(sheet: SheetV1 | null, id: string) {
  const key = skillKey(id);
  return sheet?.skills.find((s) => skillKey(s.id) === key);
}

/** The sheet's weapons, the ones this action is made with first (never only those). */
export function weaponsFor(sheet: SheetV1 | null, action: CombatAction): SheetWeapon[] {
  const all = sheet?.weapons ?? [];
  const melee = action.attack === 'melee' || action.id === 'parry';
  const fits = (w: SheetWeapon) =>
    melee ? isMeleeSkill(w.skillId) : attackActionsFor(w).some((a) => a.id === action.id);
  return [...all.filter(fits), ...all.filter((w) => !fits(w))];
}

export function pickWeapon(sheet: SheetV1 | null, action: CombatAction, name?: string): SheetWeapon | undefined {
  return (name ? sheet?.weapons.find((w) => w.name === name) : undefined) ?? weaponsFor(sheet, action)[0];
}

// ---------------------------------------------------------------------------
// The pool's base lines and the limit
// ---------------------------------------------------------------------------

interface Base {
  lines: ProvenanceEntry[];
  limit: { kind: LimitKind; lines: ProvenanceEntry[] } | null;
  weapon?: SheetWeapon;
}

function limitOf(kind: LimitKind, d: DerivedCharacter | null, known?: LimitRef): Base['limit'] {
  if (known && known.kind === kind) {
    return { kind, lines: [{ label: `${kind} limit`, value: known.value, source: 'limit' }] };
  }
  if (kind === 'force') {
    // Force is picked at the cast; Magic is the usual choice (p.281).
    return { kind, lines: [{ label: 'Force (suggested: Magic)', value: attr(d, 'mag'), source: 'limit' }] };
  }
  const value = kind === 'accuracy' ? 0 : (d?.limits[kind].value ?? 0);
  return { kind, lines: [{ label: `${kind} limit`, value, source: 'limit' }] };
}

/** A skill's pool, or its attribute less one for defaulting (p.130). */
function skillLines(sheet: SheetV1 | null, d: DerivedCharacter | null, id: string, attrCode?: string) {
  const s = skillOf(sheet, id);
  const pool = s ? d?.pools[skillPoolKey(s.id, s.target)] : undefined;
  if (pool) return { lines: pool.breakdown, limit: pool.limit };
  const code = s?.attr ?? attrCode;
  const lines: ProvenanceEntry[] = [
    ...(code ? [attrLine(d, code)] : []),
    { label: `defaulting (no ${id})`, value: -1, source: 'skill', ref: lineRef('defaulting') },
  ];
  return { lines, limit: undefined };
}

function baseFor(action: CombatAction, body: CardBody, d: DerivedCharacter | null, req: CardRequest): Base | null {
  const recipe = action.pool;
  const sheet = body.sheet;
  switch (recipe.from) {
    case 'none':
      return null;
    case 'weapon': {
      const weapon = pickWeapon(sheet, action, req.weapon);
      if (weapon) {
        const lines = d?.pools[`weapon.${weapon.name}`]?.breakdown ?? [];
        const accuracy: ProvenanceEntry = { label: `${weapon.name} Accuracy`, value: weapon.acc ?? 0, source: 'weapon' };
        if (weapon.ref) accuracy.ref = weapon.ref;
        // Unarmed uses Physical even with a weapon strapped on (p.168).
        const limit =
          skillKey(weapon.skillId) === 'unarmed-combat'
            ? limitOf('physical', d)
            : weapon.acc !== undefined
              ? { kind: 'accuracy' as const, lines: [accuracy] }
              : null;
        return { lines, limit, weapon };
      }
      if (action.attack === 'melee') {
        return { lines: skillLines(sheet, d, 'unarmed-combat', 'agi').lines, limit: limitOf('physical', d) };
      }
      return {
        lines: [
          attrLine(d, 'agi'),
          { label: 'defaulting (no weapon on the sheet)', value: -1, source: 'skill', ref: lineRef('defaulting') },
        ],
        limit: null,
      };
    }
    case 'skill': {
      const id = recipe.skill ?? req.skill;
      if (!id) return { lines: [], limit: null };
      const s = skillLines(sheet, d, id, recipe.attr);
      const kind = action.limit ?? s.limit?.kind;
      return { lines: s.lines, limit: kind ? limitOf(kind, d, s.limit) : null };
    }
    case 'defense': {
      const lines = [...(d?.pools['defense']?.breakdown ?? [attrLine(d, 'rea'), attrLine(d, 'int')])];
      let weapon: SheetWeapon | undefined;
      if (recipe.plus === 'wil') {
        lines.push({ label: 'WIL (Full Defense)', value: attr(d, 'wil'), source: 'attribute', ref: lineRef('fullDefense') });
      } else if (recipe.plus) {
        weapon = recipe.plus === 'weaponSkill' ? pickWeapon(sheet, action, req.weapon) : undefined;
        const id = recipe.plus === 'weaponSkill' ? weapon?.skillId : recipe.plus;
        const s = id ? skillOf(sheet, id) : undefined;
        lines.push({
          label: `${s?.id ?? id ?? 'melee weapon skill'} (${action.name})${s ? '' : ', not on the sheet'}`,
          value: s?.rating ?? 0,
          source: 'skill',
          ref: action.ref,
        });
      }
      return { lines, limit: action.limit ? limitOf(action.limit, d) : null, ...(weapon ? { weapon } : {}) };
    }
    case 'soak':
      return { lines: d?.pools['soak']?.breakdown ?? [attrLine(d, 'bod')], limit: null };
    case 'attrs':
      return { lines: recipe.attrs.map((code) => attrLine(d, code)), limit: null };
    case 'spell': {
      const s = skillLines(sheet, d, 'spellcasting', 'mag');
      return { lines: s.lines, limit: limitOf('force', d) };
    }
  }
}

// ---------------------------------------------------------------------------
// Offers
// ---------------------------------------------------------------------------

interface OfferContext {
  action: CombatAction;
  body: CardBody;
  d: DerivedCharacter | null;
  req: CardRequest;
  weapon?: SheetWeapon | undefined;
  scene?: CardScene | null | undefined;
  target?: CardTarget | null | undefined;
  exchange?: Exchange | null | undefined;
  distance: { m: number; from: 'ruler' | 'tokens' } | null;
}

/** Distance for the range band: the ruler's, else the tokens' own (a suggestion). */
function distanceOf(req: CardRequest, body: CardBody, target?: CardTarget | null): OfferContext['distance'] {
  if (req.distanceM !== undefined) return { m: req.distanceM, from: 'ruler' };
  const a = body.token;
  const b = target?.token;
  if (!a || !b || a.sceneId !== b.sceneId) return null;
  const m = Math.hypot(a.x - b.x, a.y - b.y) * a.unitM;
  return { m: Math.round(m * 10) / 10, from: 'tokens' };
}

/** The p.175 table read once: the scene, a shot's range band, the actor's eyes. */
function environmentOffer(m: SituationalModifier, ctx: OfferContext) {
  const comp = ctx.body.sheet ? environmentCompensationFor(ctx.body.sheet) : {};
  const shot = m.columns?.includes('range') ?? false;
  const notes: string[] = [];
  let range: Modifier | null = null;
  const cat = ctx.weapon?.rangeCat;
  if (shot && cat && ctx.distance) {
    range = rangeModifier(ctx.distance.m, cat, ctx.body.sheet?.rangeTables ?? {});
    if (!range) notes.push(`${ctx.distance.m} m is past ${cat}'s extreme range`);
    if (ctx.distance.from === 'tokens') notes.push(`${ctx.distance.m} m between the tokens`);
  }
  const line = foldEnvironment([...(ctx.scene?.mods ?? []), ...(range ? [range] : [])], {
    compensation: shot ? comp : eyesOnly(comp),
    ...(m.columns ? { columns: m.columns } : {}),
  });
  return { value: line?.value ?? 0, note: [line?.label ?? 'clear', ...notes].join(' · '), env: line?.env };
}

function recoilOffer(ctx: OfferContext): { value: number; note: string } {
  const w = ctx.weapon;
  const mode = fireModeOf(ctx.action);
  if (!w) return { value: 0, note: 'no weapon' };
  const fired = ctx.body.recoilFired?.[w.name] ?? 0;
  const line = recoilLine({
    mode: mode ?? null,
    bullets: ctx.action.rounds ?? 1,
    firedSoFar: fired,
    recoilComp: w.recoilComp ?? 0,
    strength: attr(ctx.d, 'str'),
  });
  const notes = [line?.label ?? (mode === 'SS' ? 'single shot: no recoil' : 'fully compensated')];
  if (fired > 0) notes.push(`${fired} fired earlier this turn`);
  return { value: line?.value ?? 0, note: notes.join(' · ') };
}

interface BuiltOffer {
  offer: CardOffer;
  env?: ProvenanceEntry['env'];
}

function offerFor(m: SituationalModifier, ctx: OfferContext): BuiltOffer {
  const { body, d, req, exchange } = ctx;
  const offer: CardOffer = {
    id: m.id,
    label: m.label,
    value: typeof m.value === 'number' ? m.value : 0,
    ref: m.ref,
    on: false,
    ...(m.target ? { target: m.target } : {}),
    ...(m.group ? { group: m.group } : {}),
    ...(m.auto ? { auto: m.auto } : {}),
    ...(m.noDefense ? { noDefense: true as const } : {}),
  };
  let env: ProvenanceEntry['env'];
  // Engine lines arrive on; tick boxes arrive off.
  let on = m.auto === 'fullDefense' ? body.fullDefense === true : m.auto !== undefined && !m.offByDefault;

  if (m.value !== null && typeof m.value === 'object') {
    // Take Aim tops out at half Willpower, rounded up (p.166).
    const max = m.value.unit === 'aim' ? Math.ceil(attr(d, 'wil') / 2) : undefined;
    const known = m.auto === 'sustaining' ? body.sustaining : m.auto === 'previousDefenses' ? body.defended : undefined;
    const asked = req.steppers?.[m.id] ?? known ?? 0;
    const count = max !== undefined ? Math.min(asked, max) : asked;
    offer.stepper = { per: m.value.per, unit: m.value.unit, count, ...(max !== undefined ? { max } : {}) };
    offer.value = m.value.per * count;
    if (!m.auto) on = count > 0;
  }

  switch (m.auto) {
    case 'wounds':
      offer.value = body.wounds ? woundModifierFor(body.wounds) : 0;
      if (body.wounds) offer.note = `${body.wounds.physical}P / ${body.wounds.stun}S boxes`;
      break;
    case 'environment': {
      const e = environmentOffer(m, ctx);
      offer.value = e.value;
      offer.note = e.note;
      env = e.env;
      break;
    }
    case 'recoil': {
      const r = recoilOffer(ctx);
      offer.value = r.value;
      offer.note = r.note;
      break;
    }
    case 'fireMode':
      offer.value = exchange?.declared.defenseModifier ?? 0;
      break;
    case 'fullDefense':
      offer.value = attr(d, 'wil');
      if (body.fullDefense) offer.note = 'on Full Defense this Combat Turn';
      break;
    case 'previousDefenses':
      if (body.defended) offer.note = `${body.defended} since last acting, per the tracker`;
      break;
    case 'ap': {
      const armor = d?.pools['armor']?.total ?? 0;
      const ap = exchange?.declared.ap ?? 0;
      offer.value = armorAfterAp(armor, ap) - armor;
      if (exchange) offer.note = `AP ${ap} against armor ${armor}`;
      break;
    }
    default:
      break;
  }

  if (m.declared && exchange) {
    offer.declaredBy = exchange.declared.by;
    if (!m.auto) on = exchange.declared.extras.some((x) => x.id === m.id);
  }

  // Hints only: never ticked for the roller.
  if (m.id === 'delayed_action' && body.delayedAction) offer.suggestedBy = 'turn';
  if ((m.id === 'attacker_prone' || m.id === 'defender_prone') && body.prone) offer.suggestedBy = 'status';
  if (m.id === 'opponent_prone' && ctx.target?.prone) offer.suggestedBy = 'status';

  offer.on = req.offersOn ? req.offersOn.includes(m.id) : on;
  return { offer, ...(env ? { env } : {}) };
}

/** One per group: the last one ticked wins. */
function oneOfEachGroup(offers: CardOffer[], order: readonly string[] | undefined): void {
  const kept = new Map<string, CardOffer>();
  const rank = (o: CardOffer) => (order ? order.lastIndexOf(o.id) : 0);
  for (const o of offers) {
    if (!o.on || !o.group) continue;
    const k = kept.get(o.group);
    if (!k || rank(o) > rank(k)) kept.set(o.group, o);
  }
  for (const o of offers) if (o.on && o.group && kept.get(o.group) !== o) o.on = false;
}

function buildOffers(ctx: OfferContext): BuiltOffer[] {
  // Full Defense's WIL is already the action's own line.
  const mods = offersFor(ctx.action).filter((m) => !(ctx.action.id === 'full_defense' && m.id === 'full_defense'));
  const kind = ctx.exchange?.attack ?? ctx.action.attack;
  // Scoped to another kind of attack: listed last, never dropped.
  const fits = (m: SituationalModifier) => kind === undefined || !m.against || m.against.includes(kind);
  const ordered = [...mods.filter(fits), ...mods.filter((m) => !fits(m))];
  const built = ordered.map((m) => offerFor(m, ctx));
  oneOfEachGroup(
    built.map((b) => b.offer),
    ctx.req.offersOn,
  );
  return built;
}

function offerLine(b: BuiltOffer): CardLine {
  const o = b.offer;
  const source = o.auto === 'wounds' ? 'wound' : o.auto === 'environment' ? 'scene' : 'situational';
  return {
    label: o.label,
    value: o.value,
    source,
    ref: o.ref,
    tone: toneOf(o.value),
    offerId: o.id,
    ...(b.env ? { env: b.env } : {}),
  };
}

// ---------------------------------------------------------------------------
// The card
// ---------------------------------------------------------------------------

function header(a: CombatAction): CardAction {
  return {
    id: a.id,
    name: a.name,
    type: a.type,
    ref: a.ref,
    ...(a.refs ? { refs: [...a.refs] } : {}),
    ...(a.initCost ? { initCost: a.initCost } : {}),
    ...(a.exchange ? { exchange: a.exchange } : {}),
    ...(a.attack ? { attack: a.attack } : {}),
    ...(a.lasts ? { lasts: a.lasts } : {}),
  };
}

function testFor(action: CombatAction, req: CardRequest, target?: CardTarget | null, exchange?: Exchange | null): CardTest {
  if (req.threshold) {
    const perception = action.id === 'perception' || action.id === 'observe_in_detail';
    return { kind: 'threshold', threshold: req.threshold, ref: lineRef(perception ? 'perceptionThresholds' : 'threshold') };
  }
  if (action.exchange === 'opens' && target) {
    return { kind: 'opposed', against: `${target.actor.name}'s defense`, ref: lineRef('opposed') };
  }
  if (action.exchange === 'defends') {
    return { kind: 'opposed', ...(exchange?.attacker ? { against: `${exchange.attacker.name}'s attack` } : {}), ref: lineRef('opposed') };
  }
  return { kind: 'success', ref: lineRef('success') };
}

/** The attacker's "tell the GM" block, from the weapon; every field editable. */
function declarationFor(
  action: CombatAction,
  weapon: SheetWeapon | undefined,
  d: DerivedCharacter | null,
  inputs: CardInputs,
): ExchangeDeclaration | undefined {
  if (action.exchange !== 'opens') return undefined;
  const parsed = weapon?.dv ? parseDamageCode(weapon.dv, attr(d, 'str')) : null;
  const edit = inputs.req.declare ?? {};
  const mode = fireModeOf(action);
  const note = edit.note ?? (parsed ? undefined : 'set the DV');
  return {
    dv: edit.dv ?? (parsed ? { value: parsed.value, type: parsed.type } : { value: 0, type: 'P' }),
    ap: edit.ap ?? weapon?.ap ?? 0,
    ...(mode ? { mode } : {}),
    ...(action.rounds ? { rounds: action.rounds } : {}),
    // Fewer rounds loaded than the mode fires softens it (p.180).
    defenseModifier: edit.defenseModifier ?? defenseModifierFor(action, weapon?.ammo?.current),
    extras: edit.extras ?? [],
    ...(note ? { note } : {}),
    by: inputs.by ?? (inputs.gm ? { role: 'gm', name: 'GM' } : { role: 'player', name: inputs.body.actor.name }),
  };
}

export function buildCard(inputs: CardInputs): RollCard {
  const { body, req, target, exchange } = inputs;
  const action = combatAction(req.actionId);
  if (!action) throw httpError(404, 'not_found', `no action '${req.actionId}'`);
  const d = inputs.derived !== undefined ? inputs.derived : derive(body);
  const base = baseFor(action, body, d, req);
  const weapon = base?.weapon;

  const built = buildOffers({
    action,
    body,
    d,
    req,
    weapon,
    scene: inputs.scene,
    target,
    exchange,
    distance: distanceOf(req, body, target),
  });
  const offers = built.map((b) => b.offer);
  const on = built.filter((b) => b.offer.on);
  const noDefense = on.some((b) => b.offer.noDefense);

  let pool: RollCard['pool'] = null;
  let limit: CardLimit | null = null;
  if (base && !noDefense) {
    const lines: CardLine[] = [
      ...base.lines.map(baseLine),
      ...on.filter((b) => b.offer.target !== 'limit' && !b.offer.noDefense).map(offerLine),
      ...(req.extras ?? []).map((x) => ({ label: x.label, value: x.value, source: 'gm', tone: toneOf(x.value) })),
    ];
    pool = { total: Math.max(0, sum(lines)), lines };
    if (base.limit) {
      const limitLines: CardLine[] = [
        ...base.limit.lines.map((l) => ({ ...withRef(l), tone: 'base' as const })),
        ...on.filter((b) => b.offer.target === 'limit').map(offerLine),
      ];
      limit = {
        kind: base.limit.kind,
        value: Math.max(0, sum(limitLines)),
        ref: lineRef(base.limit.kind === 'force' ? 'spellcasting' : 'limits'),
        lines: limitLines,
      };
    }
  }

  const cost = {
    ...(action.initCost && body.initScore !== undefined
      ? { initScore: { from: body.initScore, to: body.initScore - action.initCost } }
      : {}),
    ...(action.rounds ? { rounds: action.rounds } : {}),
  };
  const declare = declarationFor(action, weapon, d, inputs);

  return {
    actor: body.actor,
    action: header(action),
    test: pool ? testFor(action, req, target, exchange) : null,
    stage: req.stage ?? (inputs.gm ? 'modifiers' : 'dice'),
    pool,
    limit,
    offers,
    ...(target ? { target: target.actor } : {}),
    ...(declare ? { declare } : {}),
    // The attacker's dice are the GM's to see (Principle 3).
    ...(exchange && inputs.gm ? { context: { exchange } } : {}),
    ...(Object.keys(cost).length > 0 ? { cost } : {}),
    defaultVisibility: body.secret ? 'gm' : 'public',
    settle: { app: pool !== null, table: pool !== null },
  };
}

// ---------------------------------------------------------------------------
// The actions an actor can take
// ---------------------------------------------------------------------------

export interface ActionSummary extends CardAction {
  needsTarget?: true;
  /** The sheet's weapons, the ones this action is made with first. */
  weapons?: string[];
  /** The pool with the card's defaults, before a target or a range. */
  preview: { total: number; limit: { kind: LimitKind; value: number } | null } | null;
}

export interface ActorActions {
  actor: CardActor;
  groups: { type: ActionType; actions: ActionSummary[] }[];
  /** Given an attack kind: every defense, in the order the menu lists them. */
  defenses?: string[];
}

/**
 * Every defense, the GM's order first: the kind's own free test, then REA+INT,
 * Full Defense, Dodge, Block, Parry, then the rest.
 */
export function defenseOrder(kind: AttackKind): string[] {
  const answers = defenseOptions(kind);
  const own = answers.filter((a) => a.type === 'none').map((a) => a.id);
  const rest = COMBAT_ACTIONS.filter((a) => a.exchange === 'defends').map((a) => a.id);
  return [
    ...new Set([...own, 'defense', 'full_defense', 'dodge', 'block', 'parry', ...answers.map((a) => a.id), ...rest]),
  ];
}

export function listActions(
  body: CardBody,
  opts: { gm: boolean; scene?: CardScene | null; against?: AttackKind },
): ActorActions {
  const derived = derive(body);
  const summary = (a: CombatAction): ActionSummary => {
    const card = buildCard({ body, req: { actor: body.actor, actionId: a.id }, gm: opts.gm, scene: opts.scene, derived });
    const armed = a.pool.from === 'weapon' || a.id === 'parry';
    return {
      ...header(a),
      ...(a.needsTarget ? { needsTarget: true as const } : {}),
      ...(armed && body.sheet?.weapons.length ? { weapons: weaponsFor(body.sheet, a).map((w) => w.name) } : {}),
      preview: card.pool
        ? { total: card.pool.total, limit: card.limit ? { kind: card.limit.kind, value: card.limit.value } : null }
        : null,
    };
  };
  const kind = opts.against;
  // Ordered, never filtered: an answer to this attack comes first.
  const answers = (a: CombatAction) => kind !== undefined && (a.against?.includes(kind) ?? false);
  const groups = ACTION_TYPES.map((type) => {
    const all = COMBAT_ACTIONS.filter((a) => a.type === type);
    return { type, actions: [...all.filter(answers), ...all.filter((a) => !answers(a))].map(summary) };
  });
  return { actor: body.actor, groups, ...(kind ? { defenses: defenseOrder(kind) } : {}) };
}
