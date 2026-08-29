/**
 * Pure helpers for the codex screens (M5 — FR5.1–5.8).
 *
 * The server already filters by kind, tag and term (and it is the only thing
 * allowed to decide what a viewer may read — Principle 4). These helpers do the
 * *presentation* arithmetic: tag clouds, objective progress, calendar grouping,
 * the little "in 3 days" the GM actually reads. No DOM, no network.
 */
import type { Visibility } from '@safehouse/contracts';

// ---------------------------------------------------------------------------
// Pages (FR5.1)
// ---------------------------------------------------------------------------

/** The typed kinds the server accepts (`WIKI_KINDS`, minus the Fixer's `page`). */
export const PAGE_KINDS = ['npc', 'faction', 'location', 'run', 'item', 'lore'] as const;
export type PageKind = (typeof PAGE_KINDS)[number];

export interface PageListItem {
  id: string;
  kind: string;
  title: string;
  tags: string[];
  visibility: Visibility;
  updatedAt: string;
  /** GM-only count of sections players cannot see. */
  gmOnlySections?: number;
}

export interface PageFilter {
  kind?: string | null;
  tag?: string | null;
  q?: string;
}

/**
 * Client-side narrowing of an already-filtered list — it keeps typing in the
 * search box instant, and never widens what the server sent.
 */
export function filterPages<T extends PageListItem>(pages: T[], filter: PageFilter): T[] {
  const term = (filter.q ?? '').trim().toLowerCase();
  const tag = filter.tag?.toLowerCase() ?? null;
  return pages.filter((p) => {
    if (filter.kind && p.kind !== filter.kind) return false;
    if (tag && !p.tags.some((t) => t.toLowerCase() === tag)) return false;
    if (!term) return true;
    return p.title.toLowerCase().includes(term) || p.tags.some((t) => t.toLowerCase().includes(term));
  });
}

/** Tags across a page list, most-used first then alphabetical. */
export function collectTags(pages: PageListItem[]): Array<{ tag: string; count: number }> {
  const counts = new Map<string, { tag: string; count: number }>();
  for (const page of pages) {
    for (const raw of page.tags) {
      const key = raw.toLowerCase();
      const hit = counts.get(key);
      if (hit) hit.count += 1;
      else counts.set(key, { tag: raw, count: 1 });
    }
  }
  return [...counts.values()].sort((a, b) =>
    b.count === a.count ? a.tag.localeCompare(b.tag) : b.count - a.count,
  );
}

/** Kinds actually present, in the canonical order, for the filter row. */
export function presentKinds(pages: PageListItem[]): string[] {
  const seen = new Set(pages.map((p) => p.kind));
  const known = PAGE_KINDS.filter((k) => seen.has(k));
  const extra = [...seen].filter((k) => !(PAGE_KINDS as readonly string[]).includes(k)).sort();
  return [...known, ...extra];
}

export function visibilityLabel(v: Visibility): string {
  if (v === 'public') return 'shared';
  if (v === 'gm_owner') return 'per player';
  return 'GM only';
}

/** Theme class for a visibility badge (shared = calm, secret = loud). */
export function visibilityTone(v: Visibility): string {
  if (v === 'public') return 'border-ok/40 text-ok';
  if (v === 'gm_owner') return 'border-warn/40 text-warn';
  return 'border-magenta-dim text-magenta';
}

// ---------------------------------------------------------------------------
// Section visibility (FR5.2) — the page-reveal trap
// ---------------------------------------------------------------------------

export interface SectionVisibility {
  id: string;
  heading: string;
  visibility: Visibility;
  audience?: string[];
  /** False when the section is only hidden because the whole page is. */
  explicit: boolean;
}

export interface SectionPatch {
  id: string;
  heading: string;
  visibility: Visibility;
  audience?: string[];
}

/**
 * Sections a page-level reveal would drag into the light.
 *
 * A section with no explicit setting inherits the page. While the page is
 * GM-only that reads as "hidden", so a GM never marks it — and then flipping
 * the page to shared publishes the Johnson's real employer along with the
 * cover story. These are exactly those sections.
 */
export function inheritedSecrets(sections: SectionVisibility[]): SectionVisibility[] {
  return sections.filter((s) => !s.explicit && s.visibility !== 'public');
}

/**
 * The `sections` list to PATCH immediately before revealing a page, so every
 * section keeps the visibility it has right now. Already-explicit entries ride
 * along because the PATCH replaces the whole list.
 *
 * Returns null when nothing needs pinning — no write, no revision churn.
 */
export function pinSectionsForReveal(sections: SectionVisibility[]): SectionPatch[] | null {
  const secrets = inheritedSecrets(sections);
  if (secrets.length === 0) return null;
  const toPatch = (s: SectionVisibility): SectionPatch => ({
    id: s.id,
    heading: s.heading,
    visibility: s.visibility,
    ...(s.audience && s.audience.length > 0 ? { audience: s.audience } : {}),
  });
  return [...sections.filter((s) => s.explicit).map(toPatch), ...secrets.map(toPatch)];
}

// ---------------------------------------------------------------------------
// Runs (FR5.5)
// ---------------------------------------------------------------------------

export interface Objective {
  id: string;
  text: string;
  state: string;
}

export interface RunProgress {
  total: number;
  done: number;
  failed: number;
  open: number;
  /** 0–100, of the objectives that are settled either way. */
  pct: number;
}

export function runProgress(objectives: Objective[]): RunProgress {
  const total = objectives.length;
  const done = objectives.filter((o) => o.state === 'done').length;
  const failed = objectives.filter((o) => o.state === 'failed').length;
  return {
    total,
    done,
    failed,
    open: total - done - failed,
    pct: total === 0 ? 0 : Math.round(((done + failed) / total) * 100),
  };
}

/** `12000¥ · 6 karma` — blank when a run has no agreed payout yet. */
export function payoutSummary(payout: { nuyen?: number; karma?: number }): string {
  const parts: string[] = [];
  if (typeof payout.nuyen === 'number' && payout.nuyen !== 0) {
    parts.push(`${payout.nuyen.toLocaleString('en-US')}¥`);
  }
  if (typeof payout.karma === 'number' && payout.karma !== 0) {
    parts.push(`${payout.karma} karma`);
  }
  return parts.join(' · ');
}

/** Cycle an objective through open → done → failed → open (one tap each). */
export function nextObjectiveState(state: string): 'open' | 'done' | 'failed' {
  if (state === 'open') return 'done';
  if (state === 'done') return 'failed';
  return 'open';
}

// ---------------------------------------------------------------------------
// Calendar (FR5.7)
// ---------------------------------------------------------------------------

export interface CalendarEntry {
  id: string;
  kind: string;
  date: string;
  dateKind: 'ingame' | 'real';
  title: string;
  body?: string;
  visibility: Visibility;
  links?: Record<string, string>;
  amount?: number;
}

/** Entries bucketed by date, ascending — the calendar renders one list per day. */
export function groupByDate<T extends { date: string }>(entries: T[]): Array<{ date: string; entries: T[] }> {
  const buckets = new Map<string, T[]>();
  for (const entry of entries) {
    const list = buckets.get(entry.date);
    if (list) list.push(entry);
    else buckets.set(entry.date, [entry]);
  }
  return [...buckets.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, list]) => ({ date, entries: list }));
}

/** Whole days between two ISO `YYYY-MM-DD` dates, or null if either is junk. */
export function daysBetween(from: string, to: string): number | null {
  const a = isoToUtc(from);
  const b = isoToUtc(to);
  if (a === null || b === null) return null;
  return Math.round((b - a) / 86_400_000);
}

function isoToUtc(iso: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return null;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** "today" / "in 3 days" / "2 days ago", relative to the in-game clock. */
export function relativeToClock(date: string, clock: string | null | undefined): string {
  if (!clock) return '';
  const delta = daysBetween(clock, date);
  if (delta === null) return '';
  if (delta === 0) return 'today';
  if (delta === 1) return 'tomorrow';
  if (delta === -1) return 'yesterday';
  return delta > 0 ? `in ${delta} days` : `${-delta} days ago`;
}

/** Is this beat still ahead of the campaign clock? (Rent due, next meet.) */
export function isUpcoming(date: string, clock: string | null | undefined): boolean {
  const delta = clock ? daysBetween(clock, date) : null;
  return delta !== null && delta >= 0;
}

// ---------------------------------------------------------------------------
// Contacts (FR5.8)
// ---------------------------------------------------------------------------

export interface Favours {
  owed: number;
  owing: number;
}

/**
 * Net favour position from the character's side: positive means the contact
 * owes them. The sign is the whole point of the column at the table.
 */
export function favourBalance(f: Favours): number {
  return (f.owed ?? 0) - (f.owing ?? 0);
}

export function favourLabel(f: Favours): string {
  const net = favourBalance(f);
  if (net === 0 && f.owed === 0 && f.owing === 0) return 'square';
  if (net > 0) return `owes you ${net}`;
  if (net < 0) return `you owe ${-net}`;
  return 'even';
}

/**
 * SR5 shorthand the sheet prints beside a name: Connection/Loyalty.
 * Both are user-entered ratings; we never invent one.
 */
export function contactRating(connection: number, loyalty: number): string {
  return `C${connection}/L${loyalty}`;
}
