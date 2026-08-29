/**
 * FR5.6 — "NPC/grunt stat templates and archetype templates live in the codex
 * (user-entered, page-referenced)". The pure half.
 *
 * The link is one column on `npc_templates` (`wiki_page_id`), which makes two
 * things true and both of them shape this file:
 *
 *  1. **It is single-valued.** A template belongs to at most one page, so
 *     linking one that already belongs elsewhere MOVES it. The picker has to
 *     say so; silently stealing another page's opposition is the kind of edit a
 *     GM discovers three sessions later.
 *  2. **The reverse direction is a lookup, not a second column.** A page finds
 *     its templates by reverse lookup, so the two directions cannot disagree —
 *     `isLinkedTo` is the whole of the round trip, and there is no state where
 *     the page claims a template the template does not claim back.
 *
 * Everything here is a pure function over the two DTOs, so the rules are
 * testable without a page, a server or a DOM.
 */
import type { NpcTemplate } from '@safehouse/contracts';
import type { TemplateLink } from './api.js';

/** The reciprocal check. A link the template does not claim back is not a link. */
export function isLinkedTo(link: TemplateLink, pageId: string): boolean {
  return link.wikiPageId === pageId;
}

/**
 * What the page actually shows.
 *
 * Filtering on the reciprocal rather than trusting the array is not paranoia:
 * `POST` and `DELETE` both answer with the *template's* new link row, and a
 * cache that has taken one of those answers on board can hold a row whose
 * `wikiPageId` has already moved to another page. Rendering the template's own
 * word for it keeps the panel honest between a mutation and its refetch.
 */
export function linkedTemplates(
  templates: readonly TemplateLink[] | undefined,
  pageId: string,
): TemplateLink[] {
  return (templates ?? []).filter((t) => isLinkedTo(t, pageId));
}

export interface TemplateOption {
  id: string;
  name: string;
  roleTags: string[];
}

/**
 * The pool a page can claim from: every campaign template that is not already
 * on this page, name-ordered so the list does not reshuffle under the GM's
 * finger as templates are added.
 */
export function linkableTemplates(
  all: readonly NpcTemplate[] | undefined,
  linked: readonly TemplateLink[],
): TemplateOption[] {
  const taken = new Set(linked.map((l) => l.templateId));
  return (all ?? [])
    .filter((t) => !taken.has(t.id))
    .map((t) => ({ id: t.id, name: t.name, roleTags: t.gen?.roleTags ?? [] }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** `muscle · sniper`, or nothing at all when the template carries no tags. */
export function roleTagLine(roleTags: readonly string[]): string {
  return roleTags.join(' · ');
}

/**
 * Where "follow the link" goes: the Opposition Kit, carrying the template id.
 *
 * `features/gm/GeneratorPage.tsx` reads `?template=` and hands it to the
 * Generate panel, which opens on that archetype — so the link is an answer,
 * not just a navigation. A stale id falls back to the first template rather
 * than leaving the panel with nothing selected.
 */
export function generatorPathFor(campaignId: string, templateId: string): string {
  return `/c/${campaignId}/gm/generator?template=${encodeURIComponent(templateId)}`;
}

/** Accessible name for the follow link — says where it goes and what it is. */
export function describeFollow(link: TemplateLink): string {
  const tags = roleTagLine(link.roleTags);
  return `Open the ${link.name} archetype in the opposition kit${tags ? ` (${tags})` : ''}`;
}
