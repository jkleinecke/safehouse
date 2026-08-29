/**
 * Personal macros (FR2.8) — recurring free-form rolls, stored per PERSON.
 *
 * "Type a pool size, optional limit" is FR2.8's floor; the macros are the part
 * that makes it usable at speed. They lived in the browser's `localStorage`,
 * which meant they were really per-handset: a player who borrowed a phone
 * mid-fight, or cleared site data between sessions, opened an empty rack. A
 * device token resolves to a user (`req.auth.userId`), so the fix is to key the
 * rack on that user — the macros then follow the player onto whatever they
 * happen to be holding.
 *
 *   GET    /api/campaigns/:id/macros              this user's rack
 *   PUT    /api/campaigns/:id/macros              replace the rack wholesale
 *   POST   /api/campaigns/:id/macros              add one (idempotent on label)
 *   PATCH  /api/campaigns/:id/macros/:macroId     edit one
 *   DELETE /api/campaigns/:id/macros/:macroId     remove one
 *
 * ## Scoping is the security model
 *
 * Every query is filtered by `(userId, campaignId)` from the device token, in
 * SQL, not by anything the client sends — there is no macro id in a WHERE
 * clause that is not also fenced by the owner, so a guessed id from another
 * player's rack is a 404 and not a read (Principle 4). A macro is personal
 * data, not campaign data: the GM does not get to enumerate them either.
 *
 * ## Idempotent creation, and why the label is the key
 *
 * The web app migrates each device's leftover `localStorage` rack up to the
 * server on first load, and that push has to be safe to repeat — the same
 * player's second phone carries the same rack, and a failed first attempt
 * retries. Ids cannot dedupe it (each device minted its own), so the natural
 * key is `(user, campaign, label)`: pushing "Full auto burst" twice updates one
 * row instead of building two buttons that do the same thing. `user_macros` has
 * a unique index on exactly that, so the guarantee is the database's, not a
 * read-then-write race in here.
 *
 * ## Degradation
 *
 * The client keeps writing its localStorage mirror regardless (Principle 5 —
 * the app plays with no network), so this route is the record and the mirror is
 * the cache. Losing the server loses nothing that was already on the phone.
 *
 * The web half is `features/sheet/macroStore.ts`: it expects `GET`/`PUT` to be
 * `{ macros }`-shaped, treats 404/405/501 as "route not built" and falls back
 * to the mirror, and — after its one-time migration POSTs the leftovers —
 * re-reads rather than guessing, so the server's deduped list and its minted
 * ids are what the rack renders. Both the sheet's rack and the table roller's
 * go through it, so there is one rack per user, not one per screen.
 */
import { and, asc, eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { LimitKindSchema, VisibilitySchema } from '@safehouse/contracts';
import { userMacros, type Db } from '@safehouse/db';
import { assertCampaign, httpError, requireAuth } from '../services/auth.js';

/** A full page of quick rolls; a phone cannot usefully show more (mirrors the web cap). */
export const MACRO_LIMIT = 24;

type MacroRow = typeof userMacros.$inferSelect;

/**
 * The stored half of a macro. `pool` is a raw die count because FR2.8 macros
 * are *free-form* rolls — there is no sheet pool behind them to derive from,
 * which is exactly why they exist.
 */
const MacroConfig = z.object({
  pool: z.number().int().min(0).max(100),
  limitKind: LimitKindSchema.optional(),
  limitValue: z.number().int().min(0).max(100).optional(),
  edge: z.enum(['push_pre', 'push_post', 'second_chance']).optional(),
  /** Who sees the result when the macro is fired (FR2.7). */
  visibility: VisibilitySchema.default('public'),
});

/**
 * `name` is what the web client sends; `label` is what the column is called.
 * Accepting both keeps the client contract intact without teaching the schema
 * two names for one thing anywhere below this line.
 */
const MacroBody = MacroConfig.extend({
  id: z.string().max(120).optional(),
  name: z.string().min(1).max(120).optional(),
  label: z.string().min(1).max(120).optional(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
});

const MacroListBody = z.object({
  macros: z.array(MacroBody).max(MACRO_LIMIT * 4).default([]),
});

/** PATCH: every field optional, and `.partial()` is safe here — no defaults to reset. */
const MacroPatchBody = z.object({
  name: z.string().min(1).max(120).optional(),
  label: z.string().min(1).max(120).optional(),
  pool: z.number().int().min(0).max(100).optional(),
  limitKind: LimitKindSchema.nullable().optional(),
  limitValue: z.number().int().min(0).max(100).nullable().optional(),
  edge: z.enum(['push_pre', 'push_post', 'second_chance']).nullable().optional(),
  visibility: VisibilitySchema.optional(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
});

function parse<T extends z.ZodType>(schema: T, value: unknown): z.output<T> {
  const parsed = schema.safeParse(value ?? {});
  if (!parsed.success) throw httpError(400, 'bad_request', 'invalid input', parsed.error.issues);
  return parsed.data;
}

/** `name` or `label`, whichever the caller used. Both are the button's text. */
function labelOf(body: { name?: string; label?: string }): string {
  const label = (body.label ?? body.name ?? '').trim();
  if (label.length === 0) throw httpError(400, 'bad_request', 'a macro needs a name');
  return label;
}

// ---------------------------------------------------------------------------
// DTO
// ---------------------------------------------------------------------------

export interface MacroDto {
  id: string;
  /** The web client's field name. */
  name: string;
  /** The column's name, same value — so either client spelling round-trips. */
  label: string;
  pool: number;
  limitKind?: string;
  limitValue?: number;
  edge?: string;
  visibility: string;
  sortOrder: number;
}

function macroDto(row: MacroRow): MacroDto {
  const cfg = (typeof row.config === 'object' && row.config !== null ? row.config : {}) as Record<
    string,
    unknown
  >;
  return {
    id: row.id,
    name: row.label,
    label: row.label,
    pool: typeof cfg['pool'] === 'number' ? cfg['pool'] : 0,
    ...(typeof cfg['limitKind'] === 'string' ? { limitKind: cfg['limitKind'] } : {}),
    ...(typeof cfg['limitValue'] === 'number' ? { limitValue: cfg['limitValue'] } : {}),
    ...(typeof cfg['edge'] === 'string' ? { edge: cfg['edge'] } : {}),
    visibility: typeof cfg['visibility'] === 'string' ? cfg['visibility'] : 'public',
    sortOrder: row.sortOrder,
  };
}

function configOf(body: z.output<typeof MacroConfig>): Record<string, unknown> {
  return {
    pool: body.pool,
    ...(body.limitKind !== undefined ? { limitKind: body.limitKind } : {}),
    ...(body.limitValue !== undefined ? { limitValue: body.limitValue } : {}),
    ...(body.edge !== undefined ? { edge: body.edge } : {}),
    visibility: body.visibility,
  };
}

/**
 * PATCH's three-way rule for one optional field, in one place rather than in a
 * ternary per field: **absent** means leave it alone, **null** means clear it,
 * a value means set it. Getting that distinction wrong is how a macro quietly
 * loses its limit when the player only meant to rename it.
 */
function merged<T>(patched: T | null | undefined, current: T | undefined): T | undefined {
  if (patched === undefined) return current;
  if (patched === null) return undefined;
  return patched;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export interface MacroOwner {
  userId: string;
  campaignId: string;
}

/** Every read is fenced by the owner; there is no "all macros" query on purpose. */
const ownedBy = (owner: MacroOwner) =>
  and(eq(userMacros.userId, owner.userId), eq(userMacros.campaignId, owner.campaignId));

export async function listMacros(db: Db, owner: MacroOwner): Promise<MacroDto[]> {
  const rows = await db
    .select()
    .from(userMacros)
    .where(ownedBy(owner))
    .orderBy(asc(userMacros.sortOrder), asc(userMacros.label));
  return rows.map(macroDto);
}

/**
 * Create or update by label — the idempotent half of FR2.8's migration path.
 * `onConflictDoUpdate` on the (user, campaign, label) unique index means two
 * devices pushing the same rack converge instead of racing.
 */
export async function upsertMacro(
  db: Db,
  owner: MacroOwner,
  input: { label: string; config: Record<string, unknown>; sortOrder: number },
): Promise<MacroDto> {
  const row = (
    await db
      .insert(userMacros)
      .values({
        campaignId: owner.campaignId,
        userId: owner.userId,
        label: input.label,
        config: input.config,
        sortOrder: input.sortOrder,
      })
      .onConflictDoUpdate({
        target: [userMacros.userId, userMacros.campaignId, userMacros.label],
        set: { config: input.config, sortOrder: input.sortOrder, updatedAt: new Date() },
      })
      .returning()
  )[0]!;
  return macroDto(row);
}

/**
 * Replace the whole rack in one call (the web app's PUT).
 *
 * Duplicate labels inside one payload collapse to the FIRST occurrence, which
 * is what makes the second-device migration converge: the server's own list is
 * merged ahead of the device's leftovers, so the row that survives is the one
 * that was already shared, not the local copy that happens to be newer on disk.
 *
 * Runs in a transaction: a rack that half-replaced would be worse than one that
 * did not replace at all, because the client would mirror the result.
 */
export async function replaceMacros(
  db: Db,
  owner: MacroOwner,
  macros: Array<{ label: string; config: Record<string, unknown> }>,
): Promise<MacroDto[]> {
  const seen = new Set<string>();
  const deduped: Array<{ label: string; config: Record<string, unknown>; sortOrder: number }> = [];
  for (const macro of macros) {
    const key = macro.label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push({ ...macro, sortOrder: deduped.length });
    if (deduped.length >= MACRO_LIMIT) break;
  }
  await db.transaction(async (tx) => {
    await tx.delete(userMacros).where(ownedBy(owner));
    if (deduped.length > 0) {
      await tx.insert(userMacros).values(
        deduped.map((m) => ({
          campaignId: owner.campaignId,
          userId: owner.userId,
          label: m.label,
          config: m.config,
          sortOrder: m.sortOrder,
        })),
      );
    }
  });
  return listMacros(db, owner);
}

/** One macro, but only if it is this user's. A stranger's id is indistinguishable from a typo. */
async function requireOwnMacro(db: Db, owner: MacroOwner, id: string): Promise<MacroRow> {
  const row = (
    await db
      .select()
      .from(userMacros)
      .where(and(ownedBy(owner), eq(userMacros.id, id)))
      .limit(1)
  )[0];
  if (!row) throw httpError(404, 'not_found', 'unknown macro');
  return row;
}

/**
 * The macro id is a uuid, so a malformed one would otherwise reach postgres and
 * come back as a 500 with a driver message attached. It is a 404 either way.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function macroIdOf(req: FastifyRequest): string {
  const { macroId } = req.params as { macroId?: string };
  if (!macroId || !UUID_RE.test(macroId)) throw httpError(404, 'not_found', 'unknown macro');
  return macroId;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/**
 * Identity comes from the token, never from the path: there is no `:userId`
 * anywhere in this plugin, which is why no request can address someone else's
 * rack even by accident.
 */
function ownerFor(req: FastifyRequest): MacroOwner {
  const auth = requireAuth(req);
  const { id } = req.params as { id: string };
  assertCampaign(auth, id);
  return { userId: auth.userId, campaignId: id };
}

export default async function macrosPlugin(app: FastifyInstance): Promise<void> {
  app.get('/api/campaigns/:id/macros', async (req, reply) => {
    const owner = ownerFor(req);
    return reply.send({ campaignId: owner.campaignId, macros: await listMacros(app.db, owner) });
  });

  app.put('/api/campaigns/:id/macros', async (req, reply) => {
    const owner = ownerFor(req);
    const body = parse(MacroListBody, req.body);
    const macros = await replaceMacros(
      app.db,
      owner,
      body.macros.map((m) => ({ label: labelOf(m), config: configOf(m) })),
    );
    return reply.send({ campaignId: owner.campaignId, macros });
  });

  app.post('/api/campaigns/:id/macros', async (req, reply) => {
    const owner = ownerFor(req);
    const body = parse(MacroBody, req.body);
    const label = labelOf(body);
    const existing = (
      await app.db
        .select({ id: userMacros.id, sortOrder: userMacros.sortOrder })
        .from(userMacros)
        .where(and(ownedBy(owner), eq(userMacros.label, label)))
        .limit(1)
    )[0];
    if (!existing) {
      const count = (await listMacros(app.db, owner)).length;
      if (count >= MACRO_LIMIT) {
        throw httpError(409, 'macro_limit', `a rack holds at most ${MACRO_LIMIT} macros`);
      }
      const macro = await upsertMacro(app.db, owner, {
        label,
        config: configOf(body),
        sortOrder: body.sortOrder ?? count,
      });
      return reply.status(201).send({ macro });
    }
    // Same label, same person, same campaign: this is the migration replaying,
    // not a second button. 200, not 201 — nothing was created.
    const macro = await upsertMacro(app.db, owner, {
      label,
      config: configOf(body),
      sortOrder: body.sortOrder ?? existing.sortOrder,
    });
    return reply.send({ macro });
  });

  app.patch('/api/campaigns/:id/macros/:macroId', async (req, reply) => {
    const owner = ownerFor(req);
    const id = macroIdOf(req);
    const body = parse(MacroPatchBody, req.body);
    const before = await requireOwnMacro(app.db, owner, id);
    const cfg = macroDto(before);
    const limitKind = merged(body.limitKind, cfg.limitKind as z.output<typeof LimitKindSchema>);
    const limitValue = merged(body.limitValue, cfg.limitValue);
    const edge = merged(body.edge, cfg.edge as 'push_pre' | 'push_post' | 'second_chance');
    const next = configOf({
      pool: body.pool ?? cfg.pool,
      ...(limitKind !== undefined ? { limitKind } : {}),
      ...(limitValue !== undefined ? { limitValue } : {}),
      ...(edge !== undefined ? { edge } : {}),
      visibility: body.visibility ?? (cfg.visibility as z.output<typeof VisibilitySchema>),
    });
    const label = body.label ?? body.name ?? before.label;
    const row = (
      await app.db
        .update(userMacros)
        .set({
          label,
          config: next,
          sortOrder: body.sortOrder ?? before.sortOrder,
          updatedAt: new Date(),
        })
        .where(and(ownedBy(owner), eq(userMacros.id, id)))
        .returning()
    )[0];
    if (!row) throw httpError(404, 'not_found', 'unknown macro');
    return reply.send({ macro: macroDto(row) });
  });

  app.delete('/api/campaigns/:id/macros/:macroId', async (req, reply) => {
    const owner = ownerFor(req);
    const id = macroIdOf(req);
    await requireOwnMacro(app.db, owner, id);
    await app.db.delete(userMacros).where(and(ownedBy(owner), eq(userMacros.id, id)));
    return reply.send({ deleted: true, id });
  });
}
