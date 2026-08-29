/**
 * A very small Markdown reader for codex pages (M5 — FR5.1/5.3, FR11.4).
 *
 * No dependency: the budget in BUILD_CONVENTIONS has no markdown library, and
 * a codex page is prose with headings, lists and two campaign-specific inline
 * forms — `[[Wiki-links]]` (FR5.3) and `SR5 p.426` book refs (FR11.4). Both
 * have to become interactive elements, which a generic renderer would fight.
 *
 * Heading slugs are produced by the SAME rules as the server's
 * `services/codex.ts` (`slugify` + duplicate suffixes, fenced blocks skipped),
 * because a section's visibility is keyed by that slug: if the two disagreed,
 * the GM's "reveal this section" would flip the wrong one.
 *
 * Pure — no DOM, no React. The renderer is `Markdown.tsx`.
 */
import { findFreetextRefs } from '../gm/books/refs.js';

// ---------------------------------------------------------------------------
// Inline
// ---------------------------------------------------------------------------

export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'strong'; text: string }
  | { kind: 'em'; text: string }
  | { kind: 'code'; text: string }
  /** `[[Target]]` / `[[Target|label]]` — resolved against the page list. */
  | { kind: 'wikilink'; target: string; label: string }
  /** `SR5 p.426` — becomes a RefChip that opens the book (FR11.3/11.4). */
  | { kind: 'ref'; book: string; page: number; text: string };

const INLINE_RE =
  /(`[^`\n]+`)|(\[\[[^\][\n]+\]\])|(\*\*[^*\n]+\*\*)|(\*[^*\n]+\*)|(_[^_\n]+_)/g;

function pushText(out: Inline[], text: string): void {
  if (text.length === 0) return;
  // Book refs only ever live in plain runs — never inside code or a wiki-link.
  const refs = findFreetextRefs(text);
  if (refs.length === 0) {
    out.push({ kind: 'text', text });
    return;
  }
  let cursor = 0;
  for (const m of refs) {
    if (m.start > cursor) out.push({ kind: 'text', text: text.slice(cursor, m.start) });
    out.push({ kind: 'ref', book: m.ref.book, page: m.ref.page, text: m.text });
    cursor = m.end;
  }
  if (cursor < text.length) out.push({ kind: 'text', text: text.slice(cursor) });
}

/** Split one line of prose into inline tokens. */
export function parseInline(line: string): Inline[] {
  const out: Inline[] = [];
  const re = new RegExp(INLINE_RE.source, 'g');
  let cursor = 0;
  let m: RegExpExecArray | null;

  while ((m = re.exec(line)) !== null) {
    if (m.index > cursor) pushText(out, line.slice(cursor, m.index));
    const token = m[0];
    if (token.startsWith('`')) {
      out.push({ kind: 'code', text: token.slice(1, -1) });
    } else if (token.startsWith('[[')) {
      const body = token.slice(2, -2);
      const bar = body.indexOf('|');
      const target = (bar >= 0 ? body.slice(0, bar) : body).trim();
      const label = (bar >= 0 ? body.slice(bar + 1) : body).trim();
      if (target.length === 0) pushText(out, token);
      else out.push({ kind: 'wikilink', target, label: label || target });
    } else if (token.startsWith('**')) {
      out.push({ kind: 'strong', text: token.slice(2, -2) });
    } else {
      out.push({ kind: 'em', text: token.slice(1, -1) });
    }
    cursor = m.index + token.length;
  }
  if (cursor < line.length) pushText(out, line.slice(cursor));
  return out;
}

/** Every `[[link]]` target on a page, de-duplicated, in first-seen order. */
export function wikiLinkTargets(md: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const block of parseMarkdown(md)) {
    for (const inline of blockInlines(block)) {
      if (inline.kind !== 'wikilink') continue;
      const key = normalizeTitle(inline.target);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(inline.target);
    }
  }
  return out;
}

/** Title comparison for link resolution — matches the server's rule. */
export function normalizeTitle(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, ' ');
}

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

export type Block =
  | { kind: 'heading'; level: number; id: string; text: string; inline: Inline[] }
  | { kind: 'paragraph'; inline: Inline[] }
  | { kind: 'list'; ordered: boolean; items: Inline[][] }
  | { kind: 'quote'; inline: Inline[] }
  | { kind: 'code'; text: string; lang: string | null }
  | { kind: 'rule' };

export function blockInlines(block: Block): Inline[] {
  switch (block.kind) {
    case 'heading':
    case 'paragraph':
    case 'quote':
      return block.inline;
    case 'list':
      return block.items.flat();
    default:
      return [];
  }
}

/** Heading → stable slug. Mirrors `services/codex.ts` exactly. */
export function slugify(heading: string): string {
  const slug = heading
    .toLowerCase()
    .replace(/[`*_~[\]()]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug.length > 0 ? slug.slice(0, 80) : 'section';
}

const HEADING_RE = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/;
const FENCE_RE = /^\s{0,3}(```|~~~)(.*)$/;
const UL_RE = /^\s{0,3}[-*+]\s+(.*)$/;
const OL_RE = /^\s{0,3}\d{1,9}[.)]\s+(.*)$/;
const QUOTE_RE = /^\s{0,3}>\s?(.*)$/;
const RULE_RE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;

export function parseMarkdown(md: string): Block[] {
  const lines = md.split(/\r?\n/);
  const blocks: Block[] = [];
  const seen = new Map<string, number>();

  let para: string[] = [];
  let quote: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let fence: { lang: string | null; body: string[] } | null = null;

  const flushPara = () => {
    if (para.length === 0) return;
    blocks.push({ kind: 'paragraph', inline: parseInline(para.join(' ')) });
    para = [];
  };
  const flushQuote = () => {
    if (quote.length === 0) return;
    blocks.push({ kind: 'quote', inline: parseInline(quote.join(' ')) });
    quote = [];
  };
  const flushList = () => {
    if (!list) return;
    blocks.push({
      kind: 'list',
      ordered: list.ordered,
      items: list.items.map((i) => parseInline(i)),
    });
    list = null;
  };
  const flushAll = () => {
    flushPara();
    flushQuote();
    flushList();
  };

  for (const raw of lines) {
    const fenceMatch = FENCE_RE.exec(raw);
    if (fence) {
      if (fenceMatch) {
        blocks.push({ kind: 'code', text: fence.body.join('\n'), lang: fence.lang });
        fence = null;
      } else {
        fence.body.push(raw);
      }
      continue;
    }
    if (fenceMatch) {
      flushAll();
      const lang = (fenceMatch[2] ?? '').trim();
      fence = { lang: lang.length > 0 ? lang : null, body: [] };
      continue;
    }

    if (raw.trim().length === 0) {
      flushAll();
      continue;
    }

    const heading = HEADING_RE.exec(raw);
    if (heading) {
      flushAll();
      const text = (heading[2] ?? '').trim();
      const base = slugify(text);
      const n = (seen.get(base) ?? 0) + 1;
      seen.set(base, n);
      blocks.push({
        kind: 'heading',
        level: (heading[1] ?? '#').length,
        id: n === 1 ? base : `${base}-${n}`,
        text,
        inline: parseInline(text),
      });
      continue;
    }

    if (RULE_RE.test(raw)) {
      flushAll();
      blocks.push({ kind: 'rule' });
      continue;
    }

    const quoteMatch = QUOTE_RE.exec(raw);
    if (quoteMatch) {
      flushPara();
      flushList();
      quote.push(quoteMatch[1] ?? '');
      continue;
    }

    const ol = OL_RE.exec(raw);
    const ul = ol ? null : UL_RE.exec(raw);
    if (ol || ul) {
      flushPara();
      flushQuote();
      const ordered = Boolean(ol);
      const item = (ol?.[1] ?? ul?.[1] ?? '').trim();
      if (list && list.ordered !== ordered) flushList();
      if (!list) list = { ordered, items: [] };
      list.items.push(item);
      continue;
    }

    flushQuote();
    flushList();
    para.push(raw.trim());
  }

  if (fence) blocks.push({ kind: 'code', text: fence.body.join('\n'), lang: fence.lang });
  flushAll();
  return blocks;
}

// ---------------------------------------------------------------------------
// Section outline (FR5.2 per-section visibility)
// ---------------------------------------------------------------------------

export interface OutlineEntry {
  id: string;
  heading: string;
  level: number;
}

/**
 * The page's headings as the GM's reveal controls see them. Ids match the
 * server's `SectionMeta.id`, which is what `POST /api/wiki/:id/reveal` takes.
 */
export function sectionOutline(md: string): OutlineEntry[] {
  return parseMarkdown(md).flatMap((b) =>
    b.kind === 'heading' ? [{ id: b.id, heading: b.text, level: b.level }] : [],
  );
}

/** A one-line preview for list rows: the first prose sentence, trimmed. */
export function excerpt(md: string, max = 140): string {
  for (const block of parseMarkdown(md)) {
    if (block.kind !== 'paragraph') continue;
    const text = block.inline
      .map((i) => (i.kind === 'wikilink' ? i.label : 'text' in i ? i.text : ''))
      .join('')
      .trim();
    if (text.length === 0) continue;
    return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
  }
  return '';
}
