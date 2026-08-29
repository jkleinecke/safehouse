/**
 * Contacts (FR5.8) — a reusable panel, exported for the character sheet's
 * Background area (that file belongs to the sheet agent; this component is the
 * codex feature's contribution to it).
 *
 * A contact is the character's own record: name, archetype, Connection and
 * Loyalty, notes, favours owed and owing, and an optional link to the codex
 * page the contact actually *is*. Read and write are owner-or-GM, enforced
 * server-side — another player's fixer, and the debt they owe him, are not
 * table-public.
 *
 * `readOnly` renders the same list without controls, for a sheet a device is
 * only looking at.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ErrorNote } from '../gm/ui.js';
import {
  useContacts,
  useCreateContact,
  useDeleteContact,
  useUpdateContact,
  type ContactRecord,
} from './api.js';
import { contactRating, favourLabel } from './lib.js';

const inputClass =
  'w-full rounded-md border border-edge bg-deck px-2.5 py-1.5 text-sm text-ink ' +
  'placeholder:text-faint focus:border-cyan focus:outline-none';

export interface ContactsPanelProps {
  characterId: string;
  /** Needed for `[[codex]]` links; omit and page links render as plain text. */
  campaignId?: string;
  /** Hide every control — a sheet the viewer may read but not edit. */
  readOnly?: boolean;
  /** Wrap in the feature's own panel chrome (default: yes). */
  bare?: boolean;
}

function FavourStepper({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  disabled?: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="mono-label">{label}</span>
      <button
        type="button"
        className="btn h-6 w-6 p-0"
        disabled={disabled || value <= 0}
        onClick={() => onChange(Math.max(0, value - 1))}
        aria-label={`decrease ${label}`}
      >
        −
      </button>
      <span className="w-4 text-center font-label text-xs text-ink">{value}</span>
      <button
        type="button"
        className="btn h-6 w-6 p-0"
        disabled={disabled}
        onClick={() => onChange(Math.min(99, value + 1))}
        aria-label={`increase ${label}`}
      >
        +
      </button>
    </span>
  );
}

function ContactRow({
  contact,
  characterId,
  campaignId,
  readOnly,
}: {
  contact: ContactRecord;
  characterId: string;
  campaignId?: string;
  readOnly?: boolean;
}) {
  const update = useUpdateContact(characterId);
  const remove = useDeleteContact(characterId);
  const [open, setOpen] = useState(false);

  const setFavours = (next: { owed: number; owing: number }) =>
    update.mutate({ contactId: contact.id, patch: { favours: next } });

  return (
    <li className="py-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="min-w-0 flex-1 text-left"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <span className="block truncate text-sm text-ink">{contact.name}</span>
          <span className="mono-label block truncate">
            {contact.archetype || 'contact'} · {favourLabel(contact.favours)}
          </span>
        </button>
        <span className="chip shrink-0 text-cyan" title="Connection / Loyalty">
          {contactRating(contact.connection, contact.loyalty)}
        </span>
      </div>

      {open && (
        <div className="mt-2 rounded-md border border-edge bg-deck p-2">
          {contact.notes && <p className="whitespace-pre-wrap text-xs text-dim">{contact.notes}</p>}
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <FavourStepper
              label="owes you"
              value={contact.favours.owed}
              disabled={readOnly || update.isPending}
              onChange={(n) => setFavours({ ...contact.favours, owed: n })}
            />
            <FavourStepper
              label="you owe"
              value={contact.favours.owing}
              disabled={readOnly || update.isPending}
              onChange={(n) => setFavours({ ...contact.favours, owing: n })}
            />
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {contact.npcPageId && campaignId && (
              <Link
                className="mono-label text-cyan hover:underline"
                to={`/c/${campaignId}/codex/${contact.npcPageId}`}
              >
                codex page →
              </Link>
            )}
            {!readOnly && (
              <button
                type="button"
                className="mono-label ml-auto text-faint hover:text-danger"
                disabled={remove.isPending}
                onClick={() => remove.mutate(contact.id)}
              >
                remove
              </button>
            )}
          </div>
          <ErrorNote error={update.error ?? remove.error} />
        </div>
      )}
    </li>
  );
}

export default function ContactsPanel({
  characterId,
  campaignId,
  readOnly,
  bare,
}: ContactsPanelProps) {
  const contacts = useContacts(characterId);
  const create = useCreateContact(characterId);
  const [name, setName] = useState('');
  const [archetype, setArchetype] = useState('');
  const [connection, setConnection] = useState('1');
  const [loyalty, setLoyalty] = useState('1');

  const rows = contacts.data ?? [];

  const body = (
    <>
      {contacts.isLoading && <p className="py-3 text-sm text-faint">Loading contacts…</p>}
      {!contacts.isLoading && rows.length === 0 && (
        <p className="py-3 text-sm text-faint">
          No contacts on file. Add the fixer, the doc, the guy who owes you.
        </p>
      )}
      <ul className="divide-y divide-edge/60">
        {rows.map((c) => (
          <ContactRow
            key={c.id}
            contact={c}
            characterId={characterId}
            {...(campaignId ? { campaignId } : {})}
            {...(readOnly ? { readOnly } : {})}
          />
        ))}
      </ul>

      {!readOnly && (
        <form
          className="mt-3 space-y-2 border-t border-edge pt-3"
          onSubmit={(e) => {
            e.preventDefault();
            const trimmed = name.trim();
            if (!trimmed) return;
            const c = Number.parseInt(connection, 10);
            const l = Number.parseInt(loyalty, 10);
            create.mutate(
              {
                name: trimmed,
                archetype: archetype.trim(),
                connection: Number.isFinite(c) ? Math.min(12, Math.max(1, c)) : 1,
                loyalty: Number.isFinite(l) ? Math.min(6, Math.max(1, l)) : 1,
              },
              {
                onSuccess: () => {
                  setName('');
                  setArchetype('');
                },
              },
            );
          }}
        >
          <div className="flex gap-2">
            <input
              className={inputClass}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="name"
              aria-label="Contact name"
            />
            <input
              className={inputClass}
              value={archetype}
              onChange={(e) => setArchetype(e.target.value)}
              placeholder="archetype"
              aria-label="Contact archetype"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5">
              <span className="mono-label">Connection</span>
              <input
                className={`${inputClass} w-16`}
                value={connection}
                onChange={(e) => setConnection(e.target.value)}
                inputMode="numeric"
                aria-label="Connection rating (1-12)"
              />
            </label>
            <label className="flex items-center gap-1.5">
              <span className="mono-label">Loyalty</span>
              <input
                className={`${inputClass} w-16`}
                value={loyalty}
                onChange={(e) => setLoyalty(e.target.value)}
                inputMode="numeric"
                aria-label="Loyalty rating (1-6)"
              />
            </label>
            <button
              className="btn btn-accent ml-auto shrink-0 px-3 py-1.5"
              type="submit"
              disabled={create.isPending}
            >
              {create.isPending ? '…' : 'add contact'}
            </button>
          </div>
          <ErrorNote error={create.error} />
        </form>
      )}
      <ErrorNote error={contacts.error} />
    </>
  );

  if (bare) return body;
  return (
    <section className="panel p-3">
      <div className="mono-label text-cyan">Contacts (FR5.8)</div>
      {body}
    </section>
  );
}
