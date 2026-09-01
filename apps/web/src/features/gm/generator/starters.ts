/**
 * The starter archetype library — the generator's cold start.
 *
 * A GM who makes their own campaign opens the Opposition Kit with zero
 * archetypes. Everything M10 promises (statted, party-appropriate opposition
 * in minutes, G9/D10) is behind a form asking them to invent attribute curves
 * first. The library is the way out: a shipped set of ORIGINAL archetypes
 * (§14 forbids book stat blocks and book names, not starter content) that the
 * server copies into the campaign, after which they are ordinary GM data —
 * editable, deletable, forkable, exactly like a hand-authored one.
 *
 * The routes are the server's (`apps/server/src/plugins/generator.ts`):
 *   GET  /api/campaigns/:id/archetype-library
 *        → { entries, installedCount, availableCount }
 *   POST /api/campaigns/:id/archetype-library/install
 *        body { ids?: string[] }  (omit/empty = install everything)
 *        → { installed, alreadyInstalled, entries }
 *
 * The library is campaign-scoped rather than global because the interesting
 * half of an entry is whether THIS campaign already owns it: the server tracks
 * that by a `gen.starterId` stamp that survives a rename, which the browser
 * cannot reproduce. The readers below stay shape-tolerant anyway (the same
 * posture as `normalizeNpcResponse` in api.ts) — an envelope mismatch must
 * never reach a GM as "there is no library".
 */
import { useMutation, useQuery } from '@tanstack/react-query';
import type { NpcTemplate } from '@safehouse/contracts';
import { ApiError, apiGet, apiPost, queryClient } from '../../../api/client.js';

export const archetypeLibraryPath = (campaignId: string): string =>
  `/api/campaigns/${campaignId}/archetype-library`;
export const installStartersPath = (campaignId: string): string =>
  `${archetypeLibraryPath(campaignId)}/install`;

/** One entry in the shipped catalog, as the browser needs to render it. */
export interface StarterArchetype {
  /** Stable catalog key — what the install route takes in `ids`. */
  key: string;
  name: string;
  /** What this archetype is FOR at the table, in the GM's terms. */
  summary: string;
  roleTags: string[];
  /** The tier ladder, low to high, as labels the GM will see on the dial. */
  tiers: { id: string; label: string }[];
  /**
   * The server's own verdict, when it gives one: it matches on the `starterId`
   * stamped into the installed row's `gen`, so a GM who renamed their copy is
   * still correctly told they have it. `undefined` means the server did not
   * say and the name fallback in `installedStarterKeys` decides.
   */
  installed?: boolean;
  /** The campaign template that claims this entry, for "open in editor". */
  templateId?: string;
  /** That row's CURRENT name, which the GM is free to have changed. */
  installedAs?: string;
}

// --- shape tolerance --------------------------------------------------------

function rec(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : null;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() !== '' ? v : undefined;
}

function strList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

/** Slug fallback so an entry that forgot its key still installs by name. */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeTiers(v: unknown): { id: string; label: string }[] {
  if (!Array.isArray(v)) return [];
  const out: { id: string; label: string }[] = [];
  for (const raw of v) {
    if (typeof raw === 'string') {
      out.push({ id: slugify(raw) || raw, label: raw });
      continue;
    }
    const t = rec(raw);
    if (!t) continue;
    const id = str(t['id']) ?? slugify(str(t['label']) ?? '');
    const label = str(t['label']) ?? id;
    if (id || label) out.push({ id: id || slugify(label), label: label || id });
  }
  return out;
}

/** Read one catalog entry, flat or wrapped in an NpcTemplate-shaped `gen`. */
export function normalizeStarter(raw: unknown): StarterArchetype | null {
  const r = rec(raw);
  if (!r) return null;
  const name = str(r['name']);
  if (!name) return null;
  const gen = rec(r['gen']);
  const key = str(r['key']) ?? str(r['id']) ?? str(r['slug']) ?? slugify(name);
  const templateId = str(r['templateId']);
  return {
    key,
    name,
    summary:
      str(r['summary']) ??
      str(r['description']) ??
      str(r['blurb']) ??
      str(r['tagline']) ??
      '',
    roleTags: strList(r['roleTags'] ?? gen?.['roleTags']),
    tiers: normalizeTiers(r['tiers'] ?? gen?.['tiers']),
    // Only carried when the server actually stated it. Defaulting `installed`
    // to false here would silently overrule the name fallback on any build
    // that does not send the flag.
    ...(typeof r['installed'] === 'boolean' ? { installed: r['installed'] } : {}),
    ...(templateId !== undefined ? { templateId } : {}),
    ...(str(r['installedAs']) !== undefined ? { installedAs: str(r['installedAs'])! } : {}),
  };
}

function unwrap(raw: unknown, keys: readonly string[]): unknown[] {
  if (Array.isArray(raw)) return raw;
  const r = rec(raw);
  if (!r) return [];
  for (const k of keys) {
    if (Array.isArray(r[k])) return r[k] as unknown[];
  }
  const nested = rec(r['library']);
  if (nested) return unwrap(nested, keys);
  return [];
}

export function normalizeCatalog(raw: unknown): StarterArchetype[] {
  const out: StarterArchetype[] = [];
  const seen = new Set<string>();
  for (const entry of unwrap(raw, ['entries', 'archetypes', 'starters', 'templates', 'items'])) {
    const parsed = normalizeStarter(entry);
    if (!parsed || seen.has(parsed.key)) continue;
    seen.add(parsed.key);
    out.push(parsed);
  }
  return out;
}

export function normalizeInstalled(raw: unknown): NpcTemplate[] {
  return unwrap(raw, ['templates', 'installed', 'created', 'archetypes']).filter(
    (t): t is NpcTemplate => Boolean(rec(t)?.['name']),
  );
}

// --- selectors (pure) -------------------------------------------------------

const fold = (s: string): string => s.trim().toLowerCase();

/**
 * Which catalog entries this campaign already has.
 *
 * The server's `installed` flag wins whenever it is present: it matches on the
 * `starterId` stamped into the row's `gen`, so a GM who renamed their copy to
 * suit their sprawl is still told they own it. Name matching is only the
 * fallback for a build that does not send the flag — it is deliberately
 * lenient (a renamed copy reads as gone, and re-installing hands over a fresh
 * unmodified one) rather than wrong in the other direction.
 */
export function installedStarterKeys(
  catalog: readonly StarterArchetype[],
  templates: readonly { name: string }[] | undefined,
): Set<string> {
  const names = new Set((templates ?? []).map((t) => fold(t.name)));
  const out = new Set<string>();
  for (const a of catalog) {
    const known = a.installed ?? names.has(fold(a.name));
    if (known) out.add(a.key);
  }
  return out;
}

/** The ids "install all" should send: everything not already here. */
export function missingStarterKeys(
  catalog: readonly StarterArchetype[],
  templates: readonly { name: string }[] | undefined,
): string[] {
  const installed = installedStarterKeys(catalog, templates);
  return catalog.filter((a) => !installed.has(a.key)).map((a) => a.key);
}

/** 'Street → Seasoned → Pro' — the ladder, in one line, low to high. */
export function tierLadder(entry: Pick<StarterArchetype, 'tiers'>): string {
  return entry.tiers.map((t) => t.label).join(' → ');
}

/**
 * A server without the library route is not an error worth a red box — it is
 * an older build, and the GM still has "create my own".
 */
export function libraryUnavailable(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 404 || error.status === 501);
}

// --- hooks ------------------------------------------------------------------

/**
 * The catalog as this campaign sees it. Hydrated on mount like every other GM
 * list — never assembled from live events.
 *
 * Not `staleTime: Infinity`: the entries carry per-campaign installed state
 * now, so the cache has to be allowed to go stale and be invalidated by the
 * install below. `retry: false` keeps an older server's 404 from costing the
 * GM three round trips before the "author your own" fallback appears.
 */
export function useStarterLibrary(campaignId: string) {
  return useQuery({
    queryKey: ['campaign', campaignId, 'archetype-library'],
    queryFn: async () => normalizeCatalog(await apiGet<unknown>(archetypeLibraryPath(campaignId))),
    enabled: Boolean(campaignId),
    retry: false,
  });
}

export interface InstallStartersVars {
  /** Omit or leave empty to install the whole library. */
  keys?: readonly string[];
}

export function useInstallStarters(campaignId: string) {
  return useMutation({
    mutationFn: async (vars: InstallStartersVars = {}) =>
      normalizeInstalled(
        await apiPost<unknown>(installStartersPath(campaignId), {
          // The server names them `ids`. Installing is idempotent server-side,
          // so a stale selection re-sending an already-installed id is safe.
          ids: vars.keys && vars.keys.length > 0 ? [...vars.keys] : undefined,
        }),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['campaign', campaignId, 'npc-templates'] });
      // The library's own rows carry `installed` now, so they are stale too.
      void queryClient.invalidateQueries({
        queryKey: ['campaign', campaignId, 'archetype-library'],
      });
    },
  });
}
