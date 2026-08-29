/**
 * Roll service — the authoritative dice path (DESIGN.md §10.1, FR2.1–2.8, G5).
 *
 * Flow: authorize → recompute the pool with the SAME engine the client
 * previewed with (`deriveCharacter`) → CSPRNG faces via services/dice →
 * `resolveRoll` (limit + edge semantics) → persist the full request breakdown
 * and raw faces to `rolls` → `hub.emit('roll.created')` visibility-filtered.
 *
 * The client's `pool` is NEVER trusted for a sheet-backed roll (actor
 * characterId + `meta.poolRef`): it is recomputed and the claim is kept in the
 * record as `meta.claimedPool` so a stale sheet is visible in the log. Free-form
 * rolls (FR2.8) take the pool as given — there is no sheet to check them against.
 */
import { and, desc, eq } from 'drizzle-orm';
import type {
  LimitRef,
  Modifier,
  ProvenanceEntry,
  RollRequest,
  RollResult,
  Visibility,
} from '@safehouse/contracts';
import { characters, gameSessions, rolls, type Db } from '@safehouse/db';
import {
  buyHits as buyHitsForPool,
  dedupeSceneModifiers,
  deriveCharacter,
  resolveExtendedTest,
  resolveRoll,
  resolveTeamwork,
} from '@safehouse/rules';
import type { EventTx, Hub } from '../hub.js';
import { httpError } from './auth.js';
import { rng as cryptoRng } from './dice.js';
import {
  campaignSettings,
  discordWebhookUrl,
  postDiscord,
  type OutboundLogger,
} from './discord.js';
import {
  getRoll,
  listRolls,
  summarize,
  toRecord,
  type ListRollsOpts,
  type RollPage,
  type RollRecord,
  type RollViewer,
} from './roll-log.js';
import {
  aggregate,
  assertMayRoll,
  dedupeSceneEntries,
  numberFrom,
  parseModifiers,
  parseRequest,
  parseWounds,
} from './roll-input.js';
// The characters service owns the sheet + live-play state; the roll path reads
// it (wounds, sustaining) and writes back through the same writer so a roll can
// never clobber the tracker's bookkeeping.
import {
  activeSceneModifiers,
  liveWounds,
  loadCharacter,
  saveCharacter,
  type CharacterRecord,
} from './characters.js';
// Sustaining (with spirit exemptions) + live foci, composed the one way
// `deriveView` and the Magic tab compose them (FR8.2/FR8.4).
import { magicSituationalFor } from './magic-derive.js';
import { applyEdgeOp } from './character-play.js';

// The read side (record shape, pagination, SQL visibility filter) and the
// outbound webhook live next door; re-exported so callers have one import site.
export {
  campaignSettings,
  discordWebhookUrl,
  forgetCampaignSettings,
  postDiscord,
  type OutboundLogger,
} from './discord.js';
export { dedupeSceneEntries, type SceneReceipt } from './roll-input.js';
export {
  getRoll,
  listRolls,
  summarize,
  toRecord,
  visibilityCondition,
  type ListRollsOpts,
  type RollPage,
  type RollRecord,
  type RollViewer,
} from './roll-log.js';

// ---------------------------------------------------------------------------
// Session helper (shared with the sessions plugin)
// ---------------------------------------------------------------------------

/** Postgres would raise 22P02 on a non-uuid comparison; we answer 404 instead. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The campaign's live session id, if one is running (FR6.2). */
export async function activeSessionId(db: Db, campaignId: string): Promise<string | null> {
  const rows = await db
    .select({ id: gameSessions.id })
    .from(gameSessions)
    .where(and(eq(gameSessions.campaignId, campaignId), eq(gameSessions.state, 'live')))
    .orderBy(desc(gameSessions.id))
    .limit(1);
  return rows[0]?.id ?? null;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class RollService {
  private rng: () => number;
  private readonly log: OutboundLogger | undefined;

  constructor(
    private readonly db: Db,
    private readonly hub: Hub,
    opts: { rng?: () => number; log?: OutboundLogger } = {},
  ) {
    this.rng = opts.rng ?? cryptoRng;
    this.log = opts.log;
  }

  /**
   * Swap the entropy source. Production always uses the CSPRNG from
   * services/dice; tests and the scripted playthrough inject a seeded one so
   * glitches/limits can be asserted exactly (§17).
   */
  setRng(rng: () => number): void {
    this.rng = rng;
  }

  /**
   * One draw from the entropy source in force. Sibling services (the Edge
   * actions in `rolls-edge.ts`) roll through this so `setRng` remains the ONE
   * knob a test has to turn — and so production dice can only ever be the
   * CSPRNG from services/dice (G5).
   */
  nextRandom(): number {
    return this.rng();
  }

  /**
   * `?session=` → a session id (FR6.1/FR2.9). Accepts `current` / `active` /
   * `live` for the running session so a client that never saw a session id can
   * still ask. An id that is not a uuid, does not exist, or belongs to another
   * campaign is a 404 — previously a malformed value reached Postgres as a
   * uuid comparison (a 500) and a foreign id silently returned an empty page,
   * which made "no rolls this session" and "wrong id" indistinguishable.
   */
  async resolveSessionId(campaignId: string, raw: string): Promise<string> {
    if (raw === 'current' || raw === 'active' || raw === 'live') {
      const id = await activeSessionId(this.db, campaignId);
      if (!id) throw httpError(404, 'no_active_session', 'no session is running');
      return id;
    }
    if (!UUID_RE.test(raw)) throw httpError(404, 'unknown_session', 'unknown session');
    const row = (
      await this.db
        .select({ id: gameSessions.id, campaignId: gameSessions.campaignId })
        .from(gameSessions)
        .where(eq(gameSessions.id, raw))
        .limit(1)
    )[0];
    if (!row || row.campaignId !== campaignId) {
      throw httpError(404, 'unknown_session', 'unknown session');
    }
    return row.id;
  }

  /** Roll (WS `roll.request` and `POST /api/rolls` share this path). */
  async performRoll(opts: {
    campaignId: string;
    viewer: RollViewer;
    input: unknown;
  }): Promise<RollRecord> {
    const { campaignId, viewer } = opts;
    const req = parseRequest(opts.input);
    assertMayRoll(viewer, req.visibility);

    const meta: Record<string, unknown> = { ...(req.meta ?? {}) };
    const character = await this.loadCharacter(campaignId, viewer, req.actor.characterId);
    const ownerUserId = character?.ownerUserId ?? viewer.userId;

    // --- authoritative pool (§10.1) ---------------------------------------
    const resolved = await this.resolvePool(campaignId, viewer, character, req, meta);
    const { pool, breakdown, limit } = resolved;
    const sheet = character?.sheet ?? null;

    // --- edge (FR2.3): checked here, DEBITED only once the roll is on record -
    let edgeDice = 0;
    if (req.edge) {
      if (sheet) {
        if (sheet.attributes.edg.current < 1) {
          throw httpError(400, 'no_edge', 'no Edge left to spend');
        }
        edgeDice = sheet.attributes.edg.max;
      } else {
        // GM free-form edge: no sheet to debit, so the dice come from the ask.
        const claimed = meta['edgeDice'];
        edgeDice = typeof claimed === 'number' ? Math.max(0, Math.floor(claimed)) : 0;
      }
    }
    meta['edgeDice'] = edgeDice;

    // Validate the opposed link BEFORE any dice are rolled, so a bad reference
    // costs neither entropy nor a point of Edge.
    const opposed = await this.loadOpposed(campaignId, meta['opposedRollId']);

    // --- resolve -----------------------------------------------------------
    const finalReq: RollRequest = {
      kind: req.kind,
      pool,
      breakdown,
      ...(limit ? { limit } : {}),
      edge: req.edge ?? null,
      visibility: req.visibility,
      actor: req.actor,
      meta: { ...meta, ownerUserId },
    };

    let result: RollResult;
    let detail: Record<string, unknown> | undefined;
    if (req.kind === 'extended') {
      const threshold = numberFrom(meta['threshold'], 1);
      const ext = resolveExtendedTest(
        { pool, threshold, ...(limit ? { limit } : {}) },
        this.rng,
      );
      result = aggregate(ext.rolls, ext.totalHits);
      detail = {
        threshold,
        intervalsUsed: ext.intervalsUsed,
        success: ext.success,
        ...(typeof meta['interval'] === 'string' ? { interval: meta['interval'] } : {}),
        perInterval: ext.rolls.map((r) => ({ hits: r.limitedHits, glitch: r.glitch })),
      };
    } else if (req.kind === 'teamwork') {
      const helperPools = await this.helperPools(campaignId, meta['helpers']);
      const tw = resolveTeamwork(finalReq, helperPools, this.rng);
      result = tw.leader;
      detail = {
        helperPools,
        bonusDice: tw.bonusDice,
        limitBonus: tw.limitBonus,
        helpers: tw.helpers.map((h) => ({ hits: h.hits, faces: h.faces })),
      };
    } else {
      result = resolveRoll(finalReq, this.rng);
      if (req.kind === 'threshold') {
        const threshold = numberFrom(meta['threshold'], 1);
        detail = {
          threshold,
          success: result.limitedHits >= threshold,
          netHits: result.limitedHits - threshold,
        };
      }
    }
    if (detail) (finalReq.meta as Record<string, unknown>)['detail'] = detail;

    // --- opposed linking (FR2.5) ------------------------------------------
    const netHits = opposed ? result.limitedHits - opposed.limitedHits : undefined;

    // The Edge debit rides INSIDE the roll's transaction (`alsoInTx`): a point
    // of Edge spent on a roll that then failed to record is a point the player
    // never gets back, and the sheet update and the roll must agree.
    const edgeSpend =
      req.edge && character
        ? (tx: EventTx): Promise<void> =>
            this.spendEdge(tx, campaignId, character, viewer, req.visibility, ownerUserId)
        : undefined;
    return this.persistAndEmit({
      campaignId,
      viewer,
      request: finalReq,
      result,
      ...(opposed ? { opposedLink: opposed.id } : {}),
      ...(netHits !== undefined ? { netHits } : {}),
      ...(detail ? { detail } : {}),
      ownerUserId,
      ...(edgeSpend ? { alsoInTx: edgeSpend } : {}),
    });
  }

  /** Buying hits: 4 dice : 1 hit, no dice rolled (FR2.4). */
  async buyHits(opts: {
    campaignId: string;
    viewer: RollViewer;
    input: unknown;
  }): Promise<RollRecord> {
    const { campaignId, viewer } = opts;
    const req = parseRequest(opts.input);
    assertMayRoll(viewer, req.visibility);
    const character = await this.loadCharacter(campaignId, viewer, req.actor.characterId);
    const ownerUserId = character?.ownerUserId ?? viewer.userId;

    const meta: Record<string, unknown> = { ...(req.meta ?? {}) };
    const { pool, breakdown, limit } = await this.resolvePool(
      campaignId,
      viewer,
      character,
      req,
      meta,
    );
    const hits = buyHitsForPool(pool);
    const limitedHits = limit ? Math.min(hits, Math.max(0, limit.value)) : hits;
    const request: RollRequest = {
      kind: 'simple',
      pool,
      breakdown,
      ...(limit ? { limit } : {}),
      edge: null,
      visibility: req.visibility,
      actor: req.actor,
      meta: { ...meta, bought: true, ownerUserId },
    };
    return this.persistAndEmit({
      campaignId,
      viewer,
      request,
      result: { faces: [], hits, ones: 0, glitch: 'none', limitedHits },
      ownerUserId,
    });
  }

  /** Paginated campaign roll log, visibility-filtered in SQL (Principle 4). */
  async listRolls(
    campaignId: string,
    viewer: RollViewer,
    opts: ListRollsOpts = {},
  ): Promise<RollPage> {
    return listRolls(this.db, campaignId, viewer, opts);
  }

  /** One roll by id, or null when the viewer may not see it. */
  async getRoll(campaignId: string, viewer: RollViewer, id: string): Promise<RollRecord | null> {
    return getRoll(this.db, campaignId, viewer, id);
  }

  /**
   * `log.posted` — table talk, scene markers, and anything else the log
   * interleaves (FR2.9). Shared by the tables and sessions plugins.
   */
  async postLog(opts: {
    campaignId: string;
    kind: string;
    text: string;
    visibility?: Visibility;
    ownerUserId?: string | null;
    by?: { userId: string; displayName?: string };
    extra?: Record<string, unknown>;
    /**
     * Join an open `hub.atomic` block instead of writing on its own, so the log
     * line shares the fate of the change it narrates.
     */
    tx?: EventTx;
  }): Promise<{ id: number; ts: string }> {
    const input = {
      type: 'log.posted',
      payload: {
        kind: opts.kind,
        text: opts.text,
        ...(opts.by ? { by: opts.by } : {}),
        ...(opts.extra ?? {}),
      },
      visibility: opts.visibility ?? 'public',
      ownerUserId: opts.ownerUserId ?? null,
    };
    // `atomicIn`, not `hub.emit`: handed a block it joins it, and on its own it
    // opens one. The second arm is what keeps a caller that grows a domain
    // write next to its log line from silently going back to a bare emit.
    const event = await this.hub.atomicIn(opts.campaignId, opts.tx, (tx) => tx.emit(input));
    return { id: event.id, ts: event.ts };
  }

  // --- internals ---------------------------------------------------------

  /**
   * The heart of §10.1: for a sheet-backed roll (`actor.characterId` +
   * `meta.poolRef`) the pool comes from `deriveCharacter` over the LIVE state —
   * the character's own wounds, or the combatant row's when the tracker is
   * running (FR3.4), the active scene's environment (FR9.7/9.11), and any
   * sustained spells (FR8.2). The client's number is recorded as
   * `meta.claimedPool` when it disagrees and otherwise ignored.
   *
   * A free-form roll (FR2.8) has no sheet to check against, so its pool and
   * breakdown are taken as sent — that is the feature, not a hole.
   */
  private async resolvePool(
    campaignId: string,
    viewer: RollViewer,
    character: CharacterRecord | undefined,
    req: RollRequest,
    meta: Record<string, unknown>,
  ): Promise<{ pool: number; breakdown: ProvenanceEntry[]; limit: LimitRef | undefined }> {
    const poolRef = typeof meta['poolRef'] === 'string' ? meta['poolRef'] : null;
    if (!character || !poolRef) {
      if (req.breakdown.length === 0) {
        return {
          pool: req.pool,
          breakdown: [{ label: 'free-form pool', value: req.pool, source: 'situational' }],
          limit: req.limit,
        };
      }
      // One authority for the scene (LIVE-2): a receipt that names the same
      // scene line twice had the penalty applied twice. Drop the echo and give
      // the dice back, so `pool` always equals the sum of its own receipt.
      //
      // The web side keeps SHOWING the scene chip and does not re-add it:
      // `GET /api/characters/:id/derived` returns the applied `situational`
      // modifiers precisely so the dialog can render them as "already in the
      // pool" (`features/sheet/rollDialogState.ts`). It also sends
      // `meta.poolRef` with every sheet-backed roll, which puts the roll on
      // §10.1's full recompute and past this repair path entirely — so what
      // follows is for free-form rolls and older clients.
      const { entries, dropped } = dedupeSceneEntries(req.breakdown);
      if (dropped.length === 0) return { pool: req.pool, breakdown: entries, limit: req.limit };
      const returned = dropped.reduce((sum, e) => sum + e.value, 0);
      meta['claimedPool'] = req.pool;
      meta['dedupedScene'] = dropped.map((e) => ({ label: e.label, value: e.value }));
      return { pool: Math.max(0, req.pool - returned), breakdown: entries, limit: req.limit };
    }
    const situational = await this.situationalFor(campaignId, character, meta['mods']);
    const wounds = await this.woundsFor(character, viewer, meta['wounds']);
    const derived = deriveCharacter(character.sheet, { situational, wounds });
    const pb = derived.pools[poolRef];
    if (!pb) {
      throw httpError(400, 'unknown_pool', `character has no pool '${poolRef}'`, {
        available: Object.keys(derived.pools).slice(0, 40),
      });
    }
    if (pb.total !== req.pool) meta['claimedPool'] = req.pool;
    meta['recomputed'] = true;
    if (wounds.physical > 0 || wounds.stun > 0) meta['wounds'] = wounds;
    return { pool: pb.total, breakdown: pb.breakdown, limit: pb.limit ?? req.limit };
  }

  /**
   * Scene environment, sustaining and bonded foci are the server's to know; the
   * client may only contribute chips it alone can see (range to target, a GM's
   * ad-hoc situational), and duplicates by id are dropped so a chip the client
   * also previewed can never be counted twice.
   */
  private async situationalFor(
    campaignId: string,
    rec: CharacterRecord,
    rawMods: unknown,
  ): Promise<Modifier[]> {
    const [scene, magic] = await Promise.all([
      activeSceneModifiers(this.db, campaignId),
      magicSituationalFor(this.db, campaignId, rec.id, rec.play.sustained),
    ]);
    const mods: Modifier[] = [...scene.mods, ...magic];
    const seen = new Set(mods.map((m) => m.id));
    for (const mod of parseModifiers(rawMods)) {
      const kind = mod.source.kind;
      if (kind === 'scene' || kind === 'wound' || kind === 'spell') continue;
      if (seen.has(mod.id)) continue;
      mods.push(mod);
      seen.add(mod.id);
    }
    // Belt and braces: the engine collapses same-(kind,ref,target) scene
    // modifiers too, so no assembly path can double-count the active scene.
    return dedupeSceneModifiers(mods);
  }

  /**
   * Live filled boxes drive the wound modifier (FR3.4). The GM may still hand
   * in a different figure — Principle 2 — but a player never can.
   */
  private async woundsFor(
    rec: CharacterRecord,
    viewer: RollViewer,
    rawWounds: unknown,
  ): Promise<{ physical: number; stun: number }> {
    if (viewer.role === 'gm') {
      const override = parseWounds(rawWounds);
      if (override) return override;
    }
    const live = await liveWounds(this.db, rec);
    return { physical: live.physical, stun: live.stun };
  }

  /**
   * Display name for the log line: the character's own name when the roll is
   * sheet-backed, 'GM' when the GM rolls as themselves, otherwise nothing (the
   * client's generic label is better than a wrong name).
   */
  private async actorNameFor(request: RollRequest): Promise<string | null> {
    const characterId = request.actor.characterId;
    if (characterId) {
      const row = (
        await this.db
          .select({ name: characters.name })
          .from(characters)
          .where(eq(characters.id, characterId))
          .limit(1)
      )[0];
      if (row?.name) return row.name;
    }
    return request.actor.gm === true ? 'GM' : null;
  }

  /**
   * The write half of a roll: the `rolls` row and its `roll.created` event, in
   * ONE transaction (`hub.atomic`).
   *
   * These used to be two independent statements, and a throw from the emit left
   * the roll durable, unannounced and unloggable while the client got a 500 —
   * the table saw dice vanish. Now either both land or neither does, and the
   * event reaches sockets only after the commit.
   *
   * Everything that needs a read runs BEFORE the block opens: PGlite is a
   * single connection, so a query issued on `this.db` while the transaction is
   * open would deadlock (see `Hub.atomic`).
   */
  private async persistAndEmit(opts: {
    campaignId: string;
    viewer: RollViewer;
    request: RollRequest;
    result: RollResult;
    opposedLink?: string;
    netHits?: number;
    detail?: Record<string, unknown>;
    ownerUserId: string;
    /** Extra writes that must share the roll's fate (the Edge debit). */
    alsoInTx?: (tx: EventTx) => Promise<void>;
  }): Promise<RollRecord> {
    const { campaignId, request, result } = opts;
    const sessionId = await activeSessionId(this.db, campaignId);
    // The log renders from the event stream (live and replayed), so the name
    // has to travel WITH the event — a client that reconnects has no roster
    // snapshot from the moment of the roll, and the sheet may since be renamed.
    const actorName = await this.actorNameFor(request);
    const record = await this.hub.atomic(campaignId, async (tx) => {
      const inserted = (
        await tx.db
          .insert(rolls)
          .values({
            campaignId,
            sessionId,
            actor: request.actor,
            kind: request.kind,
            request,
            faces: result.faces,
            hits: result.hits,
            ones: result.ones,
            glitch: result.glitch,
            limit: request.limit ?? null,
            limitedHits: result.limitedHits,
            edgeAction: request.edge ?? null,
            opposedLink: opts.opposedLink ?? null,
            visibility: request.visibility,
          })
          .returning()
      )[0];
      if (!inserted) throw httpError(500, 'internal', 'roll insert returned no row');
      const detail: Record<string, unknown> = {
        ...(opts.detail ?? {}),
        ...(result.exploded ? { exploded: result.exploded } : {}),
      };
      const rec: RollRecord = {
        ...toRecord(inserted),
        ...(opts.netHits !== undefined ? { netHits: opts.netHits } : {}),
        ...(Object.keys(detail).length > 0 ? { detail } : {}),
      };
      await tx.emit({
        type: 'roll.created',
        payload: { ...rec, ...(actorName ? { actorName } : {}) },
        visibility: rec.visibility,
        ownerUserId: opts.ownerUserId,
      });
      if (opts.alsoInTx) await opts.alsoInTx(tx);
      return rec;
    });
    // Outbound mirroring is deliberately outside the transaction: it is a
    // best-effort side effect (FR2.10) and must never hold or fail the write.
    if (record.visibility === 'public') this.mirrorToDiscord(campaignId, record);
    return record;
  }

  /**
   * Optional mirroring of PUBLIC rolls to the campaign webhook (FR2.10), off
   * unless `settings.mirrorRollsToDiscord` is true. Hidden rolls never leave
   * the machine, and a failure here can never fail a roll.
   */
  private mirrorToDiscord(campaignId: string, record: RollRecord): void {
    void (async () => {
      const settings = await campaignSettings(this.db, campaignId);
      if (settings['mirrorRollsToDiscord'] !== true) return;
      const url = await discordWebhookUrl(this.db, campaignId);
      if (url) postDiscord(url, summarize(record), this.log);
    })().catch((err: unknown) => {
      this.log?.warn(err, 'roll mirror skipped');
    });
  }

  private async loadCharacter(
    campaignId: string,
    viewer: RollViewer,
    characterId: string | undefined,
  ): Promise<CharacterRecord | undefined> {
    if (!characterId) return undefined;
    const rec = await loadCharacter(this.db, characterId);
    if (!rec || rec.campaignId !== campaignId) {
      throw httpError(404, 'not_found', 'unknown character');
    }
    if (viewer.role !== 'gm' && rec.ownerUserId !== viewer.userId) {
      throw httpError(403, 'forbidden', 'only the owner or the GM may roll from this sheet');
    }
    return rec;
  }

  /**
   * Debit one point of Edge and log the spend (FR2.3), reusing the characters
   * service's own arithmetic and writer so the sheet's live-play state (recoil,
   * sustaining, monitors) rides along untouched. Only ever called once the roll
   * is on record — a rejected roll costs nothing.
   *
   * No revision is snapshotted, deliberately: spending Edge moves a play-state
   * counter, where burning it permanently lowers the attribute. Only the second
   * is a change to the character worth a revision (FR3.8).
   */
  private async spendEdge(
    tx: EventTx,
    campaignId: string,
    rec: CharacterRecord,
    viewer: RollViewer,
    visibility: Visibility,
    ownerUserId: string,
  ): Promise<void> {
    const change = applyEdgeOp(rec.sheet, rec.play, { op: 'spend', amount: 1 }, rec.name);
    // `tx.db`, never `this.db` — inside an open transaction the outer handle
    // deadlocks on PGlite's single connection (see `Hub.atomic`).
    await saveCharacter(tx.db, rec.id, { sheet: change.sheet, play: change.play });
    await tx.emit({
      type: 'sheet.updated',
      payload: { characterId: rec.id, cause: 'edge.spent', edge: change.edge },
      visibility: 'public',
    });
    await this.postLog({
      campaignId,
      kind: 'edge',
      text: `${change.text} (${change.edge.current}/${change.edge.max} left)`,
      visibility,
      ownerUserId,
      by: { userId: viewer.userId },
      extra: { characterId: rec.id },
      tx,
    });
  }

  private async loadOpposed(
    campaignId: string,
    raw: unknown,
  ): Promise<{ id: string; limitedHits: number } | null> {
    if (typeof raw !== 'string' || raw.length === 0) return null;
    const row = (
      await this.db
        .select({ id: rolls.id, limitedHits: rolls.limitedHits, campaignId: rolls.campaignId })
        .from(rolls)
        .where(eq(rolls.id, raw))
        .limit(1)
    )[0];
    if (!row || row.campaignId !== campaignId) {
      throw httpError(404, 'not_found', 'unknown opposed roll');
    }
    return { id: row.id, limitedHits: row.limitedHits ?? 0 };
  }

  /**
   * Helper pools for a teamwork test (FR2.5): a plain number (hand-entered at
   * the table), or `{ characterId, poolRef }` — recomputed from that helper's
   * own live state, same as the leader's.
   */
  private async helperPools(campaignId: string, raw: unknown): Promise<number[]> {
    if (!Array.isArray(raw)) return [];
    const pools: number[] = [];
    for (const entry of raw.slice(0, 12)) {
      if (typeof entry === 'number') {
        pools.push(Math.max(0, Math.floor(entry)));
        continue;
      }
      if (typeof entry !== 'object' || entry === null) continue;
      const h = entry as { characterId?: unknown; poolRef?: unknown; pool?: unknown };
      if (typeof h.characterId === 'string' && typeof h.poolRef === 'string') {
        const rec = await loadCharacter(this.db, h.characterId);
        if (!rec || rec.campaignId !== campaignId) continue;
        const situational = await this.situationalFor(campaignId, rec, null);
        const live = await liveWounds(this.db, rec);
        const pb = deriveCharacter(rec.sheet, {
          situational,
          wounds: { physical: live.physical, stun: live.stun },
        }).pools[h.poolRef];
        if (pb) pools.push(pb.total);
        continue;
      }
      if (typeof h.pool === 'number') pools.push(Math.max(0, Math.floor(h.pool)));
    }
    return pools;
  }
}

// ---------------------------------------------------------------------------
// Instance registry
// ---------------------------------------------------------------------------

const services = new WeakMap<object, RollService>();

/**
 * One RollService per db handle. Fastify plugins are encapsulated, so this —
 * not a root decorator — is how the rolls/tables/sessions plugins (and tests,
 * which inject a seeded rng) share the same instance.
 */
export function getRollService(db: Db, hub: Hub, log?: OutboundLogger): RollService {
  const key = db as unknown as object;
  let svc = services.get(key);
  if (!svc) {
    svc = new RollService(db, hub, log ? { log } : {});
    services.set(key, svc);
  }
  return svc;
}
