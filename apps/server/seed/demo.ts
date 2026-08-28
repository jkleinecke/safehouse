/**
 * `pnpm seed:demo` — "Static on the Line", the one-run demo campaign.
 *
 * Everything here is ORIGINAL FICTION (G6/§14): invented aliases, gangs, gear
 * names, districts and complications. No book text, no published stat blocks,
 * no CGL content. `{ book: 'SR5', page: n }` refs are page NUMBERS only, the
 * way a GM would cite their own shelf. Range bands and prices are ordinary
 * game math a GM types in, not transcriptions.
 *
 * It drives the app's own HTTP surface via `app.inject`, so every seeded row
 * goes through the same validation, revisioning and event emission as a GM
 * clicking through the UI — a seed that bypassed the API would be a lie about
 * whether the API works. Only three things go straight to the db: creating the
 * campaign (the bootstrap route refuses a second campaign without a token),
 * the `runs` row (no REST surface yet), and the wipe.
 *
 * IDEMPOTENT: every run deletes the campaign named "Static on the Line" —
 * cascading its scenes, sheets, tokens, templates, tables and devices — and
 * reseeds from scratch. Other campaigns are never touched.
 *
 * Usage:
 *   pnpm seed:demo                        # into DATA_DIR (default ./data)
 *   DATA_DIR=./tmp/demo pnpm seed:demo
 *   DATABASE_URL=postgres://… pnpm seed:demo
 *
 * See docs/demo/CAMPAIGN.md for the brief these numbers encode. The content
 * itself lives beside this file: `assets/runners.ts` (the three PCs),
 * `assets/opposition.ts` (the Rusted Halo + the lieutenant + the complications
 * table), `assets/pier23.ts` (the scene, its geometry and its map), and
 * `assets/png.ts` (the stdlib PNG writer that map is drawn with).
 */
import { mkdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { and, eq, inArray, notExists, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { attachments, campaigns, characters, memberships, runs, users, type Db } from '@safehouse/db';
import { buildApp } from '../src/app.js';
import { filesDir } from '../src/services/scenes.js';
import { DOCKLANDS_COMPLICATIONS, RATCHET_TEMPLATE, RUSTED_HALO_TEMPLATE } from './assets/opposition.js';
import {
  FOG_LOADING_DOCK,
  PIER23_DOORS,
  PIER23_ENVIRONMENT,
  PIER23_FOG_REGIONS,
  PIER23_GRID,
  PIER23_NOTES,
  PIER23_PINS,
  PIER23_WALLS,
  PIER23_ZONES,
  renderPier23Map,
} from './assets/pier23.js';
import { PARTY } from './assets/runners.js';

const CAMPAIGN_NAME = 'Static on the Line';
const INGAME_DATE = '2076-06-12';

/** The run itself (FR5.5). Awards post to ledgers when the GM confirms. */
const RUN = {
  title: CAMPAIGN_NAME,
  state: 'prep',
  payout: {
    currency: 'nuyen',
    total: 8000,
    upfront: 2000,
    onDelivery: 6000,
    terms: 'Split however the crew likes. Johnson pays on hand-over, not on promises.',
  },
  awards: { karma: 4, nuyen: 8000, note: 'Baseline: +1 karma if the drone leaves the pier unshot at.' },
  recapMd: '',
};

// ---------------------------------------------------------------------------
// HTTP plumbing
// ---------------------------------------------------------------------------

interface Injectable {
  inject(opts: {
    method: string;
    url: string;
    headers?: Record<string, string>;
    payload?: unknown;
  }): Promise<{ statusCode: number; body: string; json(): unknown }>;
}

async function call<T>(
  app: Injectable,
  method: string,
  url: string,
  opts: { token?: string; payload?: unknown; headers?: Record<string, string> } = {},
): Promise<T> {
  const res = await app.inject({
    method,
    url,
    headers: {
      'content-type': 'application/json',
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
      ...opts.headers,
    },
    ...(opts.payload !== undefined ? { payload: opts.payload } : {}),
  });
  if (res.statusCode >= 400) {
    throw new Error(`${method} ${url} → ${res.statusCode}: ${res.body.slice(0, 400)}`);
  }
  return res.json() as T;
}

const BOUNDARY = '----safehouseDemoSeed';

/** Minimal multipart body for POST /api/attachments (the map upload, FR9.2). */
function multipart(fields: Record<string, string>, file: Buffer, mime: string, filename: string): Buffer {
  const parts: Buffer[] = [];
  for (const [name, value] of Object.entries(fields)) {
    parts.push(
      Buffer.from(`--${BOUNDARY}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`),
    );
  }
  parts.push(
    Buffer.from(
      `--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
        `Content-Type: ${mime}\r\n\r\n`,
    ),
    file,
    Buffer.from(`\r\n--${BOUNDARY}--\r\n`),
  );
  return Buffer.concat(parts);
}

// ---------------------------------------------------------------------------
// Wipe (idempotency)
// ---------------------------------------------------------------------------

/**
 * Delete every campaign named `CAMPAIGN_NAME`, its uploaded files, and the
 * throwaway users the previous seed minted. FK cascades handle the rest;
 * users are only removed once nothing else references them.
 */
async function wipe(db: Db): Promise<number> {
  const doomed = await db.select({ id: campaigns.id }).from(campaigns).where(eq(campaigns.name, CAMPAIGN_NAME));
  if (doomed.length === 0) return 0;
  const ids = doomed.map((c) => c.id);

  const files = await db.select({ path: attachments.path }).from(attachments).where(inArray(attachments.campaignId, ids));
  const members = await db.select({ userId: memberships.userId }).from(memberships).where(inArray(memberships.campaignId, ids));

  await db.delete(campaigns).where(inArray(campaigns.id, ids));

  for (const f of files) {
    await unlink(join(filesDir(), f.path)).catch(() => undefined);
  }
  const userIds = [...new Set(members.map((m) => m.userId))];
  if (userIds.length > 0) {
    const unreferenced = sql<number>`1`;
    await db
      .delete(users)
      .where(
        and(
          inArray(users.id, userIds),
          notExists(db.select({ n: unreferenced }).from(memberships).where(eq(memberships.userId, users.id))),
          notExists(db.select({ n: unreferenced }).from(campaigns).where(eq(campaigns.gmUserId, users.id))),
          notExists(db.select({ n: unreferenced }).from(characters).where(eq(characters.ownerUserId, users.id))),
        ),
      )
      // Any surviving FK from a table this seed does not own just means the
      // throwaway user stays; the campaign itself is still gone.
      .catch(() => undefined);
  }
  return ids.length;
}

// ---------------------------------------------------------------------------
// Seeding
// ---------------------------------------------------------------------------

interface Joined {
  alias: string;
  code: string;
  token: string;
  userId: string;
}

async function seed(app: FastifyInstance): Promise<void> {
  const inj = app as unknown as Injectable;
  const wiped = await wipe(app.db);
  if (wiped > 0) console.log(`wiped         ${wiped} previous "${CAMPAIGN_NAME}" campaign(s)`);

  // The bootstrap route refuses a second campaign without a token, so the
  // seed calls the same service the route calls (FR1.1).
  const boot = await app.authService.createCampaign({
    name: CAMPAIGN_NAME,
    gmName: 'Demo GM',
    deviceLabel: "GM's laptop",
  });
  const gm = { token: boot.token };
  const campaignId = boot.campaignId;
  await call(inj, 'PATCH', `/api/campaigns/${campaignId}`, { ...gm, payload: { ingameDate: INGAME_DATE } });
  console.log(`campaign      ${campaignId}  "${CAMPAIGN_NAME}"  (${INGAME_DATE})`);

  // --- players: one invite, one device, one sheet each ---------------------
  const joined: Joined[] = [];
  const characterIds: Record<string, string> = {};
  for (const { sheet, blurb } of PARTY) {
    const alias = sheet.identity.alias;
    const invite = await call<{ code: string }>(inj, 'POST', `/api/campaigns/${campaignId}/invites`, {
      ...gm,
      payload: { role: 'player' },
    });
    const device = await call<{ token: string; user: { id: string } }>(
      inj,
      'GET',
      `/join/${invite.code}?name=${encodeURIComponent(alias)}&label=${encodeURIComponent(`${alias}'s phone`)}`,
    );
    joined.push({ alias, code: invite.code, token: device.token, userId: device.user.id });

    const created = await call<{ character: { id: string } }>(inj, 'POST', '/api/characters', {
      ...gm,
      payload: { campaignId, name: alias, ownerUserId: device.user.id, sheet },
    });
    characterIds[alias] = created.character.id;
    console.log(`character     ${created.character.id}  ${alias.padEnd(8)} ${blurb}`);
  }

  const pc = (alias: string): string => {
    const id = characterIds[alias];
    if (id === undefined) throw new Error(`no character seeded for ${alias}`);
    return id;
  };

  const tv = await call<{ code: string }>(inj, 'POST', `/api/campaigns/${campaignId}/invites`, {
    ...gm,
    payload: { role: 'display' },
  });

  // --- opposition ----------------------------------------------------------
  const halo = await call<{ template: { id: string } }>(inj, 'POST', `/api/campaigns/${campaignId}/npc-templates`, {
    ...gm,
    payload: RUSTED_HALO_TEMPLATE,
  });
  console.log(`npc template  ${halo.template.id}  ${RUSTED_HALO_TEMPLATE.name} (street / blooded / pro)`);

  const ratchet = await call<{ template: { id: string } }>(inj, 'POST', `/api/campaigns/${campaignId}/npc-templates`, {
    ...gm,
    payload: RATCHET_TEMPLATE,
  });
  console.log(`npc (persona) ${ratchet.template.id}  ${RATCHET_TEMPLATE.name}`);

  const table = await call<{ table: { id: string } }>(inj, 'POST', `/api/campaigns/${campaignId}/roll-tables`, {
    ...gm,
    payload: DOCKLANDS_COMPLICATIONS,
  });
  console.log(`roll table    ${table.table.id}  ${DOCKLANDS_COMPLICATIONS.title} (${DOCKLANDS_COMPLICATIONS.entries.length} entries)`);

  // --- the scene: map, geometry, fog, tokens -------------------------------
  const { scene } = await call<{ scene: { id: string } }>(inj, 'POST', `/api/campaigns/${campaignId}/scenes`, {
    ...gm,
    payload: {
      name: 'Pier 23 Warehouse',
      grid: PIER23_GRID,
      environment: PIER23_ENVIRONMENT,
      geometry: { walls: PIER23_WALLS, doors: PIER23_DOORS, zones: PIER23_ZONES, pins: PIER23_PINS },
      notes: PIER23_NOTES,
    },
  });

  const png = renderPier23Map();
  const uploaded = await call<{ attachment: { id: string } }>(inj, 'POST', '/api/attachments', {
    ...gm,
    headers: { 'content-type': `multipart/form-data; boundary=${BOUNDARY}` },
    payload: multipart(
      { kind: 'map', visibility: 'public', campaign: campaignId },
      png,
      'image/png',
      'pier23.png',
    ),
  });
  await call(inj, 'PATCH', `/api/scenes/${scene.id}`, {
    ...gm,
    payload: { mapAttachmentIds: [uploaded.attachment.id] },
  });
  console.log(
    `scene         ${scene.id}  Pier 23 Warehouse  ${PIER23_GRID.cols}×${PIER23_GRID.rows} m @ ${PIER23_GRID.unitM} m` +
      `  · map ${(png.byteLength / 1024).toFixed(1)} KiB (${uploaded.attachment.id})`,
  );

  for (const region of PIER23_FOG_REGIONS) {
    await call(inj, 'POST', `/api/scenes/${scene.id}/fog`, { ...gm, payload: { op: 'define', region } });
  }
  await call(inj, 'POST', `/api/scenes/${scene.id}/fog`, {
    ...gm,
    payload: { op: 'reveal', regionId: FOG_LOADING_DOCK, announce: true },
  });
  console.log(
    `fog           ${PIER23_FOG_REGIONS.map((r) => r.name).join(' / ')}  — revealed: Loading Dock`,
  );

  const placements: Array<{
    name: string;
    x: number;
    y: number;
    source: 'character' | 'npc_template';
    sourceId: string;
    hidden: boolean;
    barsVisibility: 'gm' | 'owner' | 'public';
  }> = [
    { name: 'Torque', x: 3, y: 9, source: 'character', sourceId: pc('Torque'), hidden: false, barsVisibility: 'owner' },
    { name: 'Whisper', x: 2, y: 11, source: 'character', sourceId: pc('Whisper'), hidden: false, barsVisibility: 'owner' },
    { name: 'Sparrow', x: 4, y: 7, source: 'character', sourceId: pc('Sparrow'), hidden: false, barsVisibility: 'owner' },
    { name: 'Halo ganger — west aisle', x: 12, y: 6, source: 'npc_template', sourceId: halo.template.id, hidden: true, barsVisibility: 'gm' },
    { name: 'Halo ganger — pallet rows', x: 19, y: 15, source: 'npc_template', sourceId: halo.template.id, hidden: true, barsVisibility: 'gm' },
    { name: 'Halo ganger — office door', x: 23, y: 16, source: 'npc_template', sourceId: halo.template.id, hidden: true, barsVisibility: 'gm' },
    { name: 'Halo ganger — catwalk, east', x: 26, y: 1.5, source: 'npc_template', sourceId: halo.template.id, hidden: true, barsVisibility: 'gm' },
    { name: 'Ratchet — catwalk', x: 17, y: 1.5, source: 'npc_template', sourceId: ratchet.template.id, hidden: true, barsVisibility: 'gm' },
  ];
  for (const t of placements) {
    await call(inj, 'POST', `/api/scenes/${scene.id}/tokens`, { ...gm, payload: t });
  }
  console.log(
    `tokens        ${placements.filter((t) => !t.hidden).length} visible (Loading Dock)` +
      `, ${placements.filter((t) => t.hidden).length} hidden (Main Floor / Catwalk)`,
  );

  await call(inj, 'POST', `/api/scenes/${scene.id}/activate`, { ...gm, payload: {} });

  // --- the run row (FR5.5) + a planned session -----------------------------
  const run = (await app.db.insert(runs).values({ campaignId, ...RUN }).returning())[0];
  console.log(`run           ${run?.id ?? '?'}  "${RUN.title}"  ${RUN.payout.total}¥ + ${RUN.awards.karma} karma`);

  const session = await call<{ session: { id: string } }>(inj, 'POST', `/api/campaigns/${campaignId}/sessions`, {
    ...gm,
    payload: {
      date: INGAME_DATE,
      prepNotesMd: [
        '## Beat 1 — the meet',
        'A closed noodle counter under the skyway. Johnson calls himself Mr. Pell, pays for everyone, eats nothing.',
        'Ask 8,000¥. He opens at 6,000¥ and 2,000¥ up front. He will not say who the buyer is.',
        '',
        '## Beat 2 — the infiltration',
        'Pier 23. Fog opens on the Loading Dock. Reveal Main Floor when the freight door moves, Catwalk when someone looks up.',
        'Dim light is −1 on anything that needs eyes. The rota is on Ratchet’s persona sheet.',
        '',
        '## Beat 3 — the extraction',
        'Roll *Docklands complications* the moment the crate moves. Build the opposition from the Rusted Halo template at **blooded**, plus Ratchet.',
        'Payout on hand-over: 6,000¥ balance, 4 karma, +1 if nobody on either side stops breathing.',
      ].join('\n'),
    },
  });
  console.log(`session       ${session.session.id}  (planned, ${INGAME_DATE})`);

  // --- prove the sheets are engine-valid -----------------------------------
  console.log('\nDerived (server-side, with provenance):');
  for (const { sheet } of PARTY) {
    const id = characterIds[sheet.identity.alias];
    if (!id) continue;
    const d = await call<{
      derived: {
        initiative: { physical: { base: { value: number }; dice: { value: number } } };
        limits: { physical: { value: number } };
        pools: Record<string, { total: number }>;
      };
    }>(inj, 'GET', `/api/characters/${id}/derived`, gm);
    const init = d.derived.initiative.physical;
    console.log(
      `  ${sheet.identity.alias.padEnd(8)} init ${init.base.value}+${init.dice.value}d6` +
        `  phys limit ${d.derived.limits.physical.value}` +
        `  defence ${d.derived.pools['defense']?.total ?? '?'}` +
        `  soak ${d.derived.pools['soak']?.total ?? '?'}`,
    );
  }

  console.log('\nJoin codes — open the app and scan or type these:');
  for (const j of joined) console.log(`  player   ${j.alias.padEnd(8)} ${j.code}`);
  console.log(`  display  ${'TV'.padEnd(8)} ${tv.code}`);
  console.log('\nDevice tokens (already joined — paste straight into a browser session):');
  console.log(`  gm       ${'Demo GM'.padEnd(8)} ${boot.token}`);
  for (const j of joined) console.log(`  player   ${j.alias.padEnd(8)} ${j.token}`);
  console.log('');
}

// INTEGRATION: getDb() opens PGlite at `DATA_DIR/pglite` but does not create
// the parent directory, so a fresh clone (where `data/` is gitignored and
// absent) fails inside migrate() with ENOENT. Created here so `pnpm seed:demo`
// is the first thing that works after a checkout.
await mkdir(process.env.DATA_DIR ?? './data', { recursive: true });

const app = await buildApp({ webDist: false, logger: false });
try {
  await seed(app);
  console.log('seed:demo complete');
} catch (err) {
  console.error(`seed:demo failed — ${(err as Error).message}`);
  await app.close();
  process.exit(1);
}
await app.close();
process.exit(0);
