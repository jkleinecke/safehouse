/**
 * contacts domain plugin (M5 — FR5.8, DESIGN.md §9.2 `contacts`).
 *
 * A character's little black book: name, archetype, Connection, Loyalty,
 * notes, favours owed/owing, and an optional link to the codex NPC page the
 * contact actually is (FR5.1/5.3).
 *
 *   GET    /api/characters/:id/contacts   owner or GM
 *   POST   /api/characters/:id/contacts   owner or GM
 *   PATCH  /api/contacts/:contactId       owner or GM
 *   DELETE /api/contacts/:contactId       owner or GM
 *   GET    /api/campaigns/:id/contacts    the GM's roster across the table
 *
 * Access: contacts are shared with the GM by default (FR5.8) but are not
 * table-public — another player's fixer, the debt they owe him and what they
 * wrote about him are theirs. Read and write are both owner-or-GM, checked
 * server-side (Principle 4).
 *
 * Storage shape: §9.2's `contacts` row has no favours column, so a contact
 * carrying favours stores `{ notes, favours }` JSON in `notes`. Plain strings
 * read back verbatim, so nothing written before this plugin existed is lost —
 * and `fixer/state-codex.ts readContactFavors` splits the envelope the same
 * way for the tool catalog.
 */
import { asc, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { characters, contacts, wikiPages, type Db } from '@safehouse/db';
import { assertCampaign, httpError, requireAuth, requireRole } from '../services/auth.js';
import { assertCanEdit, requireCharacter } from '../services/characters.js';
import { loadPage } from '../services/codex-store.js';

type ContactRow = typeof contacts.$inferSelect;

export interface Favours {
  /** Favours the contact owes the character. */
  owed: number;
  /** Favours the character owes the contact. */
  owing: number;
}

const FavoursBody = z.object({
  owed: z.number().int().min(0).max(99).default(0),
  owing: z.number().int().min(0).max(99).default(0),
});

const CreateBody = z.object({
  name: z.string().min(1).max(200),
  archetype: z.string().max(200).default(''),
  /** SR5 Connection 1–12, Loyalty 1–6. */
  connection: z.number().int().min(1).max(12).default(1),
  loyalty: z.number().int().min(1).max(6).default(1),
  notes: z.string().max(20_000).default(''),
  favours: FavoursBody.optional(),
  npcPageId: z.string().uuid().nullable().optional(),
});

/**
 * Spelled out rather than `CreateBody.partial()`: zod keeps a field's
 * `.default()` inside `.optional()`, so a partial() PATCH would quietly reset
 * every omitted field (Connection back to 1, notes to '').
 */
const PatchBody = z.object({
  name: z.string().min(1).max(200).optional(),
  archetype: z.string().max(200).optional(),
  connection: z.number().int().min(1).max(12).optional(),
  loyalty: z.number().int().min(1).max(6).optional(),
  notes: z.string().max(20_000).optional(),
  favours: FavoursBody.optional(),
  npcPageId: z.string().uuid().nullable().optional(),
});

function parse<T extends z.ZodType>(schema: T, value: unknown): z.output<T> {
  const parsed = schema.safeParse(value ?? {});
  if (!parsed.success) throw httpError(400, 'bad_request', 'invalid input', parsed.error.issues);
  return parsed.data;
}

/** Split the stored `notes` column into prose + favours (see INTEGRATION). */
export function readNotes(raw: string): { notes: string; favours: Favours } {
  const empty: Favours = { owed: 0, owing: 0 };
  if (!raw.startsWith('{')) return { notes: raw, favours: empty };
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (typeof parsed['notes'] !== 'string') return { notes: raw, favours: empty };
    const f = (typeof parsed['favours'] === 'object' && parsed['favours'] !== null
      ? parsed['favours']
      : {}) as Record<string, unknown>;
    return {
      notes: parsed['notes'],
      favours: {
        owed: typeof f['owed'] === 'number' ? f['owed'] : 0,
        owing: typeof f['owing'] === 'number' ? f['owing'] : 0,
      },
    };
  } catch {
    return { notes: raw, favours: empty };
  }
}

/** Plain prose stays plain; favours promote the column to its JSON envelope. */
export function writeNotes(notes: string, favours: Favours): string {
  if (favours.owed === 0 && favours.owing === 0 && !notes.startsWith('{')) return notes;
  return JSON.stringify({ notes, favours });
}

export interface ContactDto {
  id: string;
  characterId: string;
  name: string;
  archetype: string;
  connection: number;
  loyalty: number;
  notes: string;
  favours: Favours;
  npcPageId: string | null;
}

function toDto(row: ContactRow): ContactDto {
  const { notes, favours } = readNotes(row.notes);
  return {
    id: row.id,
    characterId: row.characterId,
    name: row.name,
    archetype: row.archetype,
    connection: row.connection,
    loyalty: row.loyalty,
    notes,
    favours,
    npcPageId: row.npcPageId,
  };
}

async function requireContact(db: Db, id: string): Promise<ContactRow> {
  const row = (await db.select().from(contacts).where(eq(contacts.id, id)).limit(1))[0];
  if (!row) throw httpError(404, 'not_found', 'unknown contact');
  return row;
}

/** The linked codex page must be a real page in the same campaign (FR5.8). */
async function checkNpcPage(db: Db, pageId: string, campaignId: string): Promise<void> {
  const page = await loadPage(db, pageId);
  if (!page || page.campaignId !== campaignId) {
    throw httpError(404, 'not_found', 'unknown codex page');
  }
}

export default async function contactsPlugin(app: FastifyInstance): Promise<void> {
  app.get('/api/characters/:id/contacts', async (req, reply) => {
    const auth = requireAuth(req);
    const { id } = req.params as { id: string };
    const rec = await requireCharacter(app.db, id);
    assertCanEdit(auth, rec); // owner-or-GM: a contact list is not table-public
    const rows = await app.db
      .select()
      .from(contacts)
      .where(eq(contacts.characterId, id))
      .orderBy(asc(contacts.name));
    return reply.send({ characterId: id, contacts: rows.map(toDto) });
  });

  app.post('/api/characters/:id/contacts', async (req, reply) => {
    const auth = requireAuth(req);
    const { id } = req.params as { id: string };
    const rec = await requireCharacter(app.db, id);
    assertCanEdit(auth, rec);
    const body = parse(CreateBody, req.body);
    if (body.npcPageId) await checkNpcPage(app.db, body.npcPageId, rec.campaignId);
    const favours = body.favours ?? { owed: 0, owing: 0 };
    const row = (
      await app.db
        .insert(contacts)
        .values({
          characterId: id,
          name: body.name,
          archetype: body.archetype,
          connection: body.connection,
          loyalty: body.loyalty,
          notes: writeNotes(body.notes, favours),
          npcPageId: body.npcPageId ?? null,
        })
        .returning()
    )[0]!;
    return reply.status(201).send({ contact: toDto(row) });
  });

  app.patch('/api/contacts/:contactId', async (req, reply) => {
    const auth = requireAuth(req);
    const { contactId } = req.params as { contactId: string };
    const before = await requireContact(app.db, contactId);
    const rec = await requireCharacter(app.db, before.characterId);
    assertCanEdit(auth, rec);
    const body = parse(PatchBody, req.body);
    if (body.npcPageId) await checkNpcPage(app.db, body.npcPageId, rec.campaignId);

    const current = readNotes(before.notes);
    const patch: Record<string, unknown> = {};
    if (body.name !== undefined) patch['name'] = body.name;
    if (body.archetype !== undefined) patch['archetype'] = body.archetype;
    if (body.connection !== undefined) patch['connection'] = body.connection;
    if (body.loyalty !== undefined) patch['loyalty'] = body.loyalty;
    if (body.npcPageId !== undefined) patch['npcPageId'] = body.npcPageId;
    if (body.notes !== undefined || body.favours !== undefined) {
      patch['notes'] = writeNotes(body.notes ?? current.notes, body.favours ?? current.favours);
    }
    if (Object.keys(patch).length === 0) throw httpError(400, 'bad_request', 'nothing to update');

    const row = (
      await app.db.update(contacts).set(patch).where(eq(contacts.id, contactId)).returning()
    )[0]!;
    return reply.send({ contact: toDto(row) });
  });

  app.delete('/api/contacts/:contactId', async (req, reply) => {
    const auth = requireAuth(req);
    const { contactId } = req.params as { contactId: string };
    const before = await requireContact(app.db, contactId);
    const rec = await requireCharacter(app.db, before.characterId);
    assertCanEdit(auth, rec);
    await app.db.delete(contacts).where(eq(contacts.id, contactId));
    return reply.send({ deleted: contactId });
  });

  /**
   * The GM's cross-table view: every PC's contacts in one list, with the codex
   * page each one points at (the Fixer's `list_contacts` reads the same shape).
   */
  app.get('/api/campaigns/:id/contacts', async (req, reply) => {
    const auth = requireRole(req, 'gm');
    const { id } = req.params as { id: string };
    assertCampaign(auth, id);
    const chars = await app.db
      .select({ id: characters.id, name: characters.name })
      .from(characters)
      .where(eq(characters.campaignId, id));
    if (chars.length === 0) return reply.send({ campaignId: id, contacts: [] });
    const rows = await app.db
      .select()
      .from(contacts)
      .where(inArray(contacts.characterId, chars.map((c) => c.id)))
      .orderBy(asc(contacts.name));
    const pageIds = rows.map((r) => r.npcPageId).filter((p): p is string => p !== null);
    const pages =
      pageIds.length > 0
        ? await app.db
            .select({ id: wikiPages.id, title: wikiPages.title })
            .from(wikiPages)
            .where(inArray(wikiPages.id, pageIds))
        : [];
    const titles = new Map(pages.map((p) => [p.id, p.title]));
    const names = new Map(chars.map((c) => [c.id, c.name]));
    return reply.send({
      campaignId: id,
      contacts: rows.map((row) => ({
        ...toDto(row),
        characterName: names.get(row.characterId) ?? '',
        ...(row.npcPageId && titles.has(row.npcPageId)
          ? { npcPageTitle: titles.get(row.npcPageId) }
          : {}),
      })),
    });
  });
}
