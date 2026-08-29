/**
 * Campaign codex (M5 — FR5.1–5.4): typed pages, per-page AND per-section
 * visibility enforced server-side, reveal, [[Wiki-links]] + backlinks, ref
 * chips, handouts staged private then revealed live, and wiki_revisions on
 * every edit.
 *
 * The load-bearing assertions are the negative ones: a player's GET must not
 * CONTAIN a GM-only section — not its heading, not its prose, not the links or
 * refs inside it (Principle 4, never client-side redaction).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { desc, eq } from 'drizzle-orm';
import { attachments, wsEvents } from '@safehouse/db';
import {
  makeTestApp,
  bootstrapCampaign,
  joinAs,
  type BootstrapResult,
  type JoinResult,
  type TestApp,
} from './core-helpers.js';

let t: TestApp;
let boot: BootstrapResult;
let player: JoinResult;
let other: JoinResult;
let docksId: string;
let marlaId: string;
let secretPageId: string;
let handoutId: string;

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

const DOCKS_MD = [
  'The pier lights buzz all night; ask [[Marla Quint]] before you walk in. Rules ref: SR5 p.426.',
  '',
  '## Public rumour',
  '',
  'Dockhands say the night crew changed twice this month.',
  '',
  '## GM only',
  '',
  'The harbourmaster is on the [[Ghost Cartel]] payroll.',
  '',
  '### Sniper detail',
  '',
  'A shooter watches from crane four.',
].join('\n');

interface PageBody {
  id: string;
  title: string;
  kind: string;
  visibility: string;
  tags: string[];
  contentMd: string;
  sections: Array<{ id: string; heading: string; visibility: string }>;
  links: { resolved: Array<{ target: string; pageId: string }>; unresolved: Array<{ target: string }> };
  backlinks: Array<{ id: string; title: string }>;
  refs: Array<{ book: string; page: number }>;
  handouts: Array<{ attachmentId: string; revealed: boolean }>;
  gmOnlySections?: number;
}

async function post(token: string, url: string, payload: unknown) {
  return t.app.inject({ method: 'POST', url, headers: auth(token), payload: payload as never });
}

async function get(token: string, url: string) {
  return t.app.inject({ method: 'GET', url, headers: auth(token) });
}

async function page(token: string, id: string): Promise<PageBody> {
  const res = await get(token, `/api/wiki/${id}`);
  expect(res.statusCode).toBe(200);
  return (res.json() as { page: PageBody }).page;
}

beforeAll(async () => {
  t = await makeTestApp('codex');
  boot = await bootstrapCampaign(t.app);
  player = await joinAs(t.app, boot.campaignId, boot.gmToken, 'player', 'Rivet');
  other = await joinAs(t.app, boot.campaignId, boot.gmToken, 'player', 'Nomad');
}, 120_000);

afterAll(async () => {
  await t.close();
}, 60_000);

describe('pages + typed kinds (FR5.1)', () => {
  it('creates pages with kind, tags and markdown', async () => {
    const marla = await post(boot.gmToken, `/api/campaigns/${boot.campaignId}/wiki`, {
      kind: 'npc',
      title: 'Marla Quint',
      visibility: 'public',
      tags: ['fixer', 'docks'],
      contentMd: 'Runs cargo out of the [[Hollow Bay Docks]]. Never takes a meeting twice.',
    });
    expect(marla.statusCode).toBe(201);
    marlaId = (marla.json() as { page: PageBody }).page.id;

    const docks = await post(boot.gmToken, `/api/campaigns/${boot.campaignId}/wiki`, {
      kind: 'location',
      title: 'Hollow Bay Docks',
      visibility: 'gm',
      tags: ['seattle'],
      contentMd: DOCKS_MD,
      // Per-section visibility, set up front (FR5.2).
      sections: [
        { id: 'gm-only', visibility: 'gm' },
        { id: 'sniper-detail', visibility: 'gm' },
      ],
    });
    expect(docks.statusCode).toBe(201);
    const created = (docks.json() as { page: PageBody }).page;
    docksId = created.id;
    expect(created.kind).toBe('location');
    expect(created.tags).toEqual(['seattle']);
  });

  it('rejects an unknown kind', async () => {
    const res = await post(boot.gmToken, `/api/campaigns/${boot.campaignId}/wiki`, {
      kind: 'spaceship',
      title: 'Nope',
    });
    expect(res.statusCode).toBe(400);
  });

  it('a player may not create pages', async () => {
    const res = await post(player.token, `/api/campaigns/${boot.campaignId}/wiki`, {
      title: 'Player page',
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('page visibility is server-side (FR5.2, Principle 4)', () => {
  it('a GM-only page 404s for a player and is absent from the list', async () => {
    const res = await get(player.token, `/api/wiki/${docksId}`);
    expect(res.statusCode).toBe(404);
    const list = await get(player.token, `/api/campaigns/${boot.campaignId}/wiki`);
    const titles = (list.json() as { pages: Array<{ title: string }> }).pages.map((p) => p.title);
    expect(titles).toEqual(['Marla Quint']);
  });

  it('search never snippets a page the caller cannot open', async () => {
    const asPlayer = await get(
      player.token,
      `/api/campaigns/${boot.campaignId}/wiki?q=harbourmaster`,
    );
    expect((asPlayer.json() as { pages: unknown[] }).pages).toHaveLength(0);
    const asGm = await get(boot.gmToken, `/api/campaigns/${boot.campaignId}/wiki?q=harbourmaster`);
    expect((asGm.json() as { pages: Array<{ id: string }> }).pages.map((p) => p.id)).toEqual([docksId]);
  });

  it('reveal flips the page to shared and announces it (wiki.revealed)', async () => {
    const res = await post(boot.gmToken, `/api/wiki/${docksId}/reveal`, {});
    expect(res.statusCode).toBe(200);
    expect((res.json() as { revealed: { visibility: string } }).revealed.visibility).toBe('public');

    const rows = await t.db
      .select()
      .from(wsEvents)
      .where(eq(wsEvents.type, 'wiki.revealed'))
      .orderBy(desc(wsEvents.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.visibility).toBe('public');
    expect(rows[0]?.payload).toMatchObject({ pageId: docksId, title: 'Hollow Bay Docks' });
  });

  it('the revealed page reaches the player WITHOUT its GM-only sections', async () => {
    const view = await page(player.token, docksId);
    expect(view.contentMd).toContain('Marla Quint');
    expect(view.contentMd).toContain('Public rumour');
    // Not redacted — simply never sent.
    expect(view.contentMd).not.toContain('GM only');
    expect(view.contentMd).not.toContain('harbourmaster');
    expect(view.contentMd).not.toContain('Sniper detail');
    expect(view.contentMd).not.toContain('crane four');
    expect(view.sections.map((s) => s.id)).toEqual(['public-rumour']);
    // The [[Ghost Cartel]] link lives in the hidden section: invisible too.
    expect(JSON.stringify(view.links)).not.toContain('Ghost Cartel');
  });

  it('the GM still sees the whole document', async () => {
    const view = await page(boot.gmToken, docksId);
    expect(view.contentMd).toContain('crane four');
    expect(view.sections.map((s) => s.id)).toEqual(['public-rumour', 'gm-only', 'sniper-detail']);
    expect(view.sections.find((s) => s.id === 'gm-only')?.visibility).toBe('gm');
    expect(view.gmOnlySections).toBe(2);
  });

  it('revealing one section leaves its GM-only subsection hidden', async () => {
    const res = await post(boot.gmToken, `/api/wiki/${docksId}/reveal`, { section: 'gm-only' });
    expect(res.statusCode).toBe(200);
    const view = await page(player.token, docksId);
    expect(view.contentMd).toContain('harbourmaster');
    expect(view.contentMd).not.toContain('crane four');
    expect(view.sections.map((s) => s.id)).toEqual(['public-rumour', 'gm-only']);

    const rows = await t.db.select().from(wsEvents).where(eq(wsEvents.type, 'wiki.revealed'));
    expect(rows).toHaveLength(2);
    expect(rows[1]?.payload).toMatchObject({ section: { id: 'gm-only', heading: 'GM only' } });
  });

  it('revealing an unknown section 404s', async () => {
    const res = await post(boot.gmToken, `/api/wiki/${docksId}/reveal`, { section: 'no-such' });
    expect(res.statusCode).toBe(404);
  });
});

describe('[[Wiki-links]], backlinks and ref chips (FR5.3)', () => {
  it('resolves links, reports unresolved ones and parses SR5 p.426', async () => {
    const view = await page(boot.gmToken, docksId);
    expect(view.links.resolved.map((l) => l.target)).toContain('Marla Quint');
    expect(view.links.resolved.find((l) => l.target === 'Marla Quint')?.pageId).toBe(marlaId);
    expect(view.links.unresolved.map((l) => l.target)).toEqual(['Ghost Cartel']);
    expect(view.refs).toContainEqual(expect.objectContaining({ book: 'SR5', page: 426 }));
  });

  it('backlinks resolve, and a GM-only page never backlinks for a player', async () => {
    const secret = await post(boot.gmToken, `/api/campaigns/${boot.campaignId}/wiki`, {
      kind: 'faction',
      title: 'Ghost Cartel Ledger',
      visibility: 'gm',
      contentMd: 'Payments routed through [[Hollow Bay Docks]] every third night.',
    });
    secretPageId = (secret.json() as { page: PageBody }).page.id;

    const gmView = await page(boot.gmToken, docksId);
    expect(gmView.backlinks.map((b) => b.title).sort()).toEqual(['Ghost Cartel Ledger', 'Marla Quint']);

    const playerView = await page(player.token, docksId);
    expect(playerView.backlinks.map((b) => b.title)).toEqual(['Marla Quint']);
  });

  it('the campaign-wide unresolved report is GM-only', async () => {
    const res = await get(boot.gmToken, `/api/campaigns/${boot.campaignId}/wiki/unresolved`);
    expect(res.statusCode).toBe(200);
    const out = res.json() as { unresolved: Array<{ target: string; from: Array<{ id: string }> }> };
    const cartel = out.unresolved.find((u) => u.target === 'Ghost Cartel');
    expect(cartel?.from.map((f) => f.id)).toEqual([docksId]);

    const denied = await get(player.token, `/api/campaigns/${boot.campaignId}/wiki/unresolved`);
    expect(denied.statusCode).toBe(403);
  });
});

describe('edits + revisions (FR5.1)', () => {
  it('every edit writes a wiki_revision', async () => {
    const res = await t.app.inject({
      method: 'PATCH',
      url: `/api/wiki/${docksId}`,
      headers: auth(boot.gmToken),
      payload: { contentMd: `${DOCKS_MD}\n\nThe fence on pier six answers to nobody.`, tags: ['seattle', 'docks'] },
    });
    expect(res.statusCode).toBe(200);
    const view = (res.json() as { page: PageBody }).page;
    expect(view.tags).toEqual(['seattle', 'docks']);

    const list = await get(boot.gmToken, `/api/wiki/${docksId}/revisions`);
    const revisions = (list.json() as { revisions: Array<{ seq: number }> }).revisions;
    // create + page reveal + section reveal + this edit.
    expect(revisions.map((r) => r.seq)).toEqual([4, 3, 2, 1]);

    const denied = await get(player.token, `/api/wiki/${docksId}/revisions`);
    expect(denied.statusCode).toBe(403);
  });

  it('a player may not edit or delete a page', async () => {
    const patch = await t.app.inject({
      method: 'PATCH',
      url: `/api/wiki/${docksId}`,
      headers: auth(player.token),
      payload: { title: 'Hacked' },
    });
    expect(patch.statusCode).toBe(403);
    const del = await t.app.inject({
      method: 'DELETE',
      url: `/api/wiki/${secretPageId}`,
      headers: auth(player.token),
    });
    expect(del.statusCode).toBe(403);
  });
});

describe('handouts (FR5.4)', () => {
  it('stages a handout privately and reveals it live', async () => {
    const row = (
      await t.db
        .insert(attachments)
        .values({
          campaignId: boot.campaignId,
          kind: 'handout',
          path: 'handouts/manifest.png',
          mime: 'image/png',
          size: 1024,
          visibility: 'gm',
        })
        .returning()
    )[0]!;
    handoutId = row.id;

    const attach = await post(boot.gmToken, `/api/wiki/${docksId}/handouts`, {
      attachmentId: handoutId,
      label: 'Cargo manifest',
    });
    expect(attach.statusCode).toBe(201);

    // Staged: the GM sees it on the page, the player does not.
    expect((await page(boot.gmToken, docksId)).handouts).toHaveLength(1);
    expect((await page(player.token, docksId)).handouts).toHaveLength(0);
    const staged = await get(player.token, `/api/campaigns/${boot.campaignId}/handouts`);
    expect((staged.json() as { handouts: unknown[] }).handouts).toHaveLength(0);

    const reveal = await post(boot.gmToken, `/api/handouts/${handoutId}/reveal`, { pageId: docksId });
    expect(reveal.statusCode).toBe(200);
    expect((reveal.json() as { handout: { revealed: boolean } }).handout.revealed).toBe(true);

    const seen = (await page(player.token, docksId)).handouts;
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ attachmentId: handoutId, revealed: true });

    const rows = await t.db.select().from(wsEvents).where(eq(wsEvents.type, 'handout.revealed'));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.visibility).toBe('public');
    expect(rows[0]?.payload).toMatchObject({ attachmentId: handoutId, pageTitle: 'Hollow Bay Docks' });
  });

  it('refuses to reveal a global library file', async () => {
    const global = (
      await t.db
        .insert(attachments)
        .values({
          campaignId: null,
          kind: 'asset',
          path: 'books/SR5.pdf',
          mime: 'application/pdf',
          size: 42,
          visibility: 'gm',
        })
        .returning()
    )[0]!;
    const res = await post(boot.gmToken, `/api/handouts/${global.id}/reveal`, {});
    expect(res.statusCode).toBe(400);
  });

  it('detaches a handout', async () => {
    const res = await t.app.inject({
      method: 'DELETE',
      url: `/api/wiki/${docksId}/handouts/${handoutId}`,
      headers: auth(boot.gmToken),
    });
    expect(res.statusCode).toBe(200);
    expect((await page(boot.gmToken, docksId)).handouts).toHaveLength(0);
  });
});

describe('per-player visibility (FR5.2)', () => {
  it('per-player visibility reaches one runner and nobody else (FR5.2)', async () => {
    const created = await post(boot.gmToken, `/api/campaigns/${boot.campaignId}/wiki`, {
      kind: 'lore',
      title: 'What Rivet Remembers',
      visibility: 'public',
      contentMd: [
        'Everyone at the table knows the warehouse burned.',
        '',
        '## The face in the smoke',
        '',
        'Rivet alone saw who walked out of it.',
      ].join('\n'),
    });
    const pageId = (created.json() as { page: PageBody }).page.id;

    const reveal = await post(boot.gmToken, `/api/wiki/${pageId}/reveal`, {
      section: 'the-face-in-the-smoke',
      visibility: 'gm_owner',
      audience: [player.user.id],
    });
    expect(reveal.statusCode).toBe(200);

    const mine = await page(player.token, pageId);
    expect(mine.contentMd).toContain('who walked out of it');
    const theirs = await page(other.token, pageId);
    expect(theirs.contentMd).toContain('warehouse burned');
    expect(theirs.contentMd).not.toContain('who walked out of it');
    expect(theirs.sections).toHaveLength(0);

    // The announcement is addressed to that one player, not the table.
    const rows = await t.db
      .select()
      .from(wsEvents)
      .where(eq(wsEvents.type, 'wiki.revealed'))
      .orderBy(desc(wsEvents.id));
    expect(rows[0]).toMatchObject({ visibility: 'gm_owner', ownerUserId: player.user.id });
  });
});
