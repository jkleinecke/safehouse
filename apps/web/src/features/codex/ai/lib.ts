/**
 * Pure logic behind "help me fill out the codex" (FR12.2/12.17, Principle 8).
 *
 * Nothing here talks to the network. It answers four questions:
 *
 *  1. **What do we ask the Fixer?** `buildPrompt` writes a grounded instruction
 *     naming THIS page — its kind, title, tags, body, and the neighbouring page
 *     titles — so the draft is about this campaign and not generic sprawl
 *     (R12). It also pins the contract: call `draft_wiki_page` once, return the
 *     shape this action needs, and nothing else.
 *  2. **How does a proposal become page text?** `applyProposal` merges the
 *     draft into the current body by mode — replace the page, append a new
 *     section, or splice one section back in place. The GM picks the mode; the
 *     model never decides how much of the page it gets to overwrite.
 *  3. **What changed?** `diffLines` produces the before/after the GM reads
 *     BEFORE accepting. A proposal that is never accepted never touches the
 *     page (Principle 8) — this file has no way to write anything.
 *  4. **Is the Fixer even on?** `disabledReason` turns "no `LLM_BASE_URL`" into
 *     one honest sentence, so the buttons can be shown disabled-with-a-reason
 *     rather than vanishing (NG7: the GM should know the feature exists and why
 *     it is asleep).
 *
 * Section ids are produced by the SAME rules as `../md.ts` (which mirrors the
 * server's `services/codex.ts`): a spliced section has to land on the slug the
 * GM's reveal controls use, or "expand this section" would rewrite a different
 * one than the one whose visibility the GM set.
 */
import { ApiError } from '../../../api/client.js';
import type { FixerStatus } from '../../gm/fixer/api.js';
import { slugify } from '../md.js';

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export type CodexAiAction = 'draft' | 'expand' | 'summarise' | 'links' | 'new';

/** How a proposal folds into the page the GM is looking at. */
export type MergeMode = 'replace' | 'append' | 'section';

export interface ActionSpec {
  id: CodexAiAction;
  label: string;
  /** One line under the button — what the GM gets, in the GM's terms. */
  hint: string;
  /** Where the result lands by default. The GM can change it on the card. */
  mode: MergeMode;
}

export const CODEX_AI_ACTIONS: readonly ActionSpec[] = [
  {
    id: 'draft',
    label: 'draft with the Fixer',
    hint: 'a first pass at this page, in sections you can reveal one at a time',
    mode: 'replace',
  },
  {
    id: 'expand',
    label: 'expand',
    hint: 'flesh out the chosen section, or the whole stub',
    mode: 'section',
  },
  {
    id: 'summarise',
    label: 'summarise the log',
    hint: 'what the table actually played, written up as lore and appended',
    mode: 'append',
  },
  {
    id: 'links',
    label: 'suggest links',
    hint: 'backlinks to pages that already exist (FR5.3), appended as “See also”',
    mode: 'append',
  },
];

export const ACTION_BY_ID = new Map(CODEX_AI_ACTIONS.map((a) => [a.id, a]));

// ---------------------------------------------------------------------------
// Sections (ids match ../md.ts, which matches the server)
// ---------------------------------------------------------------------------

const HEADING_RE = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/;
const FENCE_RE = /^\s{0,3}(?:```|~~~)/;

interface HeadingLine {
  id: string;
  level: number;
  heading: string;
  line: number;
}

/** Every heading with the slug the reveal controls address it by. */
export function headingLines(md: string): HeadingLine[] {
  const lines = md.split(/\r?\n/);
  const seen = new Map<string, number>();
  const out: HeadingLine[] = [];
  let fenced = false;
  lines.forEach((raw, index) => {
    if (FENCE_RE.test(raw)) {
      fenced = !fenced;
      return;
    }
    if (fenced) return;
    const m = HEADING_RE.exec(raw);
    if (!m) return;
    const heading = (m[2] ?? '').trim();
    const base = slugify(heading);
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    out.push({
      id: n === 1 ? base : `${base}-${n}`,
      level: (m[1] ?? '#').length,
      heading,
      line: index,
    });
  });
  return out;
}

/**
 * The half-open line range one section occupies: its heading through the line
 * before the next heading at the same level or shallower.
 */
export function sectionRange(md: string, sectionId: string): { start: number; end: number } | null {
  const headings = headingLines(md);
  const index = headings.findIndex((h) => h.id === sectionId);
  if (index < 0) return null;
  const here = headings[index]!;
  const total = md.split(/\r?\n/).length;
  const next = headings.slice(index + 1).find((h) => h.level <= here.level);
  return { start: here.line, end: next ? next.line : total };
}

/** One section's markdown, heading line included. */
export function sectionText(md: string, sectionId: string): string {
  const range = sectionRange(md, sectionId);
  if (!range) return '';
  return md.split(/\r?\n/).slice(range.start, range.end).join('\n').trimEnd();
}

/**
 * A page with almost no prose on it — the case "expand" is really for. Headings
 * and link lines do not count: a page that is three empty headings is still a
 * stub, and telling the Fixer to "preserve every existing line" there produces
 * three empty headings back.
 */
export function isStub(md: string, floor = 80): boolean {
  const prose = md
    .split(/\r?\n/)
    .filter((l) => !HEADING_RE.test(l))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  return prose.length < floor;
}

// ---------------------------------------------------------------------------
// Merging a proposal into the page
// ---------------------------------------------------------------------------

function trimBody(md: string): string {
  return md.replace(/\r\n/g, '\n').replace(/\s+$/, '');
}

/**
 * The candidate body the GM is being asked to accept.
 *
 * `section` falls back to `append` when the section has gone (the GM renamed a
 * heading while the draft was in flight): appending is visible and reversible,
 * silently replacing the whole page would not be.
 */
export function applyProposal(
  currentMd: string,
  proposedMd: string,
  mode: MergeMode,
  sectionId?: string,
): string {
  const proposed = trimBody(proposedMd);
  const current = trimBody(currentMd);
  if (proposed.length === 0) return current;
  if (mode === 'replace') return `${proposed}\n`;
  if (mode === 'section' && sectionId) {
    const range = sectionRange(current, sectionId);
    if (range) {
      const lines = current.split('\n');
      const next = [...lines.slice(0, range.start), ...proposed.split('\n'), ...lines.slice(range.end)];
      return `${trimBody(next.join('\n'))}\n`;
    }
  }
  if (current.length === 0) return `${proposed}\n`;
  return `${current}\n\n${proposed}\n`;
}

// ---------------------------------------------------------------------------
// Diff — what the GM reads before accepting
// ---------------------------------------------------------------------------

export type DiffKind = 'same' | 'add' | 'del';
export interface DiffLine {
  kind: DiffKind;
  text: string;
}

/** Cap so a pathological page cannot spend the GM's laptop on an LCS table. */
const DIFF_LINE_CAP = 600;

/**
 * Line diff by longest common subsequence. Small on purpose: the point is that
 * the GM can see what the Fixer would ADD and what it would TAKE AWAY before
 * anything is written, not that it renders like git.
 */
/** An empty page is ZERO lines, not one blank one — or a brand-new page's diff
 * would open by claiming it deletes something. */
function toLines(md: string): string[] {
  const body = trimBody(md);
  return body.length === 0 ? [] : body.split('\n');
}

export function diffLines(before: string, after: string): DiffLine[] {
  const a = toLines(before);
  const b = toLines(after);
  if (a.length > DIFF_LINE_CAP || b.length > DIFF_LINE_CAP) {
    return [
      ...a.map((text): DiffLine => ({ kind: 'del', text })),
      ...b.map((text): DiffLine => ({ kind: 'add', text })),
    ];
  }
  const n = a.length;
  const m = b.length;
  const table: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      table[i]![j] = a[i] === b[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ kind: 'same', text: a[i]! });
      i += 1;
      j += 1;
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) {
      out.push({ kind: 'del', text: a[i]! });
      i += 1;
    } else {
      out.push({ kind: 'add', text: b[j]! });
      j += 1;
    }
  }
  while (i < n) out.push({ kind: 'del', text: a[i++]! });
  while (j < m) out.push({ kind: 'add', text: b[j++]! });
  return out;
}

export function diffStat(lines: DiffLine[]): { added: number; removed: number } {
  return {
    added: lines.filter((l) => l.kind === 'add').length,
    removed: lines.filter((l) => l.kind === 'del').length,
  };
}

// ---------------------------------------------------------------------------
// Prompting — grounded in THIS campaign
// ---------------------------------------------------------------------------

export interface PageContext {
  title: string;
  kind: string;
  tags: string[];
  contentMd: string;
  /** Titles of pages that already exist — the only link targets allowed. */
  neighbours: string[];
  /** Pages that already point here. */
  backlinks: string[];
  /** `[[links]]` on this page with nothing behind them yet. */
  unresolved: string[];
  /** Set when the GM chose a heading to work on. */
  sectionId?: string;
  sectionHeading?: string;
}

const GROUNDING = [
  'You are filling in the campaign codex for the GM you are talking to.',
  'Ground every sentence in THIS campaign: call search_codex, get_page, list_runs, get_run, list_contacts, list_characters or get_session_log before you invent anything. Where the campaign is silent, write something small and concrete the GM can build on — never generic sprawl filler.',
  'Original fiction only. Never reproduce published Shadowrun text.',
  'Mechanical numbers are the engine’s, not yours: name a stat only if a tool gave it to you.',
].join('\n');

function contextBlock(ctx: PageContext, includeBody: boolean): string {
  const lines = [
    `Page: "${ctx.title}"`,
    `Kind: ${ctx.kind}`,
    ctx.tags.length > 0 ? `Tags: ${ctx.tags.join(', ')}` : null,
    ctx.backlinks.length > 0 ? `Pages that already point here: ${ctx.backlinks.join(' · ')}` : null,
    ctx.unresolved.length > 0 ? `Links on this page with no page yet: ${ctx.unresolved.join(' · ')}` : null,
    ctx.neighbours.length > 0
      ? `Existing pages you may link to with [[double brackets]] — use these titles EXACTLY, and no others: ${ctx.neighbours.slice(0, 60).join(' · ')}`
      : null,
  ].filter((l): l is string => l !== null);
  if (includeBody && ctx.contentMd.trim().length > 0) {
    lines.push('', 'The page as it stands:', '---', ctx.contentMd.slice(0, 6000), '---');
  }
  return lines.join('\n');
}

function contract(ctx: PageContext, playerFacing: boolean, shape: string): string {
  return [
    '',
    'When the prose is ready, call draft_wiki_page exactly once with:',
    `  title: ${JSON.stringify(ctx.title)}`,
    `  kind: ${JSON.stringify(ctx.kind)}`,
    `  tags: ${JSON.stringify(ctx.tags)}`,
    `  playerFacing: ${playerFacing}`,
    `  contentMd: ${shape}`,
    'Call it once and only once. Do not repeat the prose in your reply — answer with one short sentence naming what you drafted. The GM reviews it before a word of it reaches the page.',
  ].join('\n');
}

export interface PromptInput {
  action: CodexAiAction;
  ctx: PageContext;
  /** The GM's own steer, typed into the panel. Optional. */
  extra?: string;
  /** Drives the FR12.19 spoiler scan on the server side. */
  playerFacing: boolean;
  /** For 'new': the GM's brief instead of an existing page. */
  brief?: string;
}

export function buildPrompt(input: PromptInput): string {
  const { action, ctx, playerFacing } = input;
  const extra = (input.extra ?? '').trim();
  const steer = extra.length > 0 ? `\nThe GM adds: ${extra}` : '';

  switch (action) {
    case 'new': {
      const brief = (input.brief ?? '').trim();
      return [
        GROUNDING,
        '',
        `The GM wants a new codex page: ${brief}`,
        `File it as kind "${ctx.kind}".`,
        contextBlock({ ...ctx, contentMd: '' }, false),
        '',
        'Write the whole page. Open with two or three sentences a GM can read aloud, then break it into `## ` sections so each one can be revealed separately (FR5.2). Link to existing pages with [[Exact Title]] where they genuinely connect. End with a `## GM only` section holding what the players must not learn yet.',
        steer,
        contract({ ...ctx, title: titleFromBrief(brief, ctx.title) }, playerFacing, 'the COMPLETE page body'),
      ].join('\n');
    }
    case 'draft':
      return [
        GROUNDING,
        '',
        `Write the first draft of this ${ctx.kind} page.`,
        contextBlock(ctx, true),
        '',
        'Open with two or three sentences a GM can read aloud at the table, then break the rest into `## ` sections so each can be revealed separately (FR5.2). Keep anything the players must not learn yet in a final `## GM only` section. Link to existing pages with [[Exact Title]] where they genuinely connect.',
        'Preserve every line the GM has already written — add around it, never over it.',
        steer,
        contract(ctx, playerFacing, 'the COMPLETE page body'),
      ].join('\n');
    case 'expand': {
      if (ctx.sectionId && ctx.sectionHeading) {
        return [
          GROUNDING,
          '',
          `Expand one section of this page: "${ctx.sectionHeading}".`,
          contextBlock(ctx, true),
          '',
          `Return ONLY that section, starting with its heading line exactly as written above. Keep every fact already in it and add the detail a GM needs to run it: who is there, what it costs, what goes wrong. Two or three tight paragraphs, not an essay.`,
          steer,
          contract(ctx, playerFacing, `ONLY the replacement for the "${ctx.sectionHeading}" section, heading line included`),
        ].join('\n');
      }
      return [
        GROUNDING,
        '',
        'This page is a stub. Fill it out.',
        contextBlock(ctx, true),
        '',
        'Return the COMPLETE page body, preserving every existing line verbatim and building the substance around it. Break it into `## ` sections; keep secrets in a final `## GM only` section.',
        steer,
        contract(ctx, playerFacing, 'the COMPLETE page body'),
      ].join('\n');
    }
    case 'summarise':
      return [
        GROUNDING,
        '',
        `Summarise what the table has actually played into lore for "${ctx.title}".`,
        contextBlock(ctx, true),
        '',
        'Call get_session_log and list_runs first. Write only what happened — no invented beats, no numbers a tool did not give you. Frame it as campaign lore, not as minutes.',
        'Return ONLY the new section, starting with a `## ` heading naming it (for example `## What the team learned`). It will be appended to the page.',
        steer,
        contract(ctx, playerFacing, 'ONLY the new section, starting with its `## ` heading'),
      ].join('\n');
    case 'links':
      return [
        GROUNDING,
        '',
        `Suggest wiki links from "${ctx.title}" to pages that already exist (FR5.3).`,
        contextBlock(ctx, true),
        '',
        'Choose ONLY from the existing page titles listed above — never invent a title, never link a page that is not on that list. Skip anything already linked from this page. At most eight, fewest is better.',
        'Return ONLY a section that starts `## See also`, then one bullet per link in the form `- [[Exact Title]] — one clause saying how it connects to this page`.',
        steer,
        contract(ctx, playerFacing, 'ONLY the `## See also` section'),
      ].join('\n');
    default:
      return GROUNDING;
  }
}

/** A brief like "a ganger bar on the docks" is not a title; fall back cleanly. */
export function titleFromBrief(brief: string, fallback: string): string {
  const first = brief.split(/[.\n]/)[0]?.trim() ?? '';
  if (first.length === 0 || first.length > 80) return fallback;
  return first;
}

// ---------------------------------------------------------------------------
// AI off, honestly (NG7)
// ---------------------------------------------------------------------------

/**
 * One line the GM can act on, or null when the Fixer is available.
 *
 * A 503 `ai_disabled` is an ANSWER, not a failure — the app is designed to play
 * with no model at all — so it never becomes a red error note. Anything else
 * (box unreachable, model refused) keeps its own message: "the Fixer is off" is
 * the wrong thing to tell a GM whose llama.cpp just crashed.
 */
export function disabledReason(
  status: FixerStatus | undefined,
  ...errors: unknown[]
): string | null {
  const off =
    (status !== undefined && status.enabled === false) ||
    errors.some((e) => e instanceof ApiError && e.status === 503 && e.code === 'ai_disabled');
  if (!off) return null;
  return 'The Fixer is switched off — no LLM_BASE_URL is configured, so there is no model to draft with. The codex works exactly as before without it.';
}

/** A friendly line for an AI call that failed for some OTHER reason. */
export function askErrorLine(error: unknown): string | null {
  if (!error) return null;
  if (error instanceof ApiError) {
    if (error.status === 503 && error.code === 'ai_disabled') return disabledReason({ enabled: false, models: null });
    if (error.code === 'ai_busy') return 'The Fixer is still finishing the previous request. Try again in a moment.';
    if (error.status >= 500) return `The inference box did not answer: ${error.message}`;
    return error.message;
  }
  return error instanceof Error ? error.message : String(error);
}
