/**
 * /c/:campaignId/gm/generator — the Opposition Kit (M10): starter archetype
 * library and template editor (FR10.1), seeded generation with locks (FR10.2)
 * and promote-to-template (FR10.3), and the encounter builder whose
 * party-aware THREAT READOUT recomputes as the levers move (FR10.4–10.6).
 *
 * The route is only the guard and the URL: everything the kit does lives in
 * `generator/GeneratorWorkspace`, so the panels can hand each other work
 * without the page shell knowing about it.
 */
import { useParams, useSearchParams } from 'react-router-dom';
import GeneratorWorkspace, { isTabId } from './generator/GeneratorWorkspace.js';
import { GmGuard } from './ui.js';

export default function GeneratorPage() {
  const { campaignId } = useParams<{ campaignId: string }>();
  // `?template=` is how a codex page hands its archetype over (FR5.6);
  // `?tab=library` is how anything can deep-link the cold start.
  const [search] = useSearchParams();
  const tab = search.get('tab');

  if (!campaignId) return null;

  return (
    <GmGuard>
      <GeneratorWorkspace
        campaignId={campaignId}
        linkedTemplateId={search.get('template') ?? undefined}
        initialTab={isTabId(tab) ? tab : undefined}
      />
    </GmGuard>
  );
}
