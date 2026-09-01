/**
 * The generator's cold start (M10 / G9).
 *
 * A fresh campaign has no archetypes, and the old panel expressed that as a
 * disabled select reading "— no archetypes yet —": true, useless, and the
 * exact moment a GM concludes the generator is broken. This says what an
 * archetype is in one line and puts the two ways forward under the cursor —
 * install the shipped library, or author one.
 */
import { ErrorNote, SectionTitle, Spinner } from '../ui.js';
import { libraryUnavailable, useInstallStarters, useStarterLibrary } from './starters.js';

export interface GeneratorEmptyStateProps {
  campaignId: string;
  /** Opens the library browser (pick individually, read what each is for). */
  onBrowseLibrary?: (() => void) | undefined;
  /** Opens the archetype editor on a blank draft. */
  onCreateOwn?: (() => void) | undefined;
  onInstalled?: () => void;
  /** Softer framing for the editor pane, which already has its own heading. */
  compact?: boolean;
}

export default function GeneratorEmptyState({
  campaignId,
  onBrowseLibrary,
  onCreateOwn,
  onInstalled,
  compact,
}: GeneratorEmptyStateProps) {
  const library = useStarterLibrary(campaignId);
  const install = useInstallStarters(campaignId);
  const count = library.data?.length ?? 0;
  const unavailable = libraryUnavailable(library.error);

  return (
    <div className={compact ? 'space-y-3' : 'panel space-y-4 p-6'}>
      {!compact && (
        <SectionTitle hint="FR10.1 — nothing here is a book stat block">
          No archetypes in this campaign yet
        </SectionTitle>
      )}

      <p className="text-sm text-dim">
        An <span className="text-ink">archetype</span> is a reusable recipe the generator rolls
        inside — role tags, a tier ladder from street to prime, and the attribute, skill and gear
        ranges each tier samples. Install one and you are two clicks from a statted, playable NPC.
      </p>

      {library.isLoading && <Spinner label="checking the starter library" />}

      <div className="flex flex-wrap items-center gap-3">
        {!unavailable && (
          <button
            className="btn btn-accent px-4 py-2"
            disabled={install.isPending || library.isLoading || count === 0}
            onClick={() => install.mutate({}, { onSuccess: () => onInstalled?.() })}
          >
            {install.isPending
              ? 'installing…'
              : count > 0
                ? `install the starter library (${count} archetypes)`
                : 'install the starter library'}
          </button>
        )}
        {!unavailable && count > 0 && onBrowseLibrary && (
          <button className="btn px-3 py-1.5" onClick={onBrowseLibrary}>
            browse it first
          </button>
        )}
        {onCreateOwn && (
          <button className="btn px-3 py-1.5" onClick={onCreateOwn}>
            create my own
          </button>
        )}
      </div>

      {unavailable ? (
        <p className="text-sm text-warn">
          This server build has no starter library yet — author an archetype in the editor and the
          generator picks it up immediately.
        </p>
      ) : (
        <ErrorNote error={library.error} />
      )}
      <ErrorNote error={install.error} />

      <p className="mono-label text-faint">
        installed copies belong to this campaign — fully editable, renameable, deletable
      </p>
    </div>
  );
}
