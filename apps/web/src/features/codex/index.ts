/**
 * Public surface of the codex feature (M5).
 *
 * Other agents import from here, not from deep paths.
 *
 * - `ContactsPanel` is the reusable contacts block for the character sheet's
 *   Background area (FR5.8) — pass `bare` to drop the panel chrome and
 *   `readOnly` for a sheet the device may read but not edit.
 * - `Markdown` renders codex prose anywhere with live `[[wiki-links]]` and
 *   `SR5 p.426` ref chips (FR5.3/FR11.4).
 * - `CodexPage` / `RunsBoard` / `CalendarView` are the route components.
 */
export { default as CodexPage } from './CodexPage.js';
export { default as RunsBoard } from './RunsBoard.js';
export { default as CalendarView } from './CalendarView.js';
export { default as ContactsPanel } from './ContactsPanel.js';
export type { ContactsPanelProps } from './ContactsPanel.js';
export { default as Markdown } from './Markdown.js';
export type { MarkdownProps } from './Markdown.js';
export { default as PageBrowser } from './PageBrowser.js';
export { default as PageView } from './PageView.js';
export { default as HandoutsPanel } from './HandoutsPanel.js';
export { default as TemplatePanel } from './TemplatePanel.js';
export type { TemplatePanelProps } from './TemplatePanel.js';

/**
 * FR5.6's pure half. `generatorPathFor` is the codex→template hop; the
 * template→codex hop is the same single column read the other way, so a
 * generator-side "open its codex page" link is `/c/:campaignId/codex/:pageId`
 * with the `wikiPageId` the link row already carries — no extra route needed.
 */
export {
  describeFollow,
  generatorPathFor,
  isLinkedTo,
  linkableTemplates,
  linkedTemplates,
  roleTagLine,
} from './templates.js';
export type { TemplateOption } from './templates.js';

export {
  excerpt,
  normalizeTitle,
  parseInline,
  parseMarkdown,
  sectionOutline,
  slugify,
  wikiLinkTargets,
} from './md.js';
export type { Block, Inline, OutlineEntry } from './md.js';

export {
  PAGE_KINDS,
  collectTags,
  contactRating,
  daysBetween,
  favourBalance,
  favourLabel,
  filterPages,
  groupByDate,
  inheritedSecrets,
  isUpcoming,
  nextObjectiveState,
  payoutSummary,
  pinSectionsForReveal,
  presentKinds,
  relativeToClock,
  runProgress,
  visibilityLabel,
  visibilityTone,
} from './lib.js';
export type {
  CalendarEntry,
  Favours,
  Objective,
  PageFilter,
  PageKind,
  PageListItem,
  RunProgress,
  SectionPatch,
  SectionVisibility,
} from './lib.js';

export { codexEventEffects, useCodexLive } from './live.js';
export type { CodexEffects } from './live.js';

export {
  codexKeys,
  useCalendar,
  useCampaignContacts,
  useContacts,
  useCreateContact,
  useCreatePage,
  useDeleteContact,
  useHandouts,
  useLinkTemplate,
  useLinkableTemplates,
  usePage,
  usePages,
  useRevealPage,
  useRoster,
  useRuns,
  useUnlinkTemplate,
  useUnresolvedLinks,
  useUpdateContact,
  useUpdatePage,
} from './api.js';
export type {
  CodexPage as CodexPageDto,
  ContactRecord,
  HandoutView,
  LinkReport,
  RunRecord,
  SectionView,
  TemplateLink,
  UnresolvedLink,
} from './api.js';
