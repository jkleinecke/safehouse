/**
 * FR5.6 — archetype templates live in the codex.
 *
 * The point of the link is that FR9.3's map pins, FR10.1's templates and
 * FR5.1's pages stop being three disconnected tables: a pin opens a page, the
 * page names the template, the template rolls the NPC. So these tests care
 * about the graph being traversable in both directions from one column, and
 * about the link not becoming a way for a shared page to leak the opposition
 * standing behind it (Principle 4).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { campaigns, npcTemplates, wikiPages } from '@safehouse/db';
import {
  bootstrapCampaign,
  joinAs,
  makeTestApp,
  type BootstrapResult,
  type JoinResult,
  type TestApp,
} from './core-helpers.js';
import { seedFixerFixture, type FixerFixture } from './fixer-helpers.js';
import { templateLinkView } from '../src/services/codex.js';
import {
  setTemplatePage,
  templateLink,
  templatesForPage,
} from '../src/services/codex-templates.js';

let t: TestApp;
let boot: BootstrapResult;
/** A second campaign on the same server — the boundary the link must respect. */
let otherCampaignId = '';
let player: JoinResult;
let fx: FixerFixture;
let pageId = '';

function gm(url: string, payload?: Record<string, unknown>, method: 'GET' | 'POST' | 'DELETE' = 'GET') {
  return t.app.inject({
    method,
    url,
    headers: { authorization: `Bearer ${boot.gmToken}` },
    ...(payload !== undefined ? { payload } : {}),
  });
}

beforeAll(async () => {
  t = await makeTestApp('codex-templates');
  boot = await bootstrapCampaign(t.app, 'Neon Rain');
  otherCampaignId = (
    await t.db
      .insert(campaigns)
      .values({ name: 'Somebody Else’s Table', gmUserId: boot.gmUserId })
      .returning()
  )[0]!.id;
  player = await joinAs(t.app, boot.campaignId, boot.gmToken, 'player', 'Kestrel');
  fx = await seedFixerFixture(t.db, boot.campaignId);

  const created = await gm(`/api/campaigns/${boot.campaignId}/wiki`, {
    kind: 'faction',
    title: 'The Rusted Halo',
    contentMd: 'A dockside crew that runs the north gate.\n\n## Muscle\nThey hire by the night.',
    visibility: 'public',
  }, 'POST');
  expect(created.statusCode).toBe(201);
  pageId = (created.json() as { page: { id: string } }).page.id;
}, 120_000);

afterAll(async () => {
  await t.close();
});

describe('the link view (pure)', () => {
  it('lifts the role tags out of gen and reports whether a book ref exists', () => {
    expect(
      templateLinkView({
        id: 'a',
        name: 'Street enforcer',
        gen: { roleTags: ['muscle', 'street'] },
        wikiPageId: null,
        pageRef: null,
      }),
    ).toEqual({
      templateId: 'a',
      name: 'Street enforcer',
      roleTags: ['muscle', 'street'],
      wikiPageId: null,
      hasPageRef: false,
    });
    const withRef = templateLinkView({
      id: 'b',
      name: 'Corp guard',
      gen: {},
      wikiPageId: 'page-1',
      pageRef: { book: 'SR5', page: 300 },
    });
    expect(withRef).toMatchObject({ roleTags: [], wikiPageId: 'page-1', hasPageRef: true });
  });
});

describe('linking a template to a page', () => {
  it('starts unlinked', async () => {
    const link = await templateLink(t.db, boot.campaignId, fx.templateId);
    expect(link.wikiPageId).toBeNull();
    expect(await templatesForPage(t.db, boot.campaignId, pageId)).toHaveLength(0);
  });

  it('POST /api/wiki/:id/templates points the template at the page', async () => {
    const res = await gm(`/api/wiki/${pageId}/templates`, { templateId: fx.templateId }, 'POST');
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      link: { templateId: fx.templateId, name: 'Street enforcer', wikiPageId: pageId, roleTags: ['muscle'] },
    });

    // The column is the single source of truth: both directions read it.
    const row = (
      await t.db.select().from(npcTemplates).where(eq(npcTemplates.id, fx.templateId)).limit(1)
    )[0]!;
    expect(row.name).toBe('Street enforcer');
    const back = await templatesForPage(t.db, boot.campaignId, pageId);
    expect(back.map((l) => l.templateId)).toEqual([fx.templateId]);
  });

  it('shows the link on the GM’s page read', async () => {
    const res = await gm(`/api/wiki/${pageId}`);
    expect(res.statusCode).toBe(200);
    const page = (res.json() as { page: Record<string, unknown> }).page;
    const templates = page['templates'] as Array<Record<string, unknown>>;
    expect(templates).toHaveLength(1);
    expect(templates[0]).toMatchObject({ templateId: fx.templateId, roleTags: ['muscle'] });
  });

  it('never shows it to a player, even on a public page (Principle 4)', async () => {
    const res = await t.app.inject({
      method: 'GET',
      url: `/api/wiki/${pageId}`,
      headers: { authorization: `Bearer ${player.token}` },
    });
    expect(res.statusCode).toBe(200);
    const page = (res.json() as { page: Record<string, unknown> }).page;
    expect(page['templates']).toBeUndefined();
    expect(res.body).not.toContain(fx.templateId);
  });

  it('refuses to link across campaigns', async () => {
    const foreign = (
      await t.db
        .insert(wikiPages)
        .values({ campaignId: otherCampaignId, title: 'Not yours', contentMd: '' })
        .returning()
    )[0]!;
    await expect(
      setTemplatePage(t.db, boot.campaignId, fx.templateId, foreign.id),
    ).rejects.toMatchObject({ statusCode: 404 });
    await expect(
      setTemplatePage(t.db, otherCampaignId, fx.templateId, foreign.id),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('404s on an unknown template rather than creating anything', async () => {
    const res = await gm(
      `/api/wiki/${pageId}/templates`,
      { templateId: '00000000-0000-4000-8000-000000000000' },
      'POST',
    );
    expect(res.statusCode).toBe(404);
  });

  it('is GM-only to set', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: `/api/wiki/${pageId}/templates`,
      headers: { authorization: `Bearer ${player.token}` },
      payload: { templateId: fx.templateId },
    });
    expect(res.statusCode).toBe(403);
  });

  it('unlinks, and refuses to unlink from a page the template does not point at', async () => {
    const otherPage = await gm(
      `/api/campaigns/${boot.campaignId}/wiki`,
      { title: 'Unrelated place', contentMd: '' },
      'POST',
    );
    const otherPageId = (otherPage.json() as { page: { id: string } }).page.id;
    const wrong = await gm(`/api/wiki/${otherPageId}/templates/${fx.templateId}`, undefined, 'DELETE');
    expect(wrong.statusCode).toBe(409);

    const res = await gm(`/api/wiki/${pageId}/templates/${fx.templateId}`, undefined, 'DELETE');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ link: { wikiPageId: null } });
    expect(await templatesForPage(t.db, boot.campaignId, pageId)).toHaveLength(0);
  });

  it('survives the page being deleted — the stat block outlives the lore', async () => {
    const relink = await gm(`/api/wiki/${pageId}/templates`, { templateId: fx.templateId }, 'POST');
    expect(relink.statusCode).toBe(201);
    const deleted = await gm(`/api/wiki/${pageId}`, undefined, 'DELETE');
    expect(deleted.statusCode).toBe(200);

    const link = await templateLink(t.db, boot.campaignId, fx.templateId);
    expect(link.wikiPageId).toBeNull();
    const row = (
      await t.db.select().from(npcTemplates).where(eq(npcTemplates.id, fx.templateId)).limit(1)
    )[0];
    expect(row).toBeDefined();
  });
});
