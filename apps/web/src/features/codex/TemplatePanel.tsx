/**
 * FR5.6 — the archetype templates a codex page is the entry for.
 *
 * A GM writing up "The Rusting Crown" wants the page and the opposition to be
 * the same object: read the faction, then roll three of its enforcers without
 * hunting through the Opposition Kit for a name they half remember. This panel
 * is that join — the page shows its templates, follows them out to the
 * generator, and claims new ones.
 *
 * GM-only, and not because this hides a button: `page.templates` is simply
 * absent from a player's response (the server cuts it — Principle 4), so for a
 * player there is nothing to render and the panel returns null on its own.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ErrorNote } from '../gm/ui.js';
import {
  useLinkTemplate,
  useLinkableTemplates,
  useUnlinkTemplate,
  type CodexPage,
} from './api.js';
import {
  describeFollow,
  generatorPathFor,
  linkableTemplates,
  linkedTemplates,
  roleTagLine,
} from './templates.js';

export interface TemplatePanelProps {
  campaignId: string;
  page: CodexPage;
  isGm: boolean;
}

export default function TemplatePanel({ campaignId, page, isGm }: TemplatePanelProps) {
  const [picking, setPicking] = useState(false);
  const [choice, setChoice] = useState('');
  const link = useLinkTemplate(campaignId, page.id);
  const unlink = useUnlinkTemplate(campaignId, page.id);
  // Only asked for once the picker is open — the template list is GM prep
  // material and there is no reason to fetch it to render a read-only page.
  const pool = useLinkableTemplates(campaignId, isGm && picking);

  // A player's page carries no `templates` field at all; that absence, not a
  // role check, is what keeps the opposition off their screen.
  if (!isGm || page.templates === undefined) return null;

  const linked = linkedTemplates(page.templates, page.id);
  const options = linkableTemplates(pool.data, linked);
  const busy = link.isPending || unlink.isPending;

  return (
    <section className="panel p-3">
      <div className="mono-label text-cyan">Archetypes</div>

      {linked.length === 0 ? (
        <p className="mt-2 text-xs text-faint">
          No archetype points at this page yet. Link one and the page, its map pins and the
          generator all name the same thing.
        </p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {linked.map((t) => (
            <li key={t.templateId} className="flex flex-wrap items-center gap-1.5">
              <Link
                className="min-w-0 flex-1 truncate text-xs text-dim hover:text-cyan"
                to={generatorPathFor(campaignId, t.templateId)}
                aria-label={describeFollow(t)}
              >
                {t.name}
                {t.roleTags.length > 0 && (
                  <span className="mono-label ml-1.5 text-faint">{roleTagLine(t.roleTags)}</span>
                )}
              </Link>
              {t.hasPageRef && (
                <span className="mono-label text-faint" title="Also carries a book ref">
                  ref
                </span>
              )}
              <button
                type="button"
                className="chip cursor-pointer text-faint hover:border-danger hover:text-danger"
                disabled={busy}
                aria-label={`Unlink the ${t.name} archetype from this page`}
                onClick={() => unlink.mutate(t.templateId)}
              >
                unlink
              </button>
            </li>
          ))}
        </ul>
      )}

      {picking ? (
        <div className="mt-3 space-y-2">
          <select
            className="w-full rounded-md border border-edge bg-deck px-2.5 py-1.5 text-sm text-ink focus:border-cyan focus:outline-none"
            value={choice}
            onChange={(e) => setChoice(e.target.value)}
            aria-label="Archetype to link"
          >
            <option value="">— pick an archetype —</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
                {o.roleTags.length > 0 ? ` — ${roleTagLine(o.roleTags)}` : ''}
              </option>
            ))}
          </select>
          {pool.data && options.length === 0 && (
            <p className="text-xs text-faint">
              Every archetype in this campaign is already on this page. New ones are made in the
              opposition kit.
            </p>
          )}
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="btn btn-accent px-3 py-1.5"
              disabled={choice === '' || busy}
              onClick={() =>
                link.mutate(choice, {
                  onSuccess: () => {
                    setChoice('');
                    setPicking(false);
                  },
                })
              }
            >
              {link.isPending ? 'linking…' : 'link'}
            </button>
            <button type="button" className="btn px-3 py-1.5" onClick={() => setPicking(false)}>
              cancel
            </button>
          </div>
          {/* The column is singular by design (see templates.ts) — say so before
              the GM finds out by losing a link somewhere else. */}
          <p className="mono-label text-faint">
            An archetype belongs to one page. Linking one that already has a page moves it here.
          </p>
        </div>
      ) : (
        <button
          type="button"
          className="btn mt-3 w-full px-3 py-1.5"
          disabled={busy}
          onClick={() => setPicking(true)}
        >
          link an archetype
        </button>
      )}

      <ErrorNote error={link.error ?? unlink.error ?? pool.error} />
    </section>
  );
}
