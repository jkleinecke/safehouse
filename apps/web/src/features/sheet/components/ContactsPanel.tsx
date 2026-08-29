/**
 * The character's contacts (FR3.2 tab, FR5.8 data) — Connection, Loyalty,
 * favours owed and owing, and the codex page the contact actually is.
 *
 * There is a second `ContactsPanel` under `features/codex/` — the GM's
 * cross-table roster, which lists whose contact each one is and is edited in
 * place. This is the phone's: one character's contacts, read-only, sized for
 * a thumb. They take the same props deliberately, so if the two ever do
 * converge the import is the only line that changes.
 *
 * Read-only by design: contacts are the campaign's, and the codex owns editing
 * them. Everything shown here came through an owner-or-GM check on the server
 * (Principle 4) — this component never filters anything itself.
 */
import type { ContactRecord } from '../contacts.js';
import { contactLabel } from '../a11y.js';
import { Empty, SectionLabel } from './ui.js';

export interface ContactsPanelProps {
  contacts: readonly ContactRecord[];
  isPending?: boolean;
  error?: unknown;
  /** Open the linked codex page, when the app has a codex route for it. */
  onOpenPage?: (pageId: string) => void;
}

function favourLine(c: ContactRecord): string | null {
  const parts: string[] = [];
  if (c.favours.owed > 0) parts.push(`owes you ${c.favours.owed}`);
  if (c.favours.owing > 0) parts.push(`you owe ${c.favours.owing}`);
  return parts.length > 0 ? parts.join(' · ') : null;
}

export default function ContactsPanel({
  contacts,
  isPending,
  error,
  onOpenPage,
}: ContactsPanelProps) {
  if (isPending) return <Empty>Loading contacts…</Empty>;
  if (error) {
    const message =
      error instanceof Error ? error.message : 'Contacts could not be loaded.';
    return (
      <p className="py-4 text-center text-sm text-danger" role="alert">
        {message}
      </p>
    );
  }
  if (contacts.length === 0) {
    return <Empty>No contacts on file yet — the GM adds them from the codex.</Empty>;
  }

  return (
    <ul className="divide-y divide-edge/60">
      {contacts.map((c) => {
        const favours = favourLine(c);
        return (
          <li key={c.id} className="py-2.5">
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm text-ink">{c.name}</div>
                <div className="mono-label truncate">{c.archetype || 'contact'}</div>
              </div>
              <span
                className="chip shrink-0 text-cyan"
                aria-label={`Connection ${c.connection}`}
              >
                C{c.connection}
              </span>
              <span className="chip shrink-0 text-warn" aria-label={`Loyalty ${c.loyalty}`}>
                L{c.loyalty}
              </span>
            </div>
            <span className="sr-only">{contactLabel(c)}</span>
            {favours && <div className="mono-label mt-0.5 text-warn">favours: {favours}</div>}
            {c.notes && (
              <p className="mt-1 whitespace-pre-wrap text-xs text-dim">{c.notes}</p>
            )}
            {c.npcPageId && onOpenPage && (
              <button
                type="button"
                className="chip mt-1.5 text-faint hover:border-cyan hover:text-cyan"
                onClick={() => onOpenPage(c.npcPageId as string)}
                aria-label={`Open the codex page for ${c.name}`}
              >
                Codex page
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Header line for the tab: how many, and who owes whom. */
export function ContactsSummary({ contacts }: { contacts: readonly ContactRecord[] }) {
  const owed = contacts.reduce((n, c) => n + c.favours.owed, 0);
  const owing = contacts.reduce((n, c) => n + c.favours.owing, 0);
  return (
    <SectionLabel>
      Contacts — {contacts.length}
      {owed > 0 ? ` · ${owed} owed to you` : ''}
      {owing > 0 ? ` · ${owing} you owe` : ''}
    </SectionLabel>
  );
}
