/**
 * Settling a roll card: the dice (the site's or the table's), then the
 * tracker's share in the roll's own transaction — an Interrupt's score, Full
 * Defense, defenses since acting, an NPC's Edge. Nothing here marks a row done.
 */
import { eq, sql, type SQL } from 'drizzle-orm';
import type {
  CardSettleRequest,
  DeclaredBy,
  EdgeState,
  RollCard,
  RollKind,
  RollRequest,
  Visibility,
} from '@safehouse/contracts';
import { EDGE_ACTION_LABELS } from '@safehouse/rules';
import { combatants, type Db } from '@safehouse/db';
import type { EventTx, Hub } from '../hub.js';
import { httpError } from './auth.js';
import { loadCharacter } from './characters.js';
import type { EncountersService } from './encounters.js';
import type { LoadedActor } from './roll-cards-load.js';
import type { RollRecord, RollService, RollViewer } from './rolls.js';

export interface CardSettled {
  card: RollCard;
  /** Null for an action with no test (Hit the Dirt, an unaware defender). */
  roll: RollRecord | null;
  /** An Interrupt's cost as paid; the GM retypes the score to undo it. */
  initScore?: { combatantId: string; from: number; to: number };
}

export interface SettleDeps {
  db: Db;
  hub: Hub;
  rolls: RollService;
  encounters: EncountersService;
}

export interface SettleInput {
  viewer: RollViewer;
  loaded: LoadedActor;
  req: CardSettleRequest;
  card: RollCard;
  by: DeclaredBy;
}

type Row = NonNullable<LoadedActor['row']>;

/** What the tracker row takes from this settle. */
interface Bookkeeping {
  cost: number;
  fullDefense: boolean;
  defended: boolean;
  /** An NPC's Edge after the spend. */
  edge?: EdgeState;
}

/** A player's secret roll is theirs and the GM's, never refused. */
function visibilityOf(card: RollCard, asked: Visibility | undefined, gm: boolean): Visibility {
  const v = asked ?? card.defaultVisibility;
  return !gm && v === 'gm' ? 'gm_owner' : v;
}

function kindOf(card: RollCard): RollKind {
  const k = card.test?.kind;
  return k === 'threshold' || k === 'opposed' ? k : 'simple';
}

function requestFor(input: SettleInput, visibility: Visibility, edgeDice: number | undefined): RollRequest {
  const { card, req, loaded, by } = input;
  const pool = card.pool!;
  const table = req.settle === 'app' ? undefined : req.settle;
  const on = card.offers.filter((o) => o.on).map((o) => o.id);
  return {
    kind: kindOf(card),
    pool: pool.total,
    breakdown: pool.lines,
    ...(card.limit ? { limit: { kind: card.limit.kind, value: card.limit.value } } : {}),
    edge: req.edge ?? null,
    visibility,
    actor: {
      ...(loaded.characterId ? { characterId: loaded.characterId } : {}),
      ...(loaded.row ? { combatantId: loaded.row.combatantId } : {}),
    },
    meta: {
      label: req.weapon ? `${card.action.name} — ${req.weapon}` : card.action.name,
      actorName: card.actor.name,
      by,
      card: {
        actionId: card.action.id,
        actor: { kind: card.actor.kind, id: card.actor.id },
        ...(req.target ? { target: req.target } : {}),
        ...(req.weapon ? { weapon: req.weapon } : {}),
        offersOn: on,
        ...(card.declare ? { declare: card.declare } : {}),
      },
      ...(card.test?.kind === 'threshold' ? { threshold: card.test.threshold } : {}),
      ...(table ? { tableDice: true } : {}),
      ...(edgeDice !== undefined ? { edgeDice } : {}),
    },
    ...(table ? { tableResult: table } : {}),
  };
}

/** One write to the row, its frames, and the log lines that say what changed. */
async function applyTracker(
  deps: SettleDeps,
  tx: EventTx,
  input: SettleInput,
  row: Row,
  book: Bookkeeping,
  log: { visibility: Visibility; ownerUserId: string; rollId: string | null },
): Promise<CardSettled['initScore']> {
  const { card, viewer, loaded } = input;
  const patch: Record<string, unknown> = {
    ...(book.fullDefense ? { fullDefenseTurn: row.turn } : {}),
    ...(book.edge ? { edge: book.edge } : {}),
  };
  let copilot: SQL = sql`${combatants.copilot}`;
  if (Object.keys(patch).length > 0) copilot = sql`${copilot} || ${JSON.stringify(patch)}::jsonb`;
  if (book.defended) {
    copilot = sql`${copilot} || jsonb_build_object('defendedSinceAction', coalesce((${combatants.copilot}->>'defendedSinceAction')::int, 0) + 1)`;
  }
  const updated = (
    await tx.db
      .update(combatants)
      .set({ copilot, ...(book.cost ? { initScore: sql`${combatants.initScore} - ${book.cost}` } : {}) })
      .where(eq(combatants.id, row.combatantId))
      .returning({ initScore: combatants.initScore })
  )[0];
  if (!updated) throw httpError(404, 'not_found', 'unknown combatant');
  const encounter = await deps.encounters.getEncounter(row.encounterId, tx);
  await deps.encounters.emitUpdated(encounter, book.cost ? 'interrupt' : 'card.settled', tx);

  const name = card.actor.name;
  const say = (kind: string, text: string, extra: Record<string, unknown>) =>
    deps.rolls.postLog({
      campaignId: loaded.campaignId,
      kind,
      text,
      visibility: log.visibility,
      ownerUserId: log.ownerUserId,
      by: { userId: viewer.userId },
      extra: { combatantId: row.combatantId, ...(log.rollId ? { rollId: log.rollId } : {}), ...extra },
      tx,
    });
  if (book.edge && input.req.edge) {
    const { current, max } = book.edge;
    await say('edge', `${name} spends 1 Edge — ${EDGE_ACTION_LABELS[input.req.edge]} (${current}/${max} left)`, {
      edgeAction: input.req.edge,
      edge: book.edge,
    });
  }
  if (!book.cost) return undefined;
  const to = updated.initScore;
  const from = to + book.cost;
  // Said out loud so the GM can retype the score if it should not have applied.
  await say('interrupt', `${name}: ${card.action.name} costs ${book.cost} Initiative (${from} → ${to})`, {
    actionId: card.action.id,
    cost: book.cost,
    initScore: { from, to },
  });
  return { combatantId: row.combatantId, from, to };
}

export async function settleCard(deps: SettleDeps, input: SettleInput): Promise<CardSettled> {
  const { viewer, loaded, req, card } = input;
  const campaignId = loaded.campaignId;
  const gm = viewer.role === 'gm';
  const visibility = visibilityOf(card, req.visibility, gm);
  const character = loaded.characterId ? ((await loadCharacter(deps.db, loaded.characterId)) ?? undefined) : undefined;
  const ownerUserId = character?.ownerUserId ?? viewer.userId;
  const row = loaded.row?.live ? loaded.row : undefined;
  const book: Bookkeeping = {
    cost: card.action.type === 'interrupt' ? (card.action.initCost ?? 0) : 0,
    fullDefense: card.action.id === 'full_defense',
    defended: card.action.exchange === 'defends' && card.pool !== null,
  };

  const changes = () => book.cost > 0 || book.fullDefense || book.defended || book.edge !== undefined;
  if (!card.pool) {
    if (!row || !changes()) return { card, roll: null };
    const initScore = await deps.hub.atomic(campaignId, (tx) =>
      applyTracker(deps, tx, input, row, book, { visibility, ownerUserId, rollId: null }),
    );
    return { card, roll: null, ...(initScore ? { initScore } : {}) };
  }

  // An NPC's Edge: the row's own pool when tracked, else the sheet's rating, unpaid.
  let edgeDice: number | undefined;
  if (req.edge && !character) {
    const edge = row?.edge;
    if (edge) {
      if (edge.current < 1) throw httpError(400, 'no_edge', 'no Edge left to spend');
      book.edge = { max: edge.max, current: edge.current - 1 };
      edgeDice = edge.max;
    } else {
      edgeDice = loaded.body.sheet?.attributes.edg.max ?? 0;
    }
  }

  let initScore: CardSettled['initScore'];
  const roll = await deps.rolls.settleCard({
    campaignId,
    viewer,
    request: requestFor(input, visibility, edgeDice),
    character,
    ownerUserId,
    alsoInTx: async (tx, rec) => {
      if (!row || !changes()) return;
      initScore = await applyTracker(deps, tx, input, row, book, { visibility, ownerUserId, rollId: rec.id });
    },
  });
  return { card, roll, ...(initScore ? { initScore } : {}) };
}
