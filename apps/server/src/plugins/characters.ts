/**
 * Characters domain (M3 — FR3.1/3.3/3.4/3.5/3.6/3.8; DESIGN.md §12).
 *
 *   GET    /api/campaigns/:campaignId/characters
 *   POST   /api/characters                       create, or import a .chum5 (multipart)
 *   GET    /api/characters/:id
 *   PATCH  /api/characters/:id                   sheet mutation → new revision (FR3.8)
 *   GET    /api/characters/:id/derived           live derived sheet (FR3.3/3.4)
 *   GET    /api/characters/:id/revisions[/:seq]
 *   POST   /api/characters/:id/rollback          { seq } (FR3.8)
 *   POST   /api/characters/:id/overrides         flagged manual override (FR3.5)
 *   DELETE /api/characters/:id/overrides/:modId
 *   POST   /api/characters/:id/import            re-import: diff first, confirm=true applies
 *   POST   /api/characters/:id/damage            monitors + wound propagation (FR3.4)
 *   POST   /api/characters/:id/edge              spend / burn (loud) / refresh (FR2.3)
 *   POST   /api/characters/:id/ammo              per-weapon ammo counter (FR3.4)
 *   POST   /api/characters/:id/recoil            progressive recoil counter (FR3.4)
 *   POST   /api/characters/:id/sustained         sustained spells apply −2 each (FR8.2)
 *
 * Sheet mutations snapshot a revision; live-play widgets (monitors, ammo,
 * recoil, sustaining, spending Edge) do not — they are this turn's state, not
 * a change to the character. Burning Edge is permanent, so it does snapshot.
 *
 * Karma/nuyen never live on the sheet: `balances` come from the ledger
 * (FR3.6, see plugins/ledger.ts).
 */
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ModifierOpSchema, SheetV1Schema, type Modifier, type SheetV1 } from '@safehouse/contracts';
import { characters, type Db } from '@safehouse/db';
import type { EventTx } from '../hub.js';
import { assertCampaign, httpError, requireAuth, type AuthContext } from '../services/auth.js';
import {
  assertCanEdit,
  assertCanView,
  characterDto,
  deriveView,
  getRevisionSheet,
  listCharacters,
  listRevisions,
  recordRevision,
  requireCharacter,
  saveCharacter,
  type CharacterRecord,
  type PlayState,
} from '../services/characters.js';
import {
  AmmoBody,
  DamageBody,
  EdgeBody,
  RecoilBody,
  SustainedBody,
  applyAmmoOp,
  applyEdgeOp,
  applyMonitorOp,
  applyRecoilOp,
  applySustainedOp,
  playWithMonitors,
} from '../services/character-play.js';
import { diffSheets, importChummer } from '../services/chummer.js';
import { balancesFor, createEntry } from './ledger.js';

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

function parse<T extends z.ZodType>(schema: T, body: unknown): z.output<T> {
  const parsed = schema.safeParse(body ?? {});
  if (!parsed.success) {
    throw httpError(400, 'bad_request', 'invalid request body', parsed.error.issues);
  }
  return parsed.data;
}

interface Upload {
  /** The .chum5 XML, from a multipart file part or a JSON `xml` field. */
  xml: string | null;
  fields: Record<string, string>;
  body: Record<string, unknown>;
}

/**
 * Accept both the multipart upload the browser sends (FR3.1) and a plain JSON
 * `{ xml }` body, so scripts, the seeder, and tests have one obvious path.
 */
async function readUpload(req: FastifyRequest): Promise<Upload> {
  const fields: Record<string, string> = {};
  let xml: string | null = null;
  const multi = req as unknown as {
    isMultipart?: () => boolean;
    parts?: () => AsyncIterable<{
      type: string;
      fieldname: string;
      value?: unknown;
      toBuffer?: () => Promise<Buffer>;
    }>;
  };
  if (typeof multi.isMultipart === 'function' && multi.isMultipart() && multi.parts) {
    for await (const part of multi.parts()) {
      if (part.type === 'file' && typeof part.toBuffer === 'function') {
        const buf = await part.toBuffer();
        if (buf.byteLength > MAX_UPLOAD_BYTES) {
          throw httpError(413, 'too_large', 'character file exceeds 8 MB');
        }
        xml = buf.toString('utf8');
      } else if (part.type === 'field') {
        fields[part.fieldname] = String(part.value ?? '');
      }
    }
    return { xml, fields, body: {} };
  }
  const body = (typeof req.body === 'object' && req.body !== null ? req.body : {}) as Record<
    string,
    unknown
  >;
  if (typeof body['xml'] === 'string') xml = body['xml'];
  for (const [k, v] of Object.entries(body)) if (typeof v === 'string') fields[k] = v;
  return { xml, fields, body };
}

function truthy(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  const raw = String(value ?? '').toLowerCase();
  return raw === 'true' || raw === '1' || raw === 'yes';
}

/** A blank but valid sheet, for characters typed in by hand (FR3.9 waits). */
function blankSheet(alias: string): SheetV1 {
  return SheetV1Schema.parse({
    v: 1,
    identity: { alias },
    attributes: {
      bod: 1, agi: 1, rea: 1, str: 1, wil: 1, log: 1, int: 1, cha: 1,
      edg: { max: 1, current: 1 },
    },
  });
}

interface CommitOptions {
  sheet: SheetV1;
  play: PlayState;
  auth: AuthContext;
  /** Non-null → snapshot a revision with this cause (FR3.8). */
  cause: string | null;
  name?: string;
  payload?: Record<string, unknown>;
}

/**
 * Save, optionally snapshot a revision, and broadcast `sheet.updated` — all
 * three in ONE transaction (§6.2 / LIVE-4).
 *
 * Every mutating route on this plugin funnels through here, so a torn write is
 * the whole sheet surface at once: the stored sheet moves, no client is told,
 * and every open phone keeps rendering — and rolling from — the old numbers
 * until someone reloads. The revision joins it too, because a snapshot for a
 * change nobody heard about is a rollback target that does not match any state
 * the table ever saw.
 *
 * Handed a `tx` it joins that block instead of opening its own (`atomicIn`),
 * which is how the Edge route gets its save and its loud log line under one
 * fate. Everything inside goes through `tx.db` — the deadlock rule on
 * `Hub.atomic`.
 */
async function commit(
  app: FastifyInstance,
  rec: CharacterRecord,
  opts: CommitOptions,
  tx?: EventTx,
): Promise<number | null> {
  return app.hub.atomicIn(rec.campaignId, tx, async (t) => {
    await saveCharacter(t.db, rec.id, {
      sheet: opts.sheet,
      play: opts.play,
      ...(opts.name !== undefined ? { name: opts.name } : {}),
    });
    const revision = opts.cause
      ? await recordRevision(t.db, {
          characterId: rec.id,
          sheet: opts.sheet,
          cause: opts.cause,
          createdBy: opts.auth.userId,
        })
      : null;
    await t.emit({
      type: 'sheet.updated',
      payload: {
        characterId: rec.id,
        name: opts.name ?? rec.name,
        ...(revision !== null ? { revision, cause: opts.cause } : {}),
        ...opts.payload,
      },
    });
    return revision;
  });
}

/** Reload + derive: every mutating route answers with the fresh live picture. */
async function freshView(db: Db, id: string) {
  const next = await requireCharacter(db, id);
  return deriveView(db, next);
}

// ---------------------------------------------------------------------------
// Body schemas
// ---------------------------------------------------------------------------

const PatchBody = z.object({
  name: z.string().min(1).max(200).optional(),
  status: z.string().min(1).max(50).optional(),
  /** Top-level merge onto the current sheet; validated as a whole SheetV1. */
  sheet: z.record(z.string(), z.unknown()).optional(),
  cause: z.string().min(1).max(200).optional(),
});

const OverrideBody = z.object({
  /** e.g. `attr.rea`, `limit.physical`, `pool.skill.perception`, `pool.all`. */
  target: z.string().min(1).max(120),
  op: ModifierOpSchema.default('add'),
  value: z.number(),
  note: z.string().min(1).max(300).optional(),
  active: z.boolean().default(true),
});

// Live-play bodies (damage / edge / ammo / recoil / sustained) live beside
// their logic in services/character-play.ts.

const RollbackBody = z.object({ seq: z.number().int().min(1) });

// ---------------------------------------------------------------------------

export default async function charactersPlugin(app: FastifyInstance): Promise<void> {
  // --- list ---------------------------------------------------------------
  app.get('/api/campaigns/:campaignId/characters', async (req, reply) => {
    const auth = requireAuth(req);
    const { campaignId } = req.params as { campaignId: string };
    assertCampaign(auth, campaignId);
    const recs = await listCharacters(app.db, campaignId);
    const out = [];
    for (const rec of recs) out.push(characterDto(rec, await balancesFor(app.db, rec.id)));
    return reply.send({ campaignId, characters: out });
  });

  // --- create / Chummer import (FR3.1) ------------------------------------
  app.post('/api/characters', async (req, reply) => {
    const auth = requireAuth(req);
    if (auth.role !== 'gm' && auth.role !== 'player') {
      throw httpError(403, 'forbidden', 'only the GM or a player may create characters');
    }
    const upload = await readUpload(req);
    const campaignId = upload.fields['campaignId'] ?? '';
    if (campaignId.length === 0) throw httpError(400, 'bad_request', 'campaignId is required');
    assertCampaign(auth, campaignId);

    let sheet: SheetV1;
    let report: unknown = null;
    let opening = { karma: 0, nuyen: 0 };
    let cause = 'created';
    if (upload.xml !== null) {
      const imported = importChummer(upload.xml);
      sheet = imported.sheet;
      report = imported.report;
      opening = { karma: imported.karma, nuyen: imported.nuyen };
      cause = 'chummer import';
    } else if (upload.body['sheet'] !== undefined) {
      const parsed = SheetV1Schema.safeParse(upload.body['sheet']);
      if (!parsed.success) {
        throw httpError(400, 'bad_request', 'invalid sheet', parsed.error.issues);
      }
      sheet = parsed.data;
    } else {
      sheet = blankSheet(upload.fields['name'] ?? 'New runner');
    }

    const name = upload.fields['name'] ?? sheet.identity.alias;
    const ownerUserId =
      auth.role === 'gm' ? (upload.fields['ownerUserId'] ?? null) : auth.userId;
    // Row, first revision and the announcement together: a character in the
    // table nobody was told about does not appear in any roster until a reload,
    // and the GM's response to that is to create it a second time.
    const { rec, revision } = await app.hub.atomic(campaignId, async (tx) => {
      const rows = await tx.db
        .insert(characters)
        .values({
          campaignId,
          ownerUserId,
          name,
          sheet: { ...sheet, play: {} },
          ...(upload.xml !== null ? { chummerBlob: upload.xml } : {}),
        })
        .returning();
      const created = await requireCharacter(tx.db, rows[0]!.id);
      const seq = await recordRevision(tx.db, {
        characterId: created.id,
        sheet,
        cause,
        createdBy: auth.userId,
      });
      await tx.emit({
        type: 'sheet.updated',
        payload: { characterId: created.id, name: created.name, revision: seq, cause },
      });
      return { rec: created, revision: seq };
    });

    // Chummer's karma/nuyen balances become opening ledger entries — the sheet
    // never carries a free-floating total (FR3.6).
    const state = auth.role === 'gm' ? ('approved' as const) : ('pending' as const);
    for (const currency of ['karma', 'nuyen'] as const) {
      if (opening[currency] === 0) continue;
      await createEntry(app.db, app.hub, campaignId, {
        characterId: rec.id,
        currency,
        delta: opening[currency],
        reason: 'Chummer import: opening balance',
        state,
        createdBy: auth.userId,
      });
    }

    return reply.status(201).send({
      character: characterDto(rec, await balancesFor(app.db, rec.id)),
      revision,
      ...(report !== null ? { report } : {}),
    });
  });

  // --- read ---------------------------------------------------------------
  app.get('/api/characters/:id', async (req, reply) => {
    const auth = requireAuth(req);
    const { id } = req.params as { id: string };
    const rec = await requireCharacter(app.db, id);
    assertCanView(auth, rec);
    return reply.send(characterDto(rec, await balancesFor(app.db, id)));
  });

  app.get('/api/characters/:id/derived', async (req, reply) => {
    const auth = requireAuth(req);
    const { id } = req.params as { id: string };
    const rec = await requireCharacter(app.db, id);
    assertCanView(auth, rec);
    return reply.send(await deriveView(app.db, rec));
  });

  // --- sheet mutation → revision (FR3.8) ----------------------------------
  app.patch('/api/characters/:id', async (req, reply) => {
    const auth = requireAuth(req);
    const { id } = req.params as { id: string };
    const rec = await requireCharacter(app.db, id);
    assertCanEdit(auth, rec);
    const body = parse(PatchBody, req.body);
    let sheet = rec.sheet;
    if (body.sheet) {
      const parsed = SheetV1Schema.safeParse({ ...rec.sheet, ...body.sheet });
      if (!parsed.success) {
        throw httpError(400, 'bad_request', 'invalid sheet', parsed.error.issues);
      }
      sheet = parsed.data;
    }
    const revision = await commit(app, rec, {
      sheet,
      play: rec.play,
      auth,
      cause: body.cause ?? 'edit',
      ...(body.name !== undefined ? { name: body.name } : {}),
    });
    if (body.status !== undefined) {
      await app.db.update(characters).set({ status: body.status }).where(eq(characters.id, id));
    }
    const next = await requireCharacter(app.db, id);
    return reply.send({
      character: characterDto(next, await balancesFor(app.db, id)),
      revision,
    });
  });

  // --- revisions + rollback (FR3.8) ---------------------------------------
  app.get('/api/characters/:id/revisions', async (req, reply) => {
    const auth = requireAuth(req);
    const { id } = req.params as { id: string };
    const rec = await requireCharacter(app.db, id);
    assertCanView(auth, rec);
    return reply.send({ characterId: id, revisions: await listRevisions(app.db, id) });
  });

  app.get('/api/characters/:id/revisions/:seq', async (req, reply) => {
    const auth = requireAuth(req);
    const { id, seq } = req.params as { id: string; seq: string };
    const rec = await requireCharacter(app.db, id);
    assertCanView(auth, rec);
    const sheet = await getRevisionSheet(app.db, id, Number(seq));
    if (!sheet) throw httpError(404, 'not_found', `no revision ${seq}`);
    return reply.send({
      characterId: id,
      seq: Number(seq),
      sheet,
      /** What rolling back would change, field by field. */
      diff: diffSheets(rec.sheet, sheet),
    });
  });

  app.post('/api/characters/:id/rollback', async (req, reply) => {
    const auth = requireAuth(req);
    const { id } = req.params as { id: string };
    const rec = await requireCharacter(app.db, id);
    assertCanEdit(auth, rec);
    const { seq } = parse(RollbackBody, req.body);
    const sheet = await getRevisionSheet(app.db, id, seq);
    if (!sheet) throw httpError(404, 'not_found', `no revision ${seq}`);
    // History stays append-only: a rollback is a new revision, not an erasure.
    const revision = await commit(app, rec, {
      sheet,
      play: rec.play,
      auth,
      cause: `rollback to r${seq}`,
      payload: { rolledBackTo: seq },
    });
    const next = await requireCharacter(app.db, id);
    return reply.send({
      character: characterDto(next, await balancesFor(app.db, id)),
      revision,
      rolledBackTo: seq,
    });
  });

  // --- overrides (FR3.5: owner or GM, visibly flagged) --------------------
  app.post('/api/characters/:id/overrides', async (req, reply) => {
    const auth = requireAuth(req);
    const { id } = req.params as { id: string };
    const rec = await requireCharacter(app.db, id);
    assertCanEdit(auth, rec);
    const body = parse(OverrideBody, req.body);
    const modifier: Modifier = {
      id: `override.${randomUUID()}`,
      source: { kind: 'override', ref: auth.displayName },
      target: body.target,
      op: body.op,
      value: body.value,
      active: body.active,
      note: body.note ?? `manual override by ${auth.displayName}`,
    };
    const sheet: SheetV1 = { ...rec.sheet, overrides: [...rec.sheet.overrides, modifier] };
    const revision = await commit(app, rec, {
      sheet,
      play: rec.play,
      auth,
      cause: `override ${body.target}`,
      payload: { override: modifier, flagged: true },
    });
    return reply.status(201).send({
      override: modifier,
      revision,
      derived: await freshView(app.db, id),
    });
  });

  app.delete('/api/characters/:id/overrides/:modId', async (req, reply) => {
    const auth = requireAuth(req);
    const { id, modId } = req.params as { id: string; modId: string };
    const rec = await requireCharacter(app.db, id);
    assertCanEdit(auth, rec);
    const kept = rec.sheet.overrides.filter((m) => m.id !== modId);
    if (kept.length === rec.sheet.overrides.length) {
      throw httpError(404, 'not_found', 'unknown override');
    }
    const sheet: SheetV1 = { ...rec.sheet, overrides: kept };
    const revision = await commit(app, rec, {
      sheet,
      play: rec.play,
      auth,
      cause: `remove override ${modId}`,
      payload: { removedOverride: modId },
    });
    return reply.send({ removed: modId, revision, derived: await freshView(app.db, id) });
  });

  // --- re-import: diff first, confirm applies (FR3.1) ---------------------
  app.post('/api/characters/:id/import', async (req, reply) => {
    const auth = requireAuth(req);
    const { id } = req.params as { id: string };
    const rec = await requireCharacter(app.db, id);
    assertCanEdit(auth, rec);
    const upload = await readUpload(req);
    if (upload.xml === null) throw httpError(400, 'bad_request', 'no .chum5 file in request');
    const imported = importChummer(upload.xml);
    // Manual overrides survive a re-import — they are the table's decisions,
    // not Chummer's (Principle 2).
    const merged: SheetV1 = { ...imported.sheet, overrides: rec.sheet.overrides };
    const diff = diffSheets(rec.sheet, merged);
    if (!truthy(upload.fields['confirm'] ?? upload.body['confirm'])) {
      return reply.send({ applied: false, diff, report: imported.report });
    }
    await app.db.update(characters).set({ chummerBlob: upload.xml }).where(eq(characters.id, id));
    const revision = await commit(app, rec, {
      sheet: merged,
      play: rec.play,
      auth,
      cause: 'chummer re-import',
      payload: { reimported: true, changes: diff.length },
    });
    return reply.send({ applied: true, diff, report: imported.report, revision });
  });

  // --- live play: monitors (FR3.4, wound propagation §10.2) ---------------
  app.post('/api/characters/:id/damage', async (req, reply) => {
    const auth = requireAuth(req);
    const { id } = req.params as { id: string };
    const rec = await requireCharacter(app.db, id);
    assertCanEdit(auth, rec);
    const body = parse(DamageBody, req.body);
    // Sizes come from derivation; filled boxes from live state. Both reads are
    // hoisted OUT of the transaction below (the deadlock rule on `Hub.atomic`).
    const view = await deriveView(app.db, rec);
    const change = applyMonitorOp(view.monitors, body);
    const play = playWithMonitors(rec.play, change.monitors);
    // Boxes and the frame that draws them: filled boxes nobody heard about are
    // wound modifiers the table keeps rolling without.
    await app.hub.atomic(rec.campaignId, async (tx) => {
      await saveCharacter(tx.db, id, { sheet: rec.sheet, play });
      await tx.emit({
        type: 'combatant.damaged',
        payload: {
          source: 'character',
          characterId: id,
          name: rec.name,
          monitors: change.monitors,
          woundModifier: change.woundModifier,
          ...(change.applied ? { applied: change.applied } : {}),
          ...(body.note ? { note: body.note } : {}),
          op: body.op,
        },
      });
    });
    return reply.send({
      monitors: change.monitors,
      woundModifier: change.woundModifier,
      derived: await freshView(app.db, id),
    });
  });

  // --- live play: Edge (FR2.3 — burning is loud) --------------------------
  app.post('/api/characters/:id/edge', async (req, reply) => {
    const auth = requireAuth(req);
    const { id } = req.params as { id: string };
    const rec = await requireCharacter(app.db, id);
    assertCanEdit(auth, rec);
    const body = parse(EdgeBody, req.body);
    const change = applyEdgeOp(rec.sheet, rec.play, body, rec.name);
    // One block for the spend AND the line that announces it (FR2.3 — "Edge
    // spend decrements the character's current Edge WITH a log entry"). A debit
    // with no log line is a point of Edge nobody can account for after the
    // fact, which is the argument the table has an hour later.
    const revision = await app.hub.atomic(rec.campaignId, async (tx) => {
      const seq = await commit(
        app,
        rec,
        {
          sheet: change.sheet,
          play: change.play,
          auth,
          // Burning is a permanent change to the character, so it snapshots.
          cause: change.permanent ? `burned ${body.amount} Edge` : null,
          payload: { kind: 'edge', op: body.op, edge: change.edge },
        },
        tx,
      );
      await tx.emit({
        type: 'log.posted',
        payload: {
          kind: 'edge',
          characterId: id,
          text: body.reason ? `${change.text} — ${body.reason}` : change.text,
          loud: change.permanent,
          edge: change.edge,
        },
      });
      return seq;
    });
    return reply.send({ edge: change.edge, burned: change.play.edgeBurned, revision });
  });

  // --- live play: ammo + progressive recoil (FR3.4) -----------------------
  app.post('/api/characters/:id/ammo', async (req, reply) => {
    const auth = requireAuth(req);
    const { id } = req.params as { id: string };
    const rec = await requireCharacter(app.db, id);
    assertCanEdit(auth, rec);
    const body = parse(AmmoBody, req.body);
    const change = applyAmmoOp(rec.sheet, rec.play, body);
    await commit(app, rec, {
      sheet: change.sheet,
      play: change.play,
      auth,
      cause: null,
      payload: { kind: 'ammo', weapon: change.weapon, ammo: change.ammo, recoil: change.recoil },
    });
    return reply.send({
      weapon: change.weapon,
      ammo: change.ammo,
      recoil: change.recoil,
      recoilComp: change.recoilComp,
      modifier: change.modifier,
    });
  });

  app.post('/api/characters/:id/recoil', async (req, reply) => {
    const auth = requireAuth(req);
    const { id } = req.params as { id: string };
    const rec = await requireCharacter(app.db, id);
    assertCanEdit(auth, rec);
    const change = applyRecoilOp(rec.sheet, rec.play, parse(RecoilBody, req.body));
    await commit(app, rec, {
      sheet: rec.sheet,
      play: change.play,
      auth,
      cause: null,
      payload: { kind: 'recoil', weapon: change.weapon, recoil: change.recoil },
    });
    return reply.send({
      weapon: change.weapon,
      recoil: change.recoil,
      recoilComp: change.recoilComp,
      modifier: change.modifier,
    });
  });

  // --- live play: sustained spells (−2 each, FR8.2) -----------------------
  app.post('/api/characters/:id/sustained', async (req, reply) => {
    const auth = requireAuth(req);
    const { id } = req.params as { id: string };
    const rec = await requireCharacter(app.db, id);
    assertCanEdit(auth, rec);
    const play = applySustainedOp(rec.play, parse(SustainedBody, req.body));
    await commit(app, rec, {
      sheet: rec.sheet,
      play,
      auth,
      cause: null,
      payload: { kind: 'sustained', sustained: play.sustained },
    });
    return reply.send({ sustained: play.sustained, derived: await freshView(app.db, id) });
  });
}
