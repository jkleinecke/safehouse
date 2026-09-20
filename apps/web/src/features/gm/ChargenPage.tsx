/**
 * `/c/:campaignId/gm/chargen` — how runners are built in this campaign
 * (FR3.9, docs/CHARGEN.md §3, §8.3).
 *
 * The panel used to sit inline on the GM console, where it was the tallest
 * thing on the page and the least often touched: creation rules are set once
 * when a campaign starts and then left alone for months, while the console
 * around them is read every session. It is now its own screen, reached from a
 * button on the console and from the sidebar, so the overview stays the
 * at-a-glance page it is meant to be.
 *
 * The panel itself is unchanged — same component, same form, same save. It is
 * loaded lazily here rather than statically imported, so the builder's engine
 * stays out of the console's chunk exactly as it did before
 * (`router.chunks.test.ts`).
 */
import { lazy, Suspense } from 'react';
import { Link, useParams } from 'react-router-dom';
import { GmGuard, SectionTitle, Spinner } from './ui.js';

const ChargenSettingsPanel = lazy(() => import('../build/settings/ChargenSettingsPanel.js'));

export default function ChargenPage() {
  const { campaignId } = useParams<{ campaignId: string }>();
  if (!campaignId) return null;
  return (
    <GmGuard>
      <div className="p-6">
        <SectionTitle>Character creation</SectionTitle>
        <h1 className="mt-1 text-lg font-semibold">How runners are built here</h1>
        <p className="mt-1 max-w-2xl text-sm text-dim">
          The creation level and the caps it presets, which printing of the priority table, which of
          the table's shared books the builder draws on, and the optional rules. Every walkthrough
          on every device reads these; builds already under way are checked against them the next
          time they open.
        </p>

        <div className="mt-4 max-w-2xl">
          <Suspense
            fallback={
              <div className="panel p-4">
                <Spinner label="loading creation settings" />
              </div>
            }
          >
            <ChargenSettingsPanel campaignId={campaignId} />
          </Suspense>
        </div>

        <p className="mono-label mt-4 text-faint">
          <Link className="text-cyan hover:underline" to={`/c/${campaignId}/build`}>
            runners being built
          </Link>{' '}
          ·{' '}
          <Link className="text-cyan hover:underline" to={`/c/${campaignId}/gm`}>
            back to the console
          </Link>
        </p>
      </div>
    </GmGuard>
  );
}
