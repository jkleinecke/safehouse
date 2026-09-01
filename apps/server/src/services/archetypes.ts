/**
 * Starter archetype library (M10 cold start — FR10.1, G9, §14/D10).
 *
 * THE HOLE THIS FILLS: `npc_templates` is per-campaign and starts empty, so a
 * GM who created their own campaign opened the NPC generator on an empty
 * dropdown. The module whose promise is "statted, party-appropriate opposition
 * in minutes instead of evenings" asked for an evening first.
 *
 * WHAT THIS IS NOT: a locked compendium. Installing writes ordinary
 * `npc_templates` rows owned by the campaign — editable, retierable,
 * renamable and deletable exactly like hand-authored ones (FR10.1). The
 * catalogue is a starting point; once a row exists the library never touches
 * it again.
 *
 * IDENTITY: installed rows carry `gen.starterId`, a stable id that survives a
 * rename. Matching on the name would re-offer an archetype the moment a GM
 * renamed their copy to suit their sprawl, and installing again would then
 * duplicate it.
 *
 * SECRECY: opposition prep is GM-only (Principle 4 / §13) and installing
 * announces nothing — no hub event, nothing for a player socket to see.
 */
import { eq } from 'drizzle-orm';
import type { GenTemplate } from '@safehouse/contracts';
import { STARTER_ARCHETYPES, type StarterArchetype } from '@safehouse/rules';
import { npcTemplates, type Db } from '@safehouse/db';

type NpcTemplateRow = typeof npcTemplates.$inferSelect;

/**
 * The catalogue's own shape lives in `@safehouse/rules` beside the content
 * (`id`, `name`, `summary`, `statblock`, `gen`, `persona`) — re-exported here
 * so the routes and the install path have one name for it.
 */
export type { StarterArchetype };

/** A catalogue row as the GM's library view sees it. */
export interface ArchetypeLibraryEntry {
  id: string;
  name: string;
  summary: string;
  roleTags: string[];
  tiers: Array<{ id: string; label: string }>;
  /** True when this campaign already owns a template stamped with `id`. */
  installed: boolean;
  /** The row that claims it, if any — so the UI can jump straight to it. */
  templateId: string | null;
  /** Its CURRENT name, which a GM is free to have changed. */
  installedAs: string | null;
}

export interface InstallOptions {
  /** Install only these catalogue ids; omitted installs the whole catalogue. */
  ids?: readonly string[] | undefined;
  /**
   * Auto-install guard: do nothing at all when the campaign already owns any
   * template. Used at campaign creation so the library never elbows its way
   * into a campaign whose GM has started authoring.
   */
  onlyWhenEmpty?: boolean | undefined;
}

export interface InstallResult {
  /** Rows created by THIS call (empty on a repeat — the operation is idempotent). */
  installed: NpcTemplateRow[];
  /** Catalogue ids that were already present and were left untouched. */
  alreadyInstalled: string[];
  /** True when `onlyWhenEmpty` held the whole call back. */
  heldBack: boolean;
  /** The library after the call, so a caller can render without a second round trip. */
  entries: ArchetypeLibraryEntry[];
}

// ---------------------------------------------------------------------------
// Catalogue source
// ---------------------------------------------------------------------------

let cached: readonly StarterArchetype[] | undefined;

/**
 * The installable catalogue, shipped by `@safehouse/rules` (original content —
 * §14/D10 forbids transcribing book stat blocks, not shipping our own, and the
 * generator's flavour tables are the same precedent).
 *
 * Deduplicated by id and memoized. The dedupe is not paranoia: two entries
 * sharing an id would make the second permanently uninstallable, because the
 * first one's row already answers for that id.
 */
export function starterCatalogue(): readonly StarterArchetype[] {
  if (cached) return cached;
  const seen = new Set<string>();
  cached = STARTER_ARCHETYPES.filter((archetype) => {
    if (!archetype.id || seen.has(archetype.id)) return false;
    seen.add(archetype.id);
    return true;
  });
  return cached;
}

/** Catalogue ids in `ids` that name nothing we ship. */
export function unknownStarterIds(ids: readonly string[]): string[] {
  const known = new Set(starterCatalogue().map((a) => a.id));
  return [...new Set(ids)].filter((id) => !known.has(id));
}

// ---------------------------------------------------------------------------
// The stable id on the row
// ---------------------------------------------------------------------------

/**
 * Read the starter id off a template's `gen` blob.
 *
 * It lives inside `gen` rather than in its own column because that needs no
 * migration and rides along with the params it describes. `GenTemplateSchema`
 * strips the key when the generator parses a row, so it never reaches the
 * engine — it is provenance for this file alone.
 */
export function starterIdOf(gen: unknown): string | null {
  if (!gen || typeof gen !== 'object' || Array.isArray(gen)) return null;
  const value = (gen as Record<string, unknown>)['starterId'];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** Stamp a catalogue entry's gen params with its id, ready to insert. */
export function stampStarterId(gen: GenTemplate, starterId: string): Record<string, unknown> {
  return { ...(gen as unknown as Record<string, unknown>), starterId };
}

/**
 * Carry the starter id across a GM edit of `gen`.
 *
 * The PATCH body validates through `GenTemplateSchema`, which strips unknown
 * keys — so without this, retuning a tier curve would erase the row's
 * provenance and the library would offer the archetype again as if it had
 * never been installed. Editing an installed template is expected (it is a
 * starting point); losing track of it is not.
 */
export function preserveStarterId(previousGen: unknown, nextGen: unknown): unknown {
  const starterId = starterIdOf(previousGen);
  if (!starterId) return nextGen;
  if (!nextGen || typeof nextGen !== 'object' || Array.isArray(nextGen)) return nextGen;
  if (starterIdOf(nextGen)) return nextGen;
  return { ...(nextGen as Record<string, unknown>), starterId };
}

// ---------------------------------------------------------------------------
// Library + install
// ---------------------------------------------------------------------------

interface CampaignTemplateRef {
  id: string;
  name: string;
  gen: unknown;
}

async function campaignTemplates(db: Db, campaignId: string): Promise<CampaignTemplateRef[]> {
  return db
    .select({ id: npcTemplates.id, name: npcTemplates.name, gen: npcTemplates.gen })
    .from(npcTemplates)
    .where(eq(npcTemplates.campaignId, campaignId));
}

/** starterId → the row that claims it (first wins; a manual copy is separate). */
function installedIndex(rows: readonly CampaignTemplateRef[]): Map<string, CampaignTemplateRef> {
  const index = new Map<string, CampaignTemplateRef>();
  for (const row of rows) {
    const starterId = starterIdOf(row.gen);
    if (starterId && !index.has(starterId)) index.set(starterId, row);
  }
  return index;
}

function toEntries(index: Map<string, CampaignTemplateRef>): ArchetypeLibraryEntry[] {
  return starterCatalogue().map((archetype) => {
    const row = index.get(archetype.id);
    return {
      id: archetype.id,
      name: archetype.name,
      summary: archetype.summary,
      roleTags: [...archetype.gen.roleTags],
      tiers: archetype.gen.tiers.map((t) => ({ id: t.id, label: t.label })),
      installed: Boolean(row),
      templateId: row?.id ?? null,
      installedAs: row?.name ?? null,
    };
  });
}

/** The catalogue as this campaign sees it, each entry marked installed or not. */
export async function archetypeLibrary(
  db: Db,
  campaignId: string,
): Promise<ArchetypeLibraryEntry[]> {
  return toEntries(installedIndex(await campaignTemplates(db, campaignId)));
}

/**
 * Install the catalogue (or a named subset) as real, editable templates.
 *
 * IDEMPOTENT: an archetype already stamped into this campaign is skipped, so
 * a double-click, a retry, or a GM who forgot they installed last week adds
 * nothing. Deleting the row genuinely uninstalls it — the entry goes back to
 * available and installing again brings it back.
 */
export async function installStarterArchetypes(
  db: Db,
  campaignId: string,
  opts: InstallOptions = {},
): Promise<InstallResult> {
  const existing = await campaignTemplates(db, campaignId);
  if (opts.onlyWhenEmpty && existing.length > 0) {
    return { installed: [], alreadyInstalled: [], heldBack: true, entries: toEntries(installedIndex(existing)) };
  }

  const index = installedIndex(existing);
  const wanted = opts.ids ? new Set(opts.ids) : null;
  const alreadyInstalled: string[] = [];
  const pending: StarterArchetype[] = [];
  for (const archetype of starterCatalogue()) {
    if (wanted && !wanted.has(archetype.id)) continue;
    if (index.has(archetype.id)) {
      alreadyInstalled.push(archetype.id);
      continue;
    }
    pending.push(archetype);
  }

  let installed: NpcTemplateRow[] = [];
  if (pending.length > 0) {
    installed = await db
      .insert(npcTemplates)
      .values(
        pending.map((archetype) => ({
          campaignId,
          name: archetype.name,
          statblock: archetype.statblock as Record<string, unknown>,
          gen: stampStarterId(archetype.gen, archetype.id),
          persona: archetype.persona as Record<string, unknown>,
        })),
      )
      .returning();
    for (const row of installed) {
      const starterId = starterIdOf(row.gen);
      if (starterId) index.set(starterId, { id: row.id, name: row.name, gen: row.gen });
    }
  }

  return { installed, alreadyInstalled, heldBack: false, entries: toEntries(index) };
}
