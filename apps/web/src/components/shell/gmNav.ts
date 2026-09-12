/**
 * The GM console's map of itself — one ordered list, two renderers.
 *
 * The complaint this exists to answer is not "the feature is missing", it is
 * "I cannot find it". Every real surface the GM has is named here exactly once,
 * in the order a GM actually works: who is at the table, then the table, then
 * the prep that feeds it. `GmSidebar` renders it as the desktop rail and
 * `GmHome` renders the same list as labelled cards, so a screen can never be
 * reachable from one and invisible in the other, and adding a screen is one
 * line here rather than an edit in two files that drift.
 *
 * `to` is campaign-relative on purpose — `gmHref()` is the only place that
 * knows the `/c/:campaignId` prefix.
 */

export type GmNavSection = 'campaign' | 'table' | 'prep';

export interface GmNavEntry {
  /** Stable key (also the test handle: `data-nav="<key>"`). */
  key: string;
  label: string;
  /** Path under `/c/:campaignId`, leading slash included. */
  to: string;
  /** What the GM comes here to DO — shown on the console cards. */
  blurb: string;
  section: GmNavSection;
  /** NavLink `end` — only the index route should match exactly. */
  end?: boolean;
}

/** Section headings, in render order. */
export const GM_NAV_SECTIONS: ReadonlyArray<{ id: GmNavSection; label: string; hint: string }> = [
  { id: 'campaign', label: 'Campaign', hint: 'who is at the table' },
  { id: 'table', label: 'At the table', hint: 'what runs on Friday night' },
  { id: 'prep', label: 'Prep', hint: 'what feeds Friday night' },
];

export const GM_NAV: readonly GmNavEntry[] = [
  {
    key: 'overview',
    label: 'Overview',
    to: '/gm',
    end: true,
    section: 'campaign',
    blurb: 'Campaign name, the in-game clock, the join QR, and every paired device.',
  },
  {
    key: 'party',
    label: 'Party',
    to: '/gm/party',
    section: 'campaign',
    blurb: 'Every player character: open a sheet, hand one to a phone, add a new runner.',
  },
  {
    key: 'ai',
    label: 'AI',
    to: '/gm/ai',
    section: 'campaign',
    blurb: 'Which model the Fixer talks to — a box on your own machine or a provider — and whether it is reachable.',
  },
  {
    key: 'table',
    label: 'Table',
    to: '/table',
    section: 'table',
    blurb: 'The shared roll log and the initiative tracker — the screen you run combat from.',
  },
  {
    key: 'grid',
    label: 'Map',
    to: '/grid',
    section: 'table',
    blurb: 'The tactical map: tokens, fog, pings, and the GM panel that authors scenes.',
  },
  {
    key: 'scenes',
    label: 'Scenes',
    to: '/gm/scenes',
    section: 'table',
    blurb: 'Every scene in the campaign — activate one, or open it on the Map to author it.',
  },
  {
    key: 'codex',
    label: 'Codex',
    to: '/codex',
    section: 'table',
    blurb: 'NPCs, factions, locations, lore — and exactly how much of it the players can see.',
  },
  {
    key: 'calendar',
    label: 'Calendar',
    to: '/calendar',
    section: 'table',
    blurb: 'The Sixth World clock: runs, sessions, and rent coming due.',
  },
  {
    key: 'runs',
    label: 'Runs',
    to: '/gm/runs',
    section: 'prep',
    blurb: 'Draft the job — Johnson, objectives, payout — and pay it out when it lands.',
  },
  {
    key: 'generator',
    label: 'Generator',
    to: '/gm/generator',
    section: 'prep',
    blurb: 'Roll opposition from archetype tiers, then check the threat math against the party.',
  },
  {
    key: 'fixer',
    label: 'Fixer',
    to: '/gm/fixer',
    section: 'prep',
    blurb: 'The AI copilot. Everything it writes arrives as a draft you accept or bin.',
  },
  {
    key: 'architect',
    label: 'Architect',
    to: '/gm/architect',
    section: 'prep',
    blurb: 'One brief becomes an outline — codex pages, NPCs, mapped scenes — and each item you tick is built as a draft.',
  },
  {
    key: 'books',
    label: 'Books',
    to: '/books',
    section: 'prep',
    blurb: 'The rules library: printed-page calibration, and what the table is allowed to open.',
  },
  {
    key: 'sessions',
    label: 'Sessions',
    to: '/gm/sessions',
    section: 'prep',
    blurb: 'Attendance, the recap, and the end-of-session housekeeping beat.',
  },
];

/** Absolute href for a nav entry in a given campaign. */
export function gmHref(campaignId: string, entry: Pick<GmNavEntry, 'to'>): string {
  return `/c/${campaignId}${entry.to}`;
}

/** The entries of one section, in declaration order. */
export function gmNavSection(section: GmNavSection): GmNavEntry[] {
  return GM_NAV.filter((e) => e.section === section);
}

// ---------------------------------------------------------------------------
// Player-facing navigation
// ---------------------------------------------------------------------------

export interface PlayerNavEntry {
  key: string;
  label: string;
  to: string;
  blurb: string;
  /** Bottom-nav glyph (phones); omitted entries stay off the bottom bar. */
  glyph?: string;
}

/**
 * What a non-GM device gets. `books` is on this list deliberately: FR11.5's
 * default is shared-with-the-table, and until now a player could only reach a
 * book through a ref chip that happened to be embedded in something they were
 * already reading.
 */
export const PLAYER_NAV: readonly PlayerNavEntry[] = [
  {
    key: 'table',
    label: 'Table',
    to: '/table',
    glyph: '⬡',
    blurb: 'Shared roll log and the initiative tracker.',
  },
  { key: 'grid', label: 'Map', to: '/grid', glyph: '▦', blurb: 'The tactical map — tokens, fog, pings.' },
  {
    key: 'codex',
    label: 'Codex',
    to: '/codex',
    glyph: '❖',
    blurb: 'NPCs, factions, locations, lore — what the team actually knows.',
  },
  {
    key: 'books',
    label: 'Books',
    to: '/books',
    glyph: '▤',
    blurb: 'The rulebooks the GM shared with the table — open one to the printed page.',
  },
  {
    key: 'calendar',
    label: 'Calendar',
    to: '/calendar',
    blurb: 'The Sixth World clock: runs, sessions, rent coming due.',
  },
];
