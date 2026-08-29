/**
 * Beat two — the GM's prep, read back from the phones (M5: FR5.1–5.3, 5.5,
 * 5.7, 5.8).
 *
 * The codex is the module the build report called the largest missing one, and
 * the interesting half of it is secrecy: a page can be shared with the table
 * while one section of it is not, and "not" has to mean *the bytes never leave
 * the server* (Principle 4), not a hidden `<div>`. So the same page is fetched
 * from a phone before and after the reveal and the two payloads are compared.
 *
 * The contact and the calendar beat are here for the same reason the Fixer's
 * `list_contacts` / `get_calendar` tools exist: they are campaign state the
 * table actually plays with, and they were unreachable before this round.
 */
import type { Api, Live } from './harness.js';
import type { World } from './setup.js';
import type { Ctx, Dict, Phone } from './types.js';

/** The distinctive line in the GM-only section; nothing else in the db has it. */
export const SECRET_SECTION_MARKER = 'a second deposit, from a buyer who is not Mr. Pell';
const GM_SECTION_HEADING = 'What Ratchet is actually selling';
const GM_SECTION_SLUG = 'what-ratchet-is-actually-selling';

const HALO_PAGE_MD = [
  'The Rusted Halo took Pier 23 the year the lease-holder stopped paying anyone, and nobody has',
  'come to argue about it since. Twenty-odd bodies; three of them worth a name.',
  '',
  '## What the street knows',
  '',
  'They run the pier as a transhipment drop and charge by the crate. They are not subtle, they are',
  'not organised, and they have never once been paid in advance for anything.',
  '',
  `## ${GM_SECTION_HEADING}`,
  '',
  `Ratchet has taken ${SECRET_SECTION_MARKER}. She intends to sell the crate twice and let the two`,
  'of them find each other on the pier. If the crew is quick she never gets the chance.',
].join('\n');

interface PageDto {
  id: string;
  title: string;
  kind: string;
  visibility: string;
  contentMd: string;
  sections: Array<{ id: string; heading: string; visibility: string }>;
}

interface ContactDto {
  id: string;
  name: string;
  archetype: string;
  connection: number;
  loyalty: number;
  favours: { owed: number; owing: number };
}

interface TemplateLink {
  templateId: string;
  name: string;
  roleTags: string[];
  wikiPageId: string | null;
  hasPageRef: boolean;
}

export interface PrepResult {
  haloPageId: string;
  runId: string;
  contactId: string;
  /** The Rusted Halo archetype template, now linked to the gang's page (FR5.6). */
  templateId: string;
}

export async function prep(
  ctx: Ctx,
  world: World,
  gm: Api,
  phones: Record<string, Phone>,
  gmLive: Live,
): Promise<PrepResult> {
  const { checks, story } = ctx;
  const cid = world.campaignId;
  checks.beat('2 · The codex, a contact, the job');
  story.beat('Before the run — the GM writes it down where the table can read half of it');

  // --- a page shared with the table, with one section that is not ----------
  const created = await gm.post<{ page: PageDto }>(`/api/campaigns/${cid}/wiki`, {
    kind: 'faction',
    title: 'The Rusted Halo',
    contentMd: HALO_PAGE_MD,
    tags: ['gang', 'docklands'],
    visibility: 'public',
    sections: [{ id: GM_SECTION_SLUG, heading: GM_SECTION_HEADING, visibility: 'gm' }],
  });
  const pageId = created.page.id;
  checks.eq('the GM writes a codex page and shares it with the table', 'public', created.page.visibility);

  const torque = phones['Torque']!;
  const before = await torque.api.get<{ page: PageDto }>(`/api/wiki/${pageId}`);
  checks.record(
    "a player's copy of the page does not contain the GM-only section",
    'neither the heading nor its prose anywhere in the payload',
    JSON.stringify(before).includes(SECRET_SECTION_MARKER)
      ? 'LEAKED'
      : `${before.page.sections.length} section(s), ${before.page.contentMd.length} chars of markdown`,
    !JSON.stringify(before).includes(SECRET_SECTION_MARKER) &&
      !before.page.contentMd.includes(GM_SECTION_HEADING),
  );
  checks.record(
    '…while the public section is right there',
    'the street-level section present',
    before.page.contentMd.includes('What the street knows') ? 'present' : 'missing',
    before.page.contentMd.includes('What the street knows'),
  );
  const gmCopy = await gm.get<{ page: PageDto }>(`/api/wiki/${pageId}`);
  checks.record(
    '…and the GM sees the whole thing',
    'the secret paragraph present for the GM',
    gmCopy.page.contentMd.includes(SECRET_SECTION_MARKER) ? 'present' : 'missing',
    gmCopy.page.contentMd.includes(SECRET_SECTION_MARKER),
  );

  // The reveal (FR5.2): one section flips to shared, and the table is told.
  await gm.post(`/api/wiki/${pageId}/reveal`, { section: GM_SECTION_SLUG, visibility: 'public' });
  const revealFrame = await torque.live.next((f) => f.type === 'wiki.revealed');
  checks.eq(
    'revealing the section announces it to the table',
    GM_SECTION_SLUG,
    ((revealFrame.payload as Dict)['section'] as Dict | undefined)?.['id'],
  );
  const after = await torque.api.get<{ page: PageDto }>(`/api/wiki/${pageId}`);
  checks.record(
    '…and only then does the phone receive the words',
    'the secret paragraph now present for the player',
    after.page.contentMd.includes(SECRET_SECTION_MARKER) ? 'present' : 'still absent',
    after.page.contentMd.includes(SECRET_SECTION_MARKER),
  );
  const searchable = await gm.get<{ pages: Array<{ id: string }> }>(
    `/api/campaigns/${cid}/wiki?q=rusted`,
  );
  checks.record(
    'the page is findable in the codex',
    'the Rusted Halo page in a title/body search',
    searchable.pages.map((p) => p.id).includes(pageId) ? 'found' : 'missing',
    searchable.pages.some((p) => p.id === pageId),
  );

  // --- a contact, written from the phone that owns the sheet (FR5.8) -------
  const contact = await torque.api.post<{ contact: ContactDto }>(
    `/api/characters/${torque.characterId}/contacts`,
    {
      name: 'Mr. Pell',
      archetype: 'Johnson — corporate, freelance',
      connection: 4,
      loyalty: 2,
      notes: 'Pays on hand-over, never on promises. Eats nothing. Has not once said who is buying.',
      favours: { owed: 0, owing: 1 },
      npcPageId: pageId,
    },
  );
  const readBack = await torque.api.get<{ contacts: ContactDto[] }>(
    `/api/characters/${torque.characterId}/contacts`,
  );
  const pell = readBack.contacts.find((c) => c.name === 'Mr. Pell');
  checks.record(
    "the contact reads back on the sheet's own route",
    'Mr. Pell at Connection 4 / Loyalty 2, one favour owing',
    pell ? `${pell.name} C${pell.connection}/L${pell.loyalty} owing ${pell.favours.owing}` : 'missing',
    pell?.connection === 4 && pell.loyalty === 2 && pell.favours.owing === 1,
  );
  const nosy = await phones['Sparrow']!.api.status('GET', `/api/characters/${torque.characterId}/contacts`);
  checks.eq("…and another runner's phone cannot read it", 403, nosy);

  // --- the in-game calendar (FR5.7) ----------------------------------------
  await gm.post(`/api/campaigns/${cid}/calendar`, {
    date: '2076-06-13',
    title: 'Hand-over at the noodle counter',
    body: 'Mr. Pell pays the balance. He will not be alone.',
    kind: 'beat',
    visibility: 'gm',
  });
  const gmCalendar = await gm.get<{ entries: Array<{ title: string }> }>(`/api/campaigns/${cid}/calendar`);
  const playerCalendar = await torque.api.get<{ entries: Array<{ title: string }> }>(
    `/api/campaigns/${cid}/calendar`,
  );
  checks.record(
    'the GM pins a beat to the in-game calendar',
    'present on the GM calendar',
    gmCalendar.entries.some((e) => e.title.includes('Hand-over')) ? 'present' : 'missing',
    gmCalendar.entries.some((e) => e.title.includes('Hand-over')),
  );
  checks.record(
    "…and it is not on the players' calendar",
    'absent for a player',
    playerCalendar.entries.some((e) => e.title.includes('Hand-over')) ? 'leaked' : 'absent',
    !playerCalendar.entries.some((e) => e.title.includes('Hand-over')),
  );

  // --- the job itself (FR5.5) ----------------------------------------------
  const gmRuns = await gm.get<{ runs: Array<{ id: string; title: string; state: string }> }>(
    `/api/campaigns/${cid}/runs`,
  );
  const run = gmRuns.runs.find((r) => r.title === 'Static on the Line');
  if (!run) throw new Error('seed left no run row');
  const playerRuns = await torque.api.get<{ runs: Array<{ id: string }> }>(`/api/campaigns/${cid}/runs`);
  checks.record(
    'the run is on the GM screen with its brief',
    'one run, state prep',
    `${run.title} (${run.state})`,
    run.state === 'prep',
  );
  checks.record(
    '…and an unfinished job is not on a player list at all',
    'no runs for a player yet',
    `${playerRuns.runs.length} run(s)`,
    playerRuns.runs.length === 0,
  );
  const briefed = await gm.patch<{ run: { payout: { nuyen?: number; karma?: number }; objectives: unknown[] } }>(
    `/api/runs/${run.id}`,
    {
      hook: 'A crate labelled hydroponics, fragile, and eight thousand for whoever carries it out.',
      objectives: [
        { text: 'Recover the drone from Pier 23', state: 'open' },
        { text: 'Nobody on either side stops breathing', state: 'open' },
      ],
      payout: { nuyen: 8000, karma: 4, notes: '2,000¥ up front, the balance on hand-over.' },
      johnsonPageId: pageId,
      ingameDate: '2076-06-12',
    },
  );
  checks.record(
    '…so the GM writes the brief onto it',
    'two objectives and an 8,000¥ / 4 karma payout',
    `${briefed.run.objectives.length} objective(s) · ${String(briefed.run.payout.nuyen)}¥ / ${String(briefed.run.payout.karma)} karma`,
    briefed.run.objectives.length === 2 && briefed.run.payout.nuyen === 8000,
  );

  // --- FR5.6: the page and the archetype template point at each other -------
  // Before this, `npc_templates` and `wiki_pages` were two disconnected tables
  // describing the same gang: the page that says who the Rusted Halo are and
  // the template that says what one of them rolls. One column joins them, and
  // the link is GM-only in both directions — a location page shared with the
  // table must not leak the opposition waiting in it.
  const templates = await gm.get<{ templates: { id: string; name: string }[] }>(
    `/api/campaigns/${cid}/npc-templates`,
  );
  const halo = templates.templates.find((t) => t.name.includes('Rusted Halo'));
  if (!halo) throw new Error('seed left no Rusted Halo template');
  const linked = await gm.post<{ link: TemplateLink }>(`/api/wiki/${pageId}/templates`, {
    templateId: halo.id,
  });
  checks.record(
    'the archetype template is linked to the codex page that describes it (FR5.6)',
    'the template naming the page, with its role tags',
    `${linked.link.name} → page ${linked.link.wikiPageId === pageId ? 'matched' : 'MISMATCH'} · tags ${linked.link.roleTags.join(', ')}`,
    linked.link.wikiPageId === pageId && linked.link.roleTags.includes('ganger'),
  );
  const pageWithTemplates = await gm.get<{ page: PageDto & { templates?: TemplateLink[] } }>(
    `/api/wiki/${pageId}`,
  );
  checks.record(
    '…and the page resolves back to it, so the two are one graph',
    'the template listed on the page',
    (pageWithTemplates.page.templates ?? []).map((t) => t.name).join(', ') || 'none',
    (pageWithTemplates.page.templates ?? []).some((t) => t.templateId === halo.id),
  );
  const templateRow = await gm.get<{ template: { id: string; wikiPageId: string | null } }>(
    `/api/npc-templates/${halo.id}`,
  );
  checks.eq('…on the template row itself, not in a join table', pageId, templateRow.template.wikiPageId);
  const playerCopy = await torque.api.get<{ page: PageDto & { templates?: unknown } }>(
    `/api/wiki/${pageId}`,
  );
  checks.record(
    '…and a player’s copy of a shared page carries no opposition at all',
    'no templates key on the phone’s payload',
    playerCopy.page.templates === undefined ? 'absent' : 'LEAKED',
    playerCopy.page.templates === undefined,
  );

  const gmSawReveal = gmLive.frames.some((f) => f.type === 'wiki.revealed');
  checks.record(
    'every one of those writes is on the log the session replays from',
    'the reveal in the campaign event stream',
    gmSawReveal ? 'present' : 'missing',
    gmSawReveal,
  );

  story.say(
    'Before anyone sits down, the GM has written the gang up in the codex and shared the page with the table — ' +
      'all but one section of it. The phones fetch the page and the secret is not *hidden* on them, it is ' +
      'absent: the bytes never left the laptop. Later, when it stops mattering, one tap sends them.',
  );
  story.say(
    'Torque writes Mr. Pell into her contacts from her own phone — Connection 4, Loyalty 2, one favour owing — ' +
      'and Sparrow, three feet away, gets a flat 403 for asking to see it. The job is on the board with its ' +
      'objectives and its payout, and the hand-over is pinned to the thirteenth of June where only the GM can ' +
      'read it.',
  );

  story.say(
    'The gang page and the gang’s stat template stop being two unrelated rows: the archetype the generator ' +
      'rolls bodies from now names the codex page that says who they are, and the page lists it back. Only for ' +
      'the GM — the phones read the same page and are handed no opposition at all.',
  );

  return { haloPageId: pageId, runId: run.id, contactId: contact.contact.id, templateId: halo.id };
}
