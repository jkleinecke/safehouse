/**
 * Guided initiative: call, recipes out, scores in (app dice, table dice or a
 * typed score); the GM starts the turn with blanks, which join late.
 */
import type { Combatant, InitiativeCall, InitiativeEntry, InitiativeRecipe } from '@safehouse/contracts';
import type { EncountersService, InitiativeDetail } from './encounters.js';
import { buildRecipe, entryThisTurn, recipeSource } from './initiative-recipe.js';

export type InitiativeInput = { app: true } | { rolled: number } | { score: number };

export class InitiativeCallService {
  constructor(private readonly fights: EncountersService) {}

  /** The call's state, with a recipe for each row `only` lets through (a player: their own). */
  async view(encounterId: string, only: (c: Combatant) => boolean = () => true): Promise<InitiativeCall> {
    const encounter = await this.fights.getEncounter(encounterId);
    const list = (await this.fights.listCombatants(encounterId)).filter(only);
    // Runners first, then everyone else, each by name.
    list.sort((a, b) => Number(b.source === 'character') - Number(a.source === 'character') || a.name.localeCompare(b.name));
    const rows: InitiativeRecipe[] = [];
    for (const c of list) rows.push(buildRecipe(c, await recipeSource(this.fights.db, c), encounter));
    return { encounterId, turn: encounter.turn, pass: encounter.pass, gathering: encounter.gathering, rows };
  }

  async call(encounterId: string): Promise<InitiativeCall> {
    await this.fights.callInitiative(encounterId);
    return this.view(encounterId);
  }

  /** One row's score, entered by the GM or the row's own player. */
  async enter(
    combatantId: string,
    input: InitiativeInput,
    by: InitiativeEntry['by'],
  ): Promise<{ recipe: InitiativeRecipe; detail?: InitiativeDetail }> {
    const row = await this.fights.getCombatant(combatantId);
    let detail: InitiativeDetail | undefined;
    if ('app' in input) {
      detail = (await this.fights.rollInitiativeAll(row.encounterId, { combatantIds: [combatantId], by })).details[0];
    } else {
      await this.fights.setInitiative(combatantId, { ...input, by });
    }
    const [recipe] = (await this.view(row.encounterId, (c) => c.id === combatantId)).rows;
    return { recipe: recipe!, ...(detail ? { detail } : {}) };
  }

  /** App dice for every NPC row still blank this turn; entered rows are left alone. */
  async rollNpcs(encounterId: string): Promise<InitiativeCall & { details: InitiativeDetail[] }> {
    const encounter = await this.fights.getEncounter(encounterId);
    const ids = (await this.fights.listCombatants(encounterId))
      .filter((c) => c.source !== 'character' && !entryThisTurn(c, encounter))
      .map((c) => c.id);
    const details = ids.length > 0 ? (await this.fights.rollInitiativeAll(encounterId, { combatantIds: ids })).details : [];
    return { ...(await this.view(encounterId)), details };
  }
}
