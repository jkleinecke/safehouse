/**
 * codex domain plugin (M5 — FR5.1–5.4, DESIGN.md §12).
 *
 * The campaign wiki: typed pages (npc|faction|location|run|item|lore) holding
 * markdown and tags, per-page AND per-section visibility, `[[Wiki-links]]`
 * with backlinks, `SR5 p.426` ref chips, and handouts staged private then
 * revealed live.
 *
 *   GET    /api/campaigns/:id/wiki              list / filter / search
 *   POST   /api/campaigns/:id/wiki              create (GM)
 *   GET    /api/campaigns/:id/wiki/unresolved   dangling [[links]] (GM, FR5.3)
 *   GET    /api/campaigns/:id/handouts          staged + revealed handouts
 *   GET    /api/wiki/:id                        one page, filtered for the caller
 *   PATCH  /api/wiki/:id                        edit (GM) — writes a revision
 *   DELETE /api/wiki/:id                        (GM)
 *   POST   /api/wiki/:id/reveal                 page or section → shared (GM)
 *   GET    /api/wiki/:id/revisions              edit history (GM)
 *   POST   /api/wiki/:id/handouts               pin an attachment (GM)
 *   DELETE /api/wiki/:id/handouts/:attachmentId (GM)
 *   POST   /api/wiki/:id/templates              link an NPC template (GM, FR5.6)
 *   DELETE /api/wiki/:id/templates/:templateId  unlink (GM, FR5.6)
 *   POST   /api/handouts/:attachmentId/reveal   staged → live (GM, FR5.4)
 *
 * Secrecy (Principle 4): a player's GET never *contains* a GM-only section —
 * heading, prose, links and refs are cut in `services/codex.ts` before the
 * response is built. An invisible page 404s exactly like a nonexistent one, so
 * the route is not an oracle for what the GM has written.
 */
import { and, desc, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { VisibilitySchema, type Visibility } from '@safehouse/contracts';
import { attachments, wikiPages, wikiRevisions } from '@safehouse/db';
import { assertCampaign, httpError, requireAuth, requireRole } from '../services/auth.js';
import {
  WIKI_KINDS,
  canView,
  handoutView,
  pageSummary,
  parseSections,
  readPageMeta,
  renderForViewer,
  unresolvedReport,
  visiblePages,
  type HandoutLink,
  type PageMeta,
  type Viewer,
} from '../services/codex.js';
import {
  buildPageDto,
  listPageRows,
  loadPage,
  recordWikiRevision,
  requireVisiblePage,
} from '../services/codex-store.js';
import {
  setTemplatePage,
  templateLink,
  templatesForPage,
} from '../services/codex-templates.js';
import registerCalendarRoutes from './codex-calendar.js';
import registerRunRoutes from './codex-runs.js';

const SectionMetaBody = z.object({
  id: z.string().min(1).max(120),
  heading: z.string().max(300).optional(),
  visibility: VisibilitySchema,
  audience: z.array(z.string().uuid()).max(24).optional(),
});

const CreateBody = z.object({
  kind: z.enum(WIKI_KINDS).default('lore'),
  title: z.string().min(1).max(300),
  contentMd: z.string().max(200_000).default(''),
  tags: z.array(z.string().min(1).max(60)).max(40).default([]),
  /** Pages default to GM-only: the GM reveals deliberately (FR5.2). */
  visibility: VisibilitySchema.default('gm'),
  sections: z.array(SectionMetaBody).max(200).optional(),
  audience: z.array(z.string().uuid()).max(24).optional(),
});

const PatchBody = z.object({
  kind: z.enum(WIKI_KINDS).optional(),
  title: z.string().min(1).max(300).optional(),
  contentMd: z.string().max(200_000).optional(),
  tags: z.array(z.string().min(1).max(60)).max(40).optional(),
  visibility: VisibilitySchema.optional(),
  sections: z.array(SectionMetaBody).max(200).optional(),
  audience: z.array(z.string().uuid()).max(24).optional(),
});

const RevealBody = z.object({
  /** Section slug (from the page's `sections`); omitted ⇒ the whole page. */
  section: z.string().min(1).max(120).optional(),
  visibility: VisibilitySchema.default('public'),
  audience: z.array(z.string().uuid()).max(24).optional(),
  /** Suppress the session-log announcement (silent housekeeping flip). */
  announce: z.boolean().default(true),
});

const AttachBody = z.object({
  attachmentId: z.string().uuid(),
  label: z.string().max(200).optional(),
});

/** FR5.6 — which archetype template this page is the codex entry for. */
const TemplateLinkBody = z.object({
  templateId: z.string().uuid(),
});

const HandoutRevealBody = z.object({
  visibility: VisibilitySchema.default('public'),
  pageId: z.string().uuid().optional(),
  sessionId: z.string().uuid().optional(),
  note: z.string().max(500).optional(),
});

function parse<T extends z.ZodType>(schema: T, value: unknown): z.output<T> {
  const parsed = schema.safeParse(value ?? {});
  if (!parsed.success) throw httpError(400, 'bad_request', 'invalid input', parsed.error.issues);
  return parsed.data;
}

function viewerOf(auth: { role: string; userId: string; campaignId: string | null }): Viewer {
  return { role: auth.role, userId: auth.userId, campaignId: auth.campaignId };
}

/** The `sections` JSONB we write back (see services/codex.ts INTEGRATION). */
function metaBlob(meta: PageMeta): PageMeta {
  return { v: 1, sections: meta.sections, handouts: meta.handouts, audience: meta.audience };
}

/**
 * Which visibility the *announcement* carries. A public reveal is table news;
 * a per-player reveal reaches that one player; anything else stays GM-only.
 */
function announceVisibility(
  visibility: Visibility,
  audience: string[],
): { visibility: Visibility; ownerUserId?: string } {
  if (visibility === 'public') return { visibility: 'public' };
  if (visibility === 'gm_owner' && audience.length === 1) {
    return { visibility: 'gm_owner', ownerUserId: audience[0]! };
  }
  return { visibility: 'gm' };
}

export default async function codexPlugin(app: FastifyInstance): Promise<void> {
  // --- list / filter / search (FR5.1) --------------------------------------
  app.get('/api/campaigns/:id/wiki', async (req, reply) => {
    const auth = requireAuth(req);
    const { id } = req.params as { id: string };
    assertCampaign(auth, id);
    const viewer = viewerOf(auth);
    const q = (req.query ?? {}) as Record<string, unknown>;
    const kind = typeof q['kind'] === 'string' ? q['kind'] : null;
    const tag = typeof q['tag'] === 'string' ? q['tag'].toLowerCase() : null;
    const term = typeof q['q'] === 'string' ? q['q'].trim().toLowerCase() : '';

    const rows = visiblePages(await listPageRows(app.db, id), viewer);
    const matched = rows.filter((row) => {
      if (kind && row.kind !== kind) return false;
      if (tag && !row.tags.some((t) => t.toLowerCase() === tag)) return false;
      if (!term) return true;
      // Searched against the FILTERED markdown, not the stored blob: FTS over
      // `content_md` (searchCodex) would happily snippet a GM-only section.
      const meta = readPageMeta(row.sections);
      const body = renderForViewer(row, meta, viewer).contentMd.toLowerCase();
      return row.title.toLowerCase().includes(term) || body.includes(term);
    });
    return reply.send({
      campaignId: id,
      pages: matched.map((row) => pageSummary(row, viewer)),
    });
  });

  // --- create (GM) ---------------------------------------------------------
  app.post('/api/campaigns/:id/wiki', async (req, reply) => {
    const auth = requireRole(req, 'gm');
    const { id } = req.params as { id: string };
    assertCampaign(auth, id);
    const body = parse(CreateBody, req.body);
    const meta: PageMeta = {
      v: 1,
      sections: body.sections ?? [],
      handouts: [],
      audience: body.audience ?? [],
    };
    const row = (
      await app.db
        .insert(wikiPages)
        .values({
          campaignId: id,
          kind: body.kind,
          title: body.title,
          contentMd: body.contentMd,
          tags: body.tags,
          visibility: body.visibility,
          sections: metaBlob(meta),
        })
        .returning()
    )[0]!;
    await recordWikiRevision(app.db, row, auth.userId);
    return reply.status(201).send({ page: await buildPageDto(app.db, row, meta, viewerOf(auth)) });
  });

  // --- dangling [[links]] (FR5.3 create-prompts, GM) ------------------------
  app.get('/api/campaigns/:id/wiki/unresolved', async (req, reply) => {
    const auth = requireRole(req, 'gm');
    const { id } = req.params as { id: string };
    assertCampaign(auth, id);
    return reply.send({ campaignId: id, unresolved: unresolvedReport(await listPageRows(app.db, id)) });
  });

  // --- handouts staged on this campaign (FR5.4) ----------------------------
  app.get('/api/campaigns/:id/handouts', async (req, reply) => {
    const auth = requireAuth(req);
    const { id } = req.params as { id: string };
    assertCampaign(auth, id);
    const viewer = viewerOf(auth);
    const rows = await app.db
      .select()
      .from(attachments)
      .where(and(eq(attachments.campaignId, id), eq(attachments.kind, 'handout')));
    const visible = rows.filter((row) => canView(viewer, row.visibility));
    return reply.send({
      campaignId: id,
      handouts: visible.map((row) =>
        handoutView({ attachmentId: row.id, addedAt: row.createdAt.toISOString() }, row),
      ),
    });
  });

  // --- read one page -------------------------------------------------------
  app.get('/api/wiki/:id', async (req, reply) => {
    const auth = requireAuth(req);
    const { id } = req.params as { id: string };
    const viewer = viewerOf(auth);
    const { row, meta } = await requireVisiblePage(app.db, id, viewer);
    const page = await buildPageDto(app.db, row, meta, viewer);
    // FR5.6: the archetype templates this page is the codex entry for. GM-only
    // — a shared location page must not leak the opposition waiting in it.
    if (viewer.role !== 'gm') return reply.send({ page });
    return reply.send({
      page: { ...page, templates: await templatesForPage(app.db, row.campaignId, row.id) },
    });
  });

  // --- FR5.6: link a page to the templates it describes (GM) ---------------
  app.post('/api/wiki/:id/templates', async (req, reply) => {
    const auth = requireRole(req, 'gm');
    const { id } = req.params as { id: string };
    const body = parse(TemplateLinkBody, req.body);
    const row = await loadPage(app.db, id);
    if (!row) throw httpError(404, 'not_found', 'unknown codex page');
    assertCampaign(auth, row.campaignId);
    const link = await setTemplatePage(app.db, row.campaignId, body.templateId, row.id);
    return reply.status(201).send({ link });
  });

  app.delete('/api/wiki/:id/templates/:templateId', async (req, reply) => {
    const auth = requireRole(req, 'gm');
    const { id, templateId } = req.params as { id: string; templateId: string };
    const row = await loadPage(app.db, id);
    if (!row) throw httpError(404, 'not_found', 'unknown codex page');
    assertCampaign(auth, row.campaignId);
    const current = await templateLink(app.db, row.campaignId, templateId);
    if (current.wikiPageId !== row.id) {
      throw httpError(409, 'not_linked', 'that template does not point at this page');
    }
    return reply.send({ link: await setTemplatePage(app.db, row.campaignId, templateId, null) });
  });

  // --- edit (GM) — every edit writes a revision ----------------------------
  app.patch('/api/wiki/:id', async (req, reply) => {
    const auth = requireRole(req, 'gm');
    const { id } = req.params as { id: string };
    const body = parse(PatchBody, req.body);
    const before = await loadPage(app.db, id);
    if (!before) throw httpError(404, 'not_found', 'unknown codex page');
    assertCampaign(auth, before.campaignId);

    const meta = readPageMeta(before.sections);
    if (body.sections !== undefined) meta.sections = body.sections;
    if (body.audience !== undefined) meta.audience = body.audience;

    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (body.kind !== undefined) patch['kind'] = body.kind;
    if (body.title !== undefined) patch['title'] = body.title;
    if (body.contentMd !== undefined) patch['contentMd'] = body.contentMd;
    if (body.tags !== undefined) patch['tags'] = body.tags;
    if (body.visibility !== undefined) patch['visibility'] = body.visibility;
    if (body.sections !== undefined || body.audience !== undefined) {
      patch['sections'] = metaBlob(meta);
    }
    if (Object.keys(patch).length === 1) throw httpError(400, 'bad_request', 'nothing to update');

    const row = (await app.db.update(wikiPages).set(patch).where(eq(wikiPages.id, id)).returning())[0]!;
    await recordWikiRevision(app.db, row, auth.userId);
    return reply.send({ page: await buildPageDto(app.db, row, readPageMeta(row.sections), viewerOf(auth)) });
  });

  app.delete('/api/wiki/:id', async (req, reply) => {
    const auth = requireRole(req, 'gm');
    const { id } = req.params as { id: string };
    const row = await loadPage(app.db, id);
    if (!row) throw httpError(404, 'not_found', 'unknown codex page');
    assertCampaign(auth, row.campaignId);
    await app.db.delete(wikiPages).where(eq(wikiPages.id, id));
    return reply.send({ deleted: id });
  });

  // --- reveal a page or one named section (FR5.2) --------------------------
  app.post('/api/wiki/:id/reveal', async (req, reply) => {
    const auth = requireRole(req, 'gm');
    const { id } = req.params as { id: string };
    const body = parse(RevealBody, req.body);
    const row = await loadPage(app.db, id);
    if (!row) throw httpError(404, 'not_found', 'unknown codex page');
    assertCampaign(auth, row.campaignId);
    const meta = readPageMeta(row.sections);
    const audience = body.audience ?? [];

    let heading: string | undefined;
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (body.section) {
      const block = parseSections(row.contentMd).blocks.find((b) => b.id === body.section);
      if (!block) throw httpError(404, 'not_found', `no section '${body.section}' on this page`);
      heading = block.heading;
      const next = {
        id: block.id,
        heading: block.heading,
        visibility: body.visibility,
        ...(audience.length > 0 ? { audience } : {}),
      };
      meta.sections = [...meta.sections.filter((s) => s.id !== block.id), next];
      patch['sections'] = metaBlob(meta);
    } else {
      patch['visibility'] = body.visibility;
      if (body.audience !== undefined) {
        meta.audience = audience;
        patch['sections'] = metaBlob(meta);
      }
    }

    // The visibility flip IS the reveal (Principle 4 gates reads on the stored
    // row); `wiki.revealed` is how anyone finds out it happened. Split, a
    // GM who reveals the sequence of the night gets no push and no card —
    // the page is open and nobody at the table knows to look at it.
    const announce = body.announce ? announceVisibility(body.visibility, audience) : null;
    const updated = await app.hub.atomic(row.campaignId, async (tx) => {
      const next = (
        await tx.db.update(wikiPages).set(patch).where(eq(wikiPages.id, id)).returning()
      )[0]!;
      await recordWikiRevision(tx.db, next, auth.userId);
      if (announce) {
        await tx.emit({
          type: 'wiki.revealed',
          payload: {
            pageId: next.id,
            title: next.title,
            kind: next.kind,
            visibility: body.visibility,
            ...(body.section ? { section: { id: body.section, heading: heading ?? '' } } : {}),
          },
          visibility: announce.visibility,
          ...(announce.ownerUserId ? { ownerUserId: announce.ownerUserId } : {}),
        });
      }
      return next;
    });

    return reply.send({
      page: await buildPageDto(app.db, updated, readPageMeta(updated.sections), viewerOf(auth)),
      revealed: { pageId: updated.id, section: body.section ?? null, visibility: body.visibility },
    });
  });

  // --- revision history (GM) ----------------------------------------------
  app.get('/api/wiki/:id/revisions', async (req, reply) => {
    const auth = requireRole(req, 'gm');
    const { id } = req.params as { id: string };
    const row = await loadPage(app.db, id);
    if (!row) throw httpError(404, 'not_found', 'unknown codex page');
    assertCampaign(auth, row.campaignId);
    const rows = await app.db
      .select({
        seq: wikiRevisions.seq,
        createdBy: wikiRevisions.createdBy,
        createdAt: wikiRevisions.createdAt,
        chars: sql<number>`length(${wikiRevisions.contentMd})::int`,
      })
      .from(wikiRevisions)
      .where(eq(wikiRevisions.wikiPageId, id))
      .orderBy(desc(wikiRevisions.seq));
    return reply.send({
      pageId: id,
      revisions: rows.map((r) => ({
        seq: r.seq,
        createdBy: r.createdBy,
        createdAt: r.createdAt.toISOString(),
        chars: r.chars,
      })),
    });
  });

  // --- handouts: pin / unpin / reveal (FR5.4) ------------------------------
  app.post('/api/wiki/:id/handouts', async (req, reply) => {
    const auth = requireRole(req, 'gm');
    const { id } = req.params as { id: string };
    const body = parse(AttachBody, req.body);
    const row = await loadPage(app.db, id);
    if (!row) throw httpError(404, 'not_found', 'unknown codex page');
    assertCampaign(auth, row.campaignId);
    const att = (
      await app.db.select().from(attachments).where(eq(attachments.id, body.attachmentId)).limit(1)
    )[0];
    if (!att) throw httpError(404, 'not_found', 'unknown attachment');
    if (att.campaignId && att.campaignId !== row.campaignId) {
      throw httpError(403, 'forbidden', 'attachment belongs to another campaign');
    }
    const meta = readPageMeta(row.sections);
    const link: HandoutLink = {
      attachmentId: att.id,
      ...(body.label ? { label: body.label } : {}),
      addedAt: new Date().toISOString(),
    };
    meta.handouts = [...meta.handouts.filter((h) => h.attachmentId !== att.id), link];
    await app.db
      .update(wikiPages)
      .set({ sections: metaBlob(meta), updatedAt: new Date() })
      .where(eq(wikiPages.id, id));
    return reply.status(201).send({ pageId: id, handout: handoutView(link, att) });
  });

  app.delete('/api/wiki/:id/handouts/:attachmentId', async (req, reply) => {
    const auth = requireRole(req, 'gm');
    const { id, attachmentId } = req.params as { id: string; attachmentId: string };
    const row = await loadPage(app.db, id);
    if (!row) throw httpError(404, 'not_found', 'unknown codex page');
    assertCampaign(auth, row.campaignId);
    const meta = readPageMeta(row.sections);
    meta.handouts = meta.handouts.filter((h) => h.attachmentId !== attachmentId);
    await app.db
      .update(wikiPages)
      .set({ sections: metaBlob(meta), updatedAt: new Date() })
      .where(eq(wikiPages.id, id));
    return reply.send({ pageId: id, detached: attachmentId });
  });

  /**
   * Staged private → revealed live. The attachment's own visibility is the
   * gate on `GET /files/:id`, so flipping it here is what actually lets the
   * table see the image — the event is the announcement, not the permission.
   */
  app.post('/api/handouts/:attachmentId/reveal', async (req, reply) => {
    const auth = requireRole(req, 'gm');
    const { attachmentId } = req.params as { attachmentId: string };
    const body = parse(HandoutRevealBody, req.body);
    const att = (
      await app.db.select().from(attachments).where(eq(attachments.id, attachmentId)).limit(1)
    )[0];
    if (!att) throw httpError(404, 'not_found', 'unknown attachment');
    // Global-library files (shared book PDFs) have no campaign; flipping one
    // public here would leak it into every campaign at once — books own those.
    if (!att.campaignId) {
      throw httpError(400, 'bad_request', 'global library files are not campaign handouts');
    }
    const campaignId = att.campaignId;
    assertCampaign(auth, campaignId);

    // Hoisted ABOVE the transaction (the deadlock rule on `Hub.atomic`): the
    // title is a read, and the flip below does not change it.
    let pageTitle: string | undefined;
    if (body.pageId) {
      const page = await loadPage(app.db, body.pageId);
      if (page && page.campaignId === campaignId) pageTitle = page.title;
    }
    const announce = announceVisibility(body.visibility, []);

    // The flip is the permission and the event is the announcement, so a torn
    // write is an image the table may now open and will never be shown.
    const updated = await app.hub.atomic(campaignId, async (tx) => {
      const next = (
        await tx.db
          .update(attachments)
          .set({ visibility: body.visibility })
          .where(eq(attachments.id, attachmentId))
          .returning()
      )[0]!;
      await tx.emit({
        type: 'handout.revealed',
        payload: {
          attachmentId: next.id,
          url: `/files/${next.id}`,
          mime: next.mime,
          kind: next.kind,
          visibility: next.visibility,
          ...(body.pageId ? { pageId: body.pageId } : {}),
          ...(pageTitle ? { pageTitle } : {}),
          ...(body.sessionId ? { sessionId: body.sessionId } : {}),
          ...(body.note ? { note: body.note } : {}),
        },
        visibility: announce.visibility,
      });
      return next;
    });

    return reply.send({
      handout: handoutView(
        { attachmentId: updated.id, addedAt: updated.createdAt.toISOString() },
        updated,
      ),
    });
  });

  // Runs + the in-game calendar (FR5.5/FR5.7) ride in the same domain.
  await app.register(registerRunRoutes);
  await app.register(registerCalendarRoutes);
}
