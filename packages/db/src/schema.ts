/**
 * @safehouse/db — Drizzle schema. Tables exactly as DESIGN.md §9.2 (snake_case).
 * Relational where money/trust lives; JSONB where the shape is rich and evolving.
 */
import { sql } from 'drizzle-orm';
import {
  bigserial,
  boolean,
  customType,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/** Postgres tsvector, used for the generated FTS column on book_pages. */
export const tsvector = customType<{ data: string }>({
  dataType() {
    return 'tsvector';
  },
});

// ---------------------------------------------------------------------------
// Accounts, campaign, membership (M1)
// ---------------------------------------------------------------------------

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').unique(),
  discordId: text('discord_id'),
  displayName: text('display_name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const campaigns = pgTable('campaigns', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  gmUserId: uuid('gm_user_id')
    .notNull()
    .references(() => users.id),
  settings: jsonb('settings').notNull().default({}),
  ingameDate: text('ingame_date'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const memberships = pgTable(
  'memberships',
  {
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').$type<'gm' | 'player' | 'observer'>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.campaignId, t.userId] })],
);

// ---------------------------------------------------------------------------
// Characters (M3)
// ---------------------------------------------------------------------------

export const characters = pgTable(
  'characters',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    ownerUserId: uuid('owner_user_id').references(() => users.id),
    name: text('name').notNull(),
    status: text('status').notNull().default('active'),
    /** Live SheetV1 snapshot (contracts §9.3). */
    sheet: jsonb('sheet').notNull(),
    sheetVersion: integer('sheet_version').notNull().default(1),
    /** Raw Chummer import (.chum5 XML), kept verbatim. */
    chummerBlob: text('chummer_blob'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('characters_campaign_idx').on(t.campaignId)],
);

export const characterRevisions = pgTable(
  'character_revisions',
  {
    characterId: uuid('character_id')
      .notNull()
      .references(() => characters.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    sheet: jsonb('sheet').notNull(),
    cause: text('cause').notNull().default(''),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.characterId, t.seq] })],
);

export const ledgerEntries = pgTable(
  'ledger_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    characterId: uuid('character_id')
      .notNull()
      .references(() => characters.id, { onDelete: 'cascade' }),
    currency: text('currency').$type<'karma' | 'nuyen'>().notNull(),
    delta: integer('delta').notNull(),
    reason: text('reason').notNull().default(''),
    state: text('state').$type<'pending' | 'approved' | 'rejected'>().notNull().default('pending'),
    sessionId: uuid('session_id').references(() => gameSessions.id),
    runId: uuid('run_id').references(() => runs.id),
    createdBy: uuid('created_by').references(() => users.id),
    approvedBy: uuid('approved_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('ledger_entries_character_idx').on(t.characterId)],
);

export const contacts = pgTable('contacts', {
  id: uuid('id').primaryKey().defaultRandom(),
  characterId: uuid('character_id')
    .notNull()
    .references(() => characters.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  archetype: text('archetype').notNull().default(''),
  connection: integer('connection').notNull().default(1),
  loyalty: integer('loyalty').notNull().default(1),
  notes: text('notes').notNull().default(''),
  npcPageId: uuid('npc_page_id').references(() => wikiPages.id),
});

// ---------------------------------------------------------------------------
// Dice (M2)
// ---------------------------------------------------------------------------

export const rolls = pgTable(
  'rolls',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    sessionId: uuid('session_id').references(() => gameSessions.id),
    /** `{ characterId? } | { combatantId? } | { gm: true }` */
    actor: jsonb('actor').notNull(),
    kind: text('kind').notNull(),
    /** Full RollRequest incl. pool breakdown / provenance (G5). */
    request: jsonb('request').notNull(),
    faces: integer('faces').array().notNull(),
    hits: integer('hits').notNull(),
    ones: integer('ones').notNull(),
    glitch: text('glitch').$type<'none' | 'glitch' | 'critical'>().notNull().default('none'),
    limit: jsonb('limit'),
    limitedHits: integer('limited_hits'),
    edgeAction: text('edge_action'),
    opposedLink: uuid('opposed_link'),
    visibility: text('visibility').$type<'public' | 'gm' | 'gm_owner'>().notNull().default('public'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('rolls_campaign_created_idx').on(t.campaignId, t.createdAt)],
);

// ---------------------------------------------------------------------------
// Scenes, tokens, drawings (M8/M9)
// ---------------------------------------------------------------------------

export const scenes = pgTable(
  'scenes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    state: text('state').$type<'draft' | 'active' | 'archived'>().notNull().default('draft'),
    /** unit (m), size, offset. */
    grid: jsonb('grid').notNull().default({}),
    /** light / visibility / glare / wind per FR9.11. */
    environment: jsonb('environment').notNull().default({}),
    /** walls / zones / doors / pins. */
    geometry: jsonb('geometry').notNull().default({}),
    /** named regions + revealed set. */
    fog: jsonb('fog').notNull().default({}),
    audioRef: uuid('audio_ref'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('scenes_campaign_idx').on(t.campaignId)],
);

export const tokens = pgTable(
  'tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sceneId: uuid('scene_id')
      .notNull()
      .references(() => scenes.id, { onDelete: 'cascade' }),
    source: text('source').$type<'character' | 'combatant' | 'npc_template' | 'prop'>().notNull(),
    sourceId: uuid('source_id'),
    name: text('name').notNull(),
    /** Positions in grid units (§9.2). */
    x: doublePrecision('x').notNull().default(0),
    y: doublePrecision('y').notNull().default(0),
    size: doublePrecision('size').notNull().default(1),
    rotation: doublePrecision('rotation').notNull().default(0),
    artRef: uuid('art_ref'),
    hidden: boolean('hidden').notNull().default(false),
    barsVisibility: text('bars_visibility').notNull().default('public'),
    aura: jsonb('aura'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('tokens_scene_idx').on(t.sceneId)],
);

export const drawings = pgTable(
  'drawings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sceneId: uuid('scene_id')
      .notNull()
      .references(() => scenes.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<'sketch' | 'template'>().notNull(),
    geometry: jsonb('geometry').notNull(),
    createdBy: uuid('created_by').references(() => users.id),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('drawings_scene_idx').on(t.sceneId)],
);

// ---------------------------------------------------------------------------
// Combat (M4)
// ---------------------------------------------------------------------------

export const encounters = pgTable(
  'encounters',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    sceneId: uuid('scene_id').references(() => scenes.id),
    name: text('name').notNull(),
    state: text('state').$type<'prep' | 'live' | 'done'>().notNull().default('prep'),
    turn: integer('turn').notNull().default(0),
    pass: integer('pass').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('encounters_campaign_idx').on(t.campaignId)],
);

export const combatants = pgTable(
  'combatants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    encounterId: uuid('encounter_id')
      .notNull()
      .references(() => encounters.id, { onDelete: 'cascade' }),
    tokenId: uuid('token_id').references(() => tokens.id, { onDelete: 'set null' }),
    source: text('source').notNull().default('manual'),
    sourceId: uuid('source_id'),
    name: text('name').notNull(),
    initBase: integer('init_base').notNull().default(0),
    initScore: integer('init_score').notNull().default(0),
    initKind: text('init_kind').notNull().default('physical'),
    /** physical/stun/overflow boxes; grunt groups keep per-member ticks here. */
    monitors: jsonb('monitors').notNull().default({}),
    effects: jsonb('effects').notNull().default([]),
    visibility: text('visibility').$type<'public' | 'gm' | 'gm_owner'>().notNull().default('public'),
    actedThisPass: boolean('acted_this_pass').notNull().default(false),
    /** Quick-roll rack, morale state (copilot). */
    copilot: jsonb('copilot').notNull().default({}),
  },
  (t) => [index('combatants_encounter_idx').on(t.encounterId)],
);

// ---------------------------------------------------------------------------
// NPC generation (M10)
// ---------------------------------------------------------------------------

export const npcTemplates = pgTable(
  'npc_templates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    statblock: jsonb('statblock').notNull().default({}),
    /** role tags, tier curves, ranges, loadout slots (FR10.1). */
    gen: jsonb('gen').notNull().default({}),
    /** traits, voice, goals, secrets[], knowledge[] (FR12.5/12.6). */
    persona: jsonb('persona').notNull().default({}),
    /** `{ book, page }` ref — never book content. */
    pageRef: jsonb('page_ref'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('npc_templates_campaign_idx').on(t.campaignId)],
);

export const gruntGroups = pgTable('grunt_groups', {
  id: uuid('id').primaryKey().defaultRandom(),
  campaignId: uuid('campaign_id')
    .notNull()
    .references(() => campaigns.id, { onDelete: 'cascade' }),
  templateId: uuid('template_id')
    .notNull()
    .references(() => npcTemplates.id, { onDelete: 'cascade' }),
  size: integer('size').notNull().default(1),
  professionalRating: integer('professional_rating').notNull().default(0),
  groupEdge: integer('group_edge').notNull().default(0),
});

export const rollTables = pgTable('roll_tables', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** NULL for shipped defaults (original writing, FR2.11/FR10.2). */
  campaignId: uuid('campaign_id').references(() => campaigns.id, { onDelete: 'cascade' }),
  kind: text('kind').$type<'names' | 'quirks' | 'motivations' | 'custom'>().notNull(),
  title: text('title').notNull(),
  /** Weighted entries. */
  entries: jsonb('entries').notNull().default([]),
  visibility: text('visibility').$type<'public' | 'gm' | 'gm_owner'>().notNull().default('public'),
});

// ---------------------------------------------------------------------------
// Rules library (M11)
// ---------------------------------------------------------------------------

export const books = pgTable(
  'books',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** NULL = global library entry shared across campaigns. */
    campaignId: uuid('campaign_id').references(() => campaigns.id, { onDelete: 'cascade' }),
    /** Short code, e.g. 'SR5', 'RG'. */
    code: text('code').notNull(),
    title: text('title').notNull(),
    attachmentId: uuid('attachment_id').references(() => attachments.id),
    /** printed page + offset = PDF page. */
    pageOffset: integer('page_offset').notNull().default(0),
    shared: boolean('shared').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('books_code_idx').on(t.code)],
);

export const bookPages = pgTable(
  'book_pages',
  {
    bookId: uuid('book_id')
      .notNull()
      .references(() => books.id, { onDelete: 'cascade' }),
    printedPage: integer('printed_page').notNull(),
    text: text('text').notNull(),
    /**
     * GENERATED ALWAYS AS (to_tsvector('english', text)) STORED — created by
     * raw SQL in the checked-in migration; never insert into this column.
     */
    tsv: tsvector('tsv').generatedAlwaysAs(sql`to_tsvector('english', "text")`),
  },
  (t) => [
    primaryKey({ columns: [t.bookId, t.printedPage] }),
    index('book_pages_tsv_idx').using('gin', t.tsv),
  ],
);

// ---------------------------------------------------------------------------
// AI (M12)
// ---------------------------------------------------------------------------

export const aiConversations = pgTable('ai_conversations', {
  id: uuid('id').primaryKey().defaultRandom(),
  campaignId: uuid('campaign_id')
    .notNull()
    .references(() => campaigns.id, { onDelete: 'cascade' }),
  kind: text('kind').$type<'fixer' | 'npc'>().notNull(),
  npcRef: uuid('npc_ref'),
  messages: jsonb('messages').notNull().default([]),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const aiGenerations = pgTable('ai_generations', {
  id: uuid('id').primaryKey().defaultRandom(),
  campaignId: uuid('campaign_id')
    .notNull()
    .references(() => campaigns.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(),
  /** Entity ref this draft targets, e.g. `{ table: 'npc_templates', id }`. */
  target: jsonb('target'),
  prompt: text('prompt').notNull(),
  model: text('model'),
  output: jsonb('output').notNull().default({}),
  status: text('status').$type<'draft' | 'accepted' | 'rejected'>().notNull().default('draft'),
  /** Token usage — feeds the cost meter (FR12.15). */
  usage: jsonb('usage'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const audioTracks = pgTable('audio_tracks', {
  id: uuid('id').primaryKey().defaultRandom(),
  campaignId: uuid('campaign_id')
    .notNull()
    .references(() => campaigns.id, { onDelete: 'cascade' }),
  attachmentId: uuid('attachment_id')
    .notNull()
    .references(() => attachments.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  moodTags: text('mood_tags').array().notNull().default([]),
});

// ---------------------------------------------------------------------------
// Codex, runs, sessions (M5/M6)
// ---------------------------------------------------------------------------

export const wikiPages = pgTable(
  'wiki_pages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull().default('page'),
    title: text('title').notNull(),
    contentMd: text('content_md').notNull().default(''),
    /** Per-section visibility (FR5.1–5.3). */
    sections: jsonb('sections').notNull().default([]),
    tags: text('tags').array().notNull().default([]),
    visibility: text('visibility').$type<'public' | 'gm' | 'gm_owner'>().notNull().default('gm'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('wiki_pages_campaign_idx').on(t.campaignId)],
);

export const wikiRevisions = pgTable(
  'wiki_revisions',
  {
    wikiPageId: uuid('wiki_page_id')
      .notNull()
      .references(() => wikiPages.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    contentMd: text('content_md').notNull(),
    sections: jsonb('sections').notNull().default([]),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.wikiPageId, t.seq] })],
);

export const matrixHosts = pgTable('matrix_hosts', {
  id: uuid('id').primaryKey().defaultRandom(),
  campaignId: uuid('campaign_id')
    .notNull()
    .references(() => campaigns.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  rating: integer('rating').notNull().default(1),
  asdf: jsonb('asdf').notNull().default({}),
  icRoster: jsonb('ic_roster').notNull().default([]),
  notes: text('notes').notNull().default(''),
});

export const runs = pgTable('runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  campaignId: uuid('campaign_id')
    .notNull()
    .references(() => campaigns.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  johnsonPageId: uuid('johnson_page_id').references(() => wikiPages.id),
  state: text('state').notNull().default('prep'),
  payout: jsonb('payout').notNull().default({}),
  awards: jsonb('awards').notNull().default({}),
  recapMd: text('recap_md').notNull().default(''),
});

export const gameSessions = pgTable('game_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  campaignId: uuid('campaign_id')
    .notNull()
    .references(() => campaigns.id, { onDelete: 'cascade' }),
  date: date('date'),
  /** user ids present. */
  attendance: text('attendance').array().notNull().default([]),
  /** GM-only prep notes. */
  prepNotesMd: text('prep_notes_md').notNull().default(''),
  recapMd: text('recap_md').notNull().default(''),
  state: text('state').notNull().default('planned'),
});

// ---------------------------------------------------------------------------
// Files, events, auth
// ---------------------------------------------------------------------------

export const attachments = pgTable('attachments', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** NULL for global-library files (e.g. shared book PDFs). */
  campaignId: uuid('campaign_id').references(() => campaigns.id, { onDelete: 'cascade' }),
  kind: text('kind').$type<'map' | 'token' | 'handout' | 'portrait' | 'asset' | 'audio'>().notNull(),
  /** Path under DATA_DIR/files. */
  path: text('path').notNull(),
  mime: text('mime').notNull(),
  size: integer('size').notNull().default(0),
  visibility: text('visibility').$type<'public' | 'gm' | 'gm_owner'>().notNull().default('gm'),
  /** sharp-generated downscales for maps/tokens. */
  variants: jsonb('variants').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const wsEvents = pgTable(
  'ws_events',
  {
    /**
     * Global bigserial; monotonic per campaign because the server is the
     * single writer and ids only grow (§11 — replay via last_event_id).
     */
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    payload: jsonb('payload').notNull(),
    visibility: text('visibility').$type<'public' | 'gm' | 'gm_owner'>().notNull().default('public'),
    ownerUserId: uuid('owner_user_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('ws_events_campaign_id_idx').on(t.campaignId, t.id)],
);

export const devices = pgTable(
  'devices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    campaignId: uuid('campaign_id').references(() => campaigns.id, { onDelete: 'cascade' }),
    role: text('role').$type<'gm' | 'player' | 'observer' | 'display'>().notNull(),
    tokenHash: text('token_hash').notNull(),
    /** e.g. "Sam's phone", "table TV". */
    label: text('label').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('devices_token_hash_idx').on(t.tokenHash)],
);

export const invites = pgTable(
  'invites',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    /** The QR join code (`/join/:code`). */
    code: text('code').notNull(),
    role: text('role').$type<'gm' | 'player' | 'observer' | 'display'>().notNull().default('player'),
    createdBy: uuid('created_by').references(() => users.id),
    maxUses: integer('max_uses'),
    uses: integer('uses').notNull().default(0),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('invites_code_idx').on(t.code)],
);
