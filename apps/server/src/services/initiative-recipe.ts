/**
 * A row's initiative recipe (p.159): base + Nd6 + modifiers, every line with
 * its page. The builder is pure; `recipeSource` reads the sheet and magic.
 */
import type {
  Combatant,
  DerivedValue,
  InitiativeEntry,
  InitiativeRecipe,
  InitKind,
  Modifier,
  ProvenanceEntry,
  Ref,
  SheetV1,
} from '@safehouse/contracts';
import {
  applyPipeline,
  ATTRIBUTE_REFS,
  attributeCode,
  computeWoundModifier,
  deriveCharacter,
  lineRef,
  MAX_INIT_DICE,
  sr5Page,
} from '@safehouse/rules';
import type { Db } from '@safehouse/db';
import { loadCharacter } from './characters.js';
import { INIT_LINE, latePenalty, parseCopilot, type CombatantCopilot, type EncounterRow } from './encounters-model.js';
import { magicSituationalFor } from './magic-derive.js';

export interface RecipeSource {
  sheet: SheetV1 | null;
  /** A runner's sustained spells and active foci. */
  mods: Modifier[];
}

type Fight = Pick<EncounterRow, 'turn' | 'pass'>;

interface Line {
  base: number;
  dice: number;
  baseLines: ProvenanceEntry[];
  diceLines: ProvenanceEntry[];
}

const LATE_REF: Ref = sr5Page(160, 'Initiative');

/** A runner reads their live sheet and magic; anyone else the sheet on the row, if any. */
export async function recipeSource(db: Db, c: Combatant): Promise<RecipeSource> {
  if (c.source === 'character' && c.sourceId) {
    const rec = await loadCharacter(db, c.sourceId);
    if (!rec) return { sheet: null, mods: [] };
    return { sheet: rec.sheet, mods: await magicSituationalFor(db, rec.campaignId, rec.id, rec.play.sustained) };
  }
  return { sheet: parseCopilot(c.copilot).sheet ?? null, mods: [] };
}

export function buildRecipe(c: Combatant, src: RecipeSource, fight: Fight, kind: InitKind = c.initKind): InitiativeRecipe {
  const copilot = parseCopilot(c.copilot);
  const effects = c.effects.flatMap((e) => e.mods.filter((m) => m.active));
  const line = src.sheet ? sheetLine(src.sheet, [...src.mods, ...effects], kind, copilot) : trackerLine(c, effects, kind);
  const modifiers: ProvenanceEntry[] = [];
  const wounds = computeWoundModifier(c.monitors);
  if (wounds !== 0) modifiers.push({ label: 'wounds', value: wounds, source: 'wound', ref: lineRef('wounds') });
  const late = latePenalty(c, fight);
  if (late !== 0) modifiers.push({ label: 'late entry', value: late, source: 'late', ref: LATE_REF });
  const entry = entryThisTurn(c, fight);
  return {
    combatantId: c.id,
    name: c.name,
    kind,
    ...line,
    modifier: modifiers.reduce((n, m) => n + m.value, 0),
    modifiers,
    ref: lineRef('initiative'),
    ...(entry ? { entry } : {}),
  };
}

export function scoreOf(recipe: InitiativeRecipe, rolled: number): number {
  return recipe.base + rolled + recipe.modifier;
}

/** The row's entry for the fight's current turn; none means the row is blank. */
export function entryThisTurn(c: Pick<Combatant, 'copilot'>, fight: Pick<EncounterRow, 'turn'>): InitiativeEntry | undefined {
  const entry = parseCopilot(c.copilot).initEntry;
  return entry?.turn === fight.turn ? entry : undefined;
}

/** The GM's line after an edit; a line for another kind is replaced. */
export function withGmLine(copilot: CombatantCopilot, kind: InitKind, base?: number, dice?: number): CombatantCopilot['initLine'] {
  const prev = copilot.initLine?.kind === kind ? copilot.initLine : undefined;
  return { ...prev, kind, ...(base !== undefined ? { base } : {}), ...(dice !== undefined ? { dice } : {}) };
}

function sheetLine(sheet: SheetV1, mods: Modifier[], kind: InitKind, copilot: CombatantCopilot): Line {
  const derived = deriveCharacter(sheet, { situational: mods });
  const init = derived.initiative[INIT_LINE[kind]];
  const out: Line = {
    base: init.base.value,
    dice: init.dice.value,
    baseLines: init.base.breakdown.flatMap((e) => expandAttribute(e, derived.attributes)),
    diceLines: [...init.dice.breakdown],
  };
  const gm = copilot.initLine?.kind === kind ? copilot.initLine : undefined;
  if (gm?.base !== undefined && gm.base !== out.base) {
    out.baseLines.push({ label: 'set by the GM', value: gm.base - out.base, source: 'override' });
    out.base = gm.base;
  }
  if (gm?.dice !== undefined && gm.dice !== out.dice) {
    out.diceLines.push({ label: 'set by the GM', value: gm.dice - out.dice, source: 'override' });
    out.dice = gm.dice;
  }
  return out;
}

/** No sheet: the tracker's own line, moved only by the row's status effects. */
function trackerLine(c: Combatant, effects: Modifier[], kind: InitKind): Line {
  const key = INIT_LINE[kind];
  const generic = kind === 'physical' || kind === 'matrix_ar';
  const targets = (part: 'score' | 'dice') => [`initiative.${key}.${part}`, ...(generic ? [`initiative.${part}`] : [])];
  const base = applyPipeline(c.initBase, [{ label: 'initiative base', value: c.initBase, source: 'tracker' }], targets('score'), effects);
  const dice = applyPipeline(c.initDice, [{ label: `${c.initDice}d6`, value: c.initDice, source: 'tracker' }], targets('dice'), effects, {
    floorZero: true,
  });
  let diceValue = dice.value;
  if (diceValue > MAX_INIT_DICE) {
    dice.breakdown.push({ label: `initiative dice cap (${MAX_INIT_DICE}d6)`, value: MAX_INIT_DICE - diceValue, source: 'engine' });
    diceValue = MAX_INIT_DICE;
  }
  return { base: base.value, dice: diceValue, baseLines: base.breakdown, diceLines: dice.breakdown };
}

/** REA 6 shows as REA 5 + Wired Reflexes 1, so the augment's page is on the recipe. */
function expandAttribute(e: ProvenanceEntry, attributes: Readonly<Record<string, DerivedValue>>): ProvenanceEntry[] {
  const code = e.source === 'attribute' ? attributeCode(e.label) : null;
  if (!code) return [e];
  const r = ATTRIBUTE_REFS[code];
  const ref: Ref | undefined = r ? { book: r.book, page: r.page, note: r.topic } : undefined;
  const lines = attributes[code]?.breakdown ?? [];
  const sum = lines.reduce((n, l) => n + l.value, 0);
  if (lines.length < 2 || sum !== e.value) return [{ ...e, ...(ref ? { ref } : {}) }];
  return lines.map((l, i) =>
    i === 0 ? { ...l, label: e.label, source: 'attribute', ...(ref ? { ref } : {}) } : { ...l, label: `${l.label} (${e.label})` },
  );
}
