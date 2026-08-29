/**
 * The world one E2E run plays in, arranged over the app's own HTTP surface
 * before any browser opens.
 *
 * Split out of `harness.ts` so that file stays about PROCESSES — building the
 * SPA, running the seeders, starting the server — and this one stays about
 * STATE. They change for different reasons: a new spec usually needs another
 * fact in the world, not another child process.
 *
 * Everything here goes through real routes with real tokens, so the world a
 * spec inherits is one the app could have reached on a Friday night. Nothing
 * writes to the database directly and nothing is stubbed.
 */
import type { Api, DerivedPool, JoinAnswer, PersistedRoll } from './api';
import { REF_PROSE, type DeviceSession, type World } from './world';

/**
 * Pages in the manufactured book. Printed 426 + the core book's measured +5
 * offset is PDF page 431, so the file has to be at least that long or the
 * reader legitimately clamps to the back cover and the spec would be asserting
 * the clamp instead of the offset.
 */
export const BOOK_PAGES = 440;
/** The printed page the reader spec opens — the one DESIGN.md §0.3 measured. */
export const BOOK_PRINTED_PAGE = 426;

/** Distinctive strings the secrecy spec looks for. Never book content. */
export const GM_ONLY_LOG_TEXT =
  'GM-ONLY-E2E: the second courier is already inside and nobody has seen him.';
export const PUBLIC_LOG_TEXT = 'PUBLIC-E2E: the freight door grinds half open.';
// ---------------------------------------------------------------------------
// Arrangement — a table mid-session, before any browser opens
// ---------------------------------------------------------------------------

interface CharacterRow {
  id: string;
  name: string;
  ownerUserId?: string | null;
}
interface SceneRow {
  id: string;
  name: string;
  environment?: { light?: number };
}
interface TokenRow {
  id: string;
  name: string;
  hidden?: boolean;
}
interface CombatantRow {
  id: string;
  name: string;
  visibility?: string;
}
interface TemplateRow {
  id: string;
  name: string;
  gen?: { tiers?: { id: string }[] };
}

/** Book title the registry carries once `arrange` has relabelled the fixture. */
export const BOOK_TITLE = 'E2E stand-in for the core rulebook';

export async function arrange(
  api: Api,
  campaignId: string,
  gmToken: string,
  book: { code: string; pages: number; bytes: number },
): Promise<World> {
  const gm: DeviceSession = { token: gmToken, role: 'gm', campaignId };

  const campaign = await api.get<{ name: string; activeSceneId?: string | null }>(
    `/api/campaigns/${campaignId}`,
    gmToken,
  );
  const { characters } = await api.get<{ characters: CharacterRow[] }>(
    `/api/campaigns/${campaignId}/characters`,
    gmToken,
  );
  const byAlias: Record<string, string> = {};
  for (const c of characters) byAlias[c.name] = c.id;

  const playerAlias = 'Whisper';
  const playerCharacterId = byAlias[playerAlias];
  if (!playerCharacterId) {
    throw new Error(`e2e: the demo seed has no character named ${playerAlias}`);
  }

  // --- a player device that actually OWNS a sheet --------------------------
  // Invites are not character-bound (a join mints a fresh user), so the E2E
  // player is joined over REST and then handed the sheet by the GM — the same
  // `PATCH /api/characters/:id/owner` a GM taps when a phone scans in.
  const playerInvite = await api.post<{ code: string }>(
    `/api/campaigns/${campaignId}/invites`,
    { role: 'player' },
    gmToken,
  );
  const joined = await api.get<JoinAnswer>(
    `/api/join/${playerInvite.code}?name=${encodeURIComponent(playerAlias)}&label=E2E%20phone`,
  );
  await api.patch(
    `/api/characters/${playerCharacterId}/owner`,
    { ownerUserId: joined.user?.id },
    gmToken,
  );
  const player: DeviceSession = { token: joined.token, role: 'player', campaignId };

  // Codes the browser specs redeem themselves (unlimited uses, 24 h).
  const displayInvite = await api.post<{ code: string }>(
    `/api/campaigns/${campaignId}/invites`,
    { role: 'display' },
    gmToken,
  );
  const spectatorInvite = await api.post<{ code: string }>(
    `/api/campaigns/${campaignId}/invites`,
    { role: 'player' },
    gmToken,
  );

  // --- the session is live (FR6.2) -----------------------------------------
  await api.post(`/api/campaigns/${campaignId}/sessions/start`, {}, gmToken);

  // --- the scene, its hidden tokens, and a fight staged from it ------------
  const sceneId = campaign.activeSceneId;
  if (!sceneId) throw new Error('e2e: the demo seed left no active scene');
  const scene = await api.get<{ scene: SceneRow; tokens: TokenRow[] }>(
    `/api/scenes/${sceneId}`,
    gmToken,
  );
  const hiddenTokenNames = scene.tokens.filter((t) => t.hidden).map((t) => t.name);
  if (hiddenTokenNames.length === 0) {
    throw new Error('e2e: the demo scene has no hidden tokens — the secrecy spec would be vacuous');
  }

  // --- the fight: generated opposition first, then the scene staged into it -
  //
  // Order matters, and the reason is FR10.10. A tactical hint needs a combatant
  // that came out of the GENERATOR — the line is looked up from the archetype
  // template's `roleTags`, and only `POST /api/encounters/build` writes
  // `copilot.generator.templateId`. Staging a scene's tokens does not, and no
  // route can add it to a hand-made row.
  //
  // So the fight is built first (one generated ganger, no scene: passing a
  // sceneId here would stage a hidden token whose randomly-generated name the
  // secrecy spec would then have to treat as a secret), and the scene's tokens
  // are merged into that same encounter afterwards. One live fight, exactly as
  // before, that happens to contain a row the copilot can advise on.
  const templates = await api.get<{ templates: TemplateRow[] }>(
    `/api/campaigns/${campaignId}/npc-templates`,
    gmToken,
  );
  const ganger = templates.templates.find((t) => /ganger/i.test(t.name));
  const tierId = ganger?.gen?.tiers?.[0]?.id;
  if (!ganger || !tierId) {
    throw new Error('e2e: the demo seed has no tiered ganger archetype to generate from');
  }
  const built = await api.post<{
    encounter: { id: string };
    combatants: CombatantRow[];
  }>(
    '/api/encounters/build',
    {
      campaignId,
      sceneId: null,
      name: 'Pier 23 — the freight door',
      parts: [{ kind: 'npc', templateId: ganger.id, tierId, count: 1, seed: 20_760_612 }],
    },
    gmToken,
  );
  const hintRow = built.combatants[0];
  if (!hintRow) throw new Error('e2e: the encounter builder returned no combatants');

  const staged = await api.post<{ encounterId: string; combatantIds: string[] }>(
    `/api/scenes/${sceneId}/stage-encounter`,
    { name: 'Pier 23 — the freight door', encounterId: built.encounter.id },
    gmToken,
  );
  await api.patch(`/api/encounters/${staged.encounterId}`, { state: 'live' }, gmToken);
  await api.post(`/api/encounters/${staged.encounterId}/roll-initiative`, {}, gmToken);
  // The generated row is deterministically the one that is UP: FR10.10 puts a
  // hint on the acting NPC's turn and nowhere else, so a spec that waited for
  // the dice to hand it the right actor would be a coin toss. Its visibility is
  // `gm`, so a player's tracker has neither the row nor an acting id at all.
  await api.post(`/api/combatants/${hintRow.id}/initiative`, { score: 99 }, gmToken);
  const encounter = await api.get<{
    encounter?: { name?: string };
    name?: string;
    combatants: CombatantRow[];
  }>(`/api/encounters/${staged.encounterId}`, gmToken);
  const publicCombatants = (
    await api.get<{ combatants: CombatantRow[] }>(
      `/api/encounters/${staged.encounterId}`,
      player.token,
    )
  ).combatants.map((c) => c.name);

  // --- one roll already on the record, before any page mounts (LIVE-1) -----
  const derived = await api.get<{ derived: { pools: Record<string, DerivedPool> } }>(
    `/api/characters/${playerCharacterId}/derived`,
    player.token,
  );
  const perception = derived.derived.pools['skill.perception'];
  if (!perception) throw new Error(`e2e: ${playerAlias} has no perception pool`);

  const { roll } = await api.post<{ roll: PersistedRoll }>(
    '/api/rolls',
    {
      kind: 'simple',
      pool: perception.total,
      breakdown: perception.breakdown,
      ...(perception.limit ? { limit: perception.limit } : {}),
      edge: null,
      visibility: 'public',
      actor: { characterId: playerCharacterId },
      meta: { poolRef: 'skill.perception', title: 'perception', label: 'perception' },
    },
    player.token,
  );

  // --- two log lines: one the table shares, one only the GM may ever see ---
  await api.post(
    `/api/campaigns/${campaignId}/log`,
    { kind: 'marker', text: PUBLIC_LOG_TEXT, visibility: 'public' },
    gmToken,
  );
  await api.post(
    `/api/campaigns/${campaignId}/log`,
    { kind: 'marker', text: GM_ONLY_LOG_TEXT, visibility: 'gm' },
    gmToken,
  );

  // --- the library, and a page with a ref chip on it (M11) -----------------
  //
  // `seedBook` already registered the file with the code and offset the seeder
  // guesses from the filename; the title is rewritten here so no screenshot of
  // this run can be read as the real book. The offset is then read back rather
  // than assumed, because the whole reader spec is an assertion about it.
  const registry = await api.get<{ books: { id: string; code: string }[] }>(
    '/api/books',
    gmToken,
  );
  const bookRow = registry.books.find((b) => b.code === book.code);
  if (!bookRow) throw new Error(`e2e: seed:books registered no ${book.code}`);
  await api.patch(`/api/books/${bookRow.id}`, { title: BOOK_TITLE }, gmToken);
  const mapping = await api.get<{ pageOffset: number; pdfPage: number; title: string }>(
    `/read/${book.code}?p=${BOOK_PRINTED_PAGE}&format=json`,
    gmToken,
  );

  // A shared codex page whose prose carries `SR5 p.426`. FR11.4 autolinks it
  // into the same chip the sheet uses, so the reader spec taps a ref the way a
  // player does mid-session rather than typing a URL.
  const refPageTitle = 'Grenades, and the argument about scatter';
  const refPage = await api.post<{ page: { id: string } }>(
    `/api/campaigns/${campaignId}/wiki`,
    {
      kind: 'lore',
      title: refPageTitle,
      visibility: 'public',
      contentMd:
        'Every time somebody throws one we stop and look it up. The scatter helper is in the app now, ' +
        `${REF_PROSE} ${book.code} p.${BOOK_PRINTED_PAGE}.`,
    },
    gmToken,
  );

  return {
    baseUrl: api.baseUrl,
    campaignId,
    campaignName: campaign.name,
    gm,
    player,
    playerAlias,
    playerCharacterId,
    characters: byAlias,
    sceneId,
    sceneName: scene.scene.name,
    sceneLight: scene.scene.environment?.light ?? 0,
    encounterId: staged.encounterId,
    encounterName: encounter.encounter?.name ?? encounter.name ?? 'encounter',
    stagedCombatants: staged.combatantIds.length,
    publicCombatants,
    hiddenTokenNames,
    gmOnlyLogText: GM_ONLY_LOG_TEXT,
    publicLogText: PUBLIC_LOG_TEXT,
    seededRoll: {
      id: roll.id,
      pool: roll.request.pool,
      label: 'perception',
      actorName: playerAlias,
    },
    book: {
      code: book.code,
      title: mapping.title,
      printedPage: BOOK_PRINTED_PAGE,
      pdfPage: mapping.pdfPage,
      pageOffset: mapping.pageOffset,
      pageCount: book.pages,
      bytes: book.bytes,
      refPageId: refPage.page.id,
      refPageTitle,
    },
    hint: { combatantId: hintRow.id, name: hintRow.name },
    codes: { display: displayInvite.code, player: spectatorInvite.code },
  };
}
