/**
 * Contacts tab (FR3.2 — the missing sixth tab; BUILD_REPORT §4.9).
 *
 * The sheet already called `GET /api/characters/:id/contacts` from a corner of
 * the Background tab, against a route that 404'd. The route exists now
 * (`plugins/contacts.ts`), so the little black book gets the tab the FR asks
 * for: who they know, how far each one's reach goes, how far they will stick
 * their neck out, and who owes whom.
 */
import { useContacts } from '../contacts.js';
import ContactsPanel, { ContactsSummary } from '../components/ContactsPanel.js';
import type { TabProps } from './shared.js';

export default function ContactsTab({ character }: TabProps) {
  const { data: contacts = [], isPending, error } = useContacts(character.id);

  return (
    <div className="p-4">
      <ContactsSummary contacts={contacts} />
      <ContactsPanel
        contacts={contacts}
        isPending={isPending}
        {...(error ? { error } : {})}
      />
      <p className="mt-4 text-xs text-faint">
        Contacts are shared with the GM and nobody else at the table (FR5.8).
      </p>
    </div>
  );
}
