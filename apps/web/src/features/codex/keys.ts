/**
 * Query keys for the codex feature, in one place so `api.ts` (wiki, handouts),
 * `records.ts` (runs, calendar, contacts) and `live.ts` (socket → cache
 * invalidations) all name the same caches without importing each other.
 */
export const codexKeys = {
  pages: (campaignId: string) => ['codex', campaignId, 'pages'] as const,
  page: (pageId: string) => ['codex', 'page', pageId] as const,
  unresolved: (campaignId: string) => ['codex', campaignId, 'unresolved'] as const,
  handouts: (campaignId: string) => ['codex', campaignId, 'handouts'] as const,
  runs: (campaignId: string) => ['codex', campaignId, 'runs'] as const,
  run: (runId: string) => ['codex', 'run', runId] as const,
  calendar: (campaignId: string) => ['codex', campaignId, 'calendar'] as const,
  contacts: (characterId: string) => ['codex', 'contacts', characterId] as const,
  campaignContacts: (campaignId: string) => ['codex', campaignId, 'contacts'] as const,
};
