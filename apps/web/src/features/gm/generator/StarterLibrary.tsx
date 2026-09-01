/**
 * The starter archetype library browser (M10 cold start, G9/D10).
 *
 * Reads as a shelf, not a dropdown: every entry says what it is FOR at the
 * table, which roles it covers and how far its tier ladder climbs, so the GM
 * picks by intent instead of by name. Install all of it or one row at a time —
 * either way the copies land in this campaign as ordinary editable data.
 *
 * ORIGINAL CONTENT (§14): the catalog is the server's own writing; nothing
 * here transcribes a published stat block or archetype name.
 */
import type { NpcTemplate } from '@safehouse/contracts';
import { ErrorNote, SectionTitle, Spinner } from '../ui.js';
import {
  installedStarterKeys,
  libraryUnavailable,
  missingStarterKeys,
  tierLadder,
  useInstallStarters,
  useStarterLibrary,
  type StarterArchetype,
} from './starters.js';

export interface StarterLibraryProps {
  campaignId: string;
  /** The campaign's current archetypes — decides what reads as installed. */
  templates: readonly NpcTemplate[];
  onInstalled?: (installed: NpcTemplate[]) => void;
  /** "Duplicate and edit" out of the library into the archetype editor. */
  onEditTemplate?: (tpl: NpcTemplate) => void;
  onCreateOwn?: () => void;
}

function RoleTags({ tags }: { tags: readonly string[] }) {
  if (tags.length === 0) return null;
  return (
    <>
      {tags.map((t) => (
        <span key={t} className="chip text-dim">
          {t}
        </span>
      ))}
    </>
  );
}

function StarterRow({
  entry,
  installed,
  row,
  onInstall,
  onEdit,
  busy,
}: {
  entry: StarterArchetype;
  installed: boolean;
  /** The campaign row, when it can be identified — enables "open in editor". */
  row: NpcTemplate | undefined;
  onInstall: () => void;
  onEdit?: (() => void) | undefined;
  busy: boolean;
}) {
  const ladder = tierLadder(entry);
  // A GM who renamed their copy still owns it (the server matches on the
  // starterId stamp, not the name), so say which row it became.
  const renamed =
    entry.installedAs && entry.installedAs.trim().toLowerCase() !== entry.name.trim().toLowerCase()
      ? entry.installedAs
      : null;
  return (
    <li className="rounded-md border border-edge bg-deck p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-base font-semibold text-ink">{entry.name}</span>
        <RoleTags tags={entry.roleTags} />
        {installed && (
          <span className="chip border-ok/40 text-ok">
            {renamed ? `installed as "${renamed}"` : 'installed'}
          </span>
        )}
        <span className="ml-auto flex gap-2">
          {row && onEdit && (
            <button className="btn px-3 py-1.5" onClick={onEdit}>
              open in editor
            </button>
          )}
          <button
            className={`btn px-3 py-1.5 ${installed ? '' : 'btn-accent'}`}
            disabled={busy}
            onClick={onInstall}
            title={
              installed
                ? 'Install a second, unmodified copy — your edited one is untouched'
                : `Copy ${entry.name} into this campaign`
            }
          >
            {installed ? 'install another copy' : 'install'}
          </button>
        </span>
      </div>
      {entry.summary && <p className="mt-2 text-sm text-dim">{entry.summary}</p>}
      {ladder && (
        <p className="mono-label mt-2 text-faint">
          tier ladder: {ladder} ({entry.tiers.length})
        </p>
      )}
    </li>
  );
}

export default function StarterLibrary({
  campaignId,
  templates,
  onInstalled,
  onEditTemplate,
  onCreateOwn,
}: StarterLibraryProps) {
  const library = useStarterLibrary(campaignId);
  const install = useInstallStarters(campaignId);
  const catalog = library.data ?? [];
  const installedKeys = installedStarterKeys(catalog, templates);
  const missing = missingStarterKeys(catalog, templates);
  const byId = new Map(templates.map((t) => [t.id, t]));
  const byName = new Map(templates.map((t) => [t.name.trim().toLowerCase(), t]));

  /**
   * The row this entry actually installed as. `templateId` is the server's
   * answer and survives a rename; the name lookup is the fallback for a build
   * that does not send it. Either way the result is a real template from the
   * campaign list, so "open in editor" always opens something that exists.
   */
  const rowFor = (entry: StarterArchetype): NpcTemplate | undefined =>
    (entry.templateId ? byId.get(entry.templateId) : undefined) ??
    (installedKeys.has(entry.key) ? byName.get(entry.name.trim().toLowerCase()) : undefined);

  const run = (keys?: string[]) =>
    install.mutate(keys ? { keys } : {}, { onSuccess: (rows) => onInstalled?.(rows) });

  return (
    <div className="panel space-y-4 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <SectionTitle hint="FR10.1 — original archetypes, not book stat blocks">
          Starter library
        </SectionTitle>
      </div>

      <p className="text-sm text-dim">
        Each of these is a generation recipe: role tags, a tier ladder, and the attribute, skill
        and gear ranges the engine rolls inside. Installing copies them into this campaign, where
        they are yours — rename them, retune every range, delete the ones you never use.
      </p>

      {library.isLoading && <Spinner label="loading the library" />}

      {libraryUnavailable(library.error) ? (
        <p className="text-sm text-warn">
          This server build has no starter library yet. You can still author an archetype by hand —
          the editor has every dial the generator reads.
        </p>
      ) : (
        <ErrorNote error={library.error} />
      )}

      {catalog.length > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          <button
            className="btn btn-accent px-3 py-1.5"
            disabled={install.isPending || missing.length === 0}
            onClick={() => run(missing)}
          >
            {missing.length === 0
              ? 'whole library installed'
              : `install all ${missing.length} archetype${missing.length === 1 ? '' : 's'}`}
          </button>
          {onCreateOwn && (
            <button className="btn px-3 py-1.5" onClick={onCreateOwn}>
              create my own instead
            </button>
          )}
          {install.isPending && <Spinner label="installing" />}
          <span className="mono-label text-faint">
            {installedKeys.size} of {catalog.length} installed
          </span>
        </div>
      )}

      <ErrorNote error={install.error} />

      <ul className="space-y-2">
        {catalog.map((entry) => {
          const tpl = rowFor(entry);
          return (
            <StarterRow
              key={entry.key}
              entry={entry}
              installed={installedKeys.has(entry.key)}
              row={tpl}
              busy={install.isPending}
              onInstall={() => run([entry.key])}
              onEdit={tpl && onEditTemplate ? () => onEditTemplate(tpl) : undefined}
            />
          );
        })}
      </ul>

      {!library.isLoading && catalog.length === 0 && !library.error && (
        <p className="text-sm text-dim">
          The library came back empty. Author an archetype in the editor — that is the same data
          the library ships.
        </p>
      )}
    </div>
  );
}
