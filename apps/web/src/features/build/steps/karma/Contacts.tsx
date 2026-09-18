/**
 * Contacts bought at creation, from their own pool (FR3.9, docs/CHARGEN.md
 * §4.4 Step 8 "contacts, with their own pool of Charisma × 3 Karma: name,
 * role, Connection and Loyalty steppers, the 2-minimum and 7-maximum per
 * contact enforced").
 *
 * Each contact is a small card: name and role (the role becomes the contact
 * table's archetype on approval, §8.2), Connection and Loyalty steppers, and
 * notes. The pool is the engine's `contactKarma`, said above the cards; a
 * stepper quotes what its next point takes — free contact Karma while the
 * pool lasts, Karma after, which the engine answers by pricing the change —
 * and refuses the eighth point on one contact with the validator's sentence
 * and page before it is pressed. The floor of 2 is the contract's own
 * (Connection and Loyalty start at 1), so a contact can never be made below
 * it. The validator's findings on a contact (unnamed, over 7) sit on its card.
 */
import { useId } from 'react';
import { CONTACT_BOUNDS, type BuildContact, type Issue } from '@safehouse/contracts';
import { CREATION_CONTACT_RULES, type BuildTally } from '@safehouse/rules';
import LimitStepper from '../../components/LimitStepper.js';
import CostQuote from '../../kit/CostQuote.js';
import PoolLine from '../../kit/PoolLine.js';
import { contactQuote, withContactPatch, withNewContact, withoutContact } from './logic.js';
import { EmptyLine, IssueNotes, Section, TapButton, inputClass, labelClass } from './parts.js';
import type { ContactTap, KarmaSectionProps } from './taps.js';

export interface ContactsProps extends KarmaSectionProps {
  tally: BuildTally;
  /** Issues by contact index (`placeIssues(...).contacts`). */
  issues: ReadonlyMap<number, readonly Issue[]>;
}

/** What the next point on a contact takes, quoted against the pool that pays it. */
function PointQuote({ tap, step, id }: { tap: ContactTap; step: KarmaSectionProps['step']; id: string }) {
  if (!tap.gate.open) return null;
  const q = contactQuote(tap);
  return (
    <span id={id}>
      {q.lead ? `${q.lead} ` : ''}
      <CostQuote amount={q.amount} budgets={step.budgets} pool={q.pool} />
    </span>
  );
}

function ContactCard({
  contact,
  index,
  step,
  taps,
  readOnly,
  tally,
  issues,
}: ContactsProps & { contact: BuildContact; index: number }) {
  const nameId = useId();
  const roleId = useId();
  const notesId = useId();
  const quoteC = useId();
  const quoteL = useId();
  const title = contact.name.trim() || `Contact ${index + 1}`;
  const karma = tally.contactKarma[index] ?? 0;
  const patch = (p: Partial<BuildContact>) => step.update((b) => withContactPatch(b, index, p));
  const up = (field: 'connection' | 'loyalty') =>
    taps.contact((b) => withContactPatch(b, index, { [field]: contact[field] + 1 }), `${index}:${field}:${contact[field] + 1}`);
  const connection = up('connection');
  const loyalty = up('loyalty');
  return (
    <li className="space-y-2 py-3" data-testid="karma-contact">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
        <span className="font-label text-xs text-dim" data-testid="karma-contact-cost">
          {karma} contact Karma · at most {CREATION_CONTACT_RULES.maxKarmaPerContact}
        </span>
      </div>
      {readOnly ? (
        <p className="text-sm text-dim">
          {contact.role.trim() || 'no role'} · Connection {contact.connection} · Loyalty {contact.loyalty}
          {contact.notes?.trim() ? ` · ${contact.notes.trim()}` : ''}
        </p>
      ) : (
        <>
          <div className="grid gap-2 sm:grid-cols-2">
            <div>
              <label htmlFor={nameId} className={labelClass}>
                name
              </label>
              <input id={nameId} className={inputClass} value={contact.name} maxLength={200} onChange={(e) => patch({ name: e.target.value })} />
            </div>
            <div>
              <label htmlFor={roleId} className={labelClass}>
                role
              </label>
              <input
                id={roleId}
                className={inputClass}
                value={contact.role}
                maxLength={200}
                placeholder="fixer, bartender, fence…"
                onChange={(e) => patch({ role: e.target.value })}
              />
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-1">
              <span className="mono-label block" aria-hidden>
                Connection
              </span>
              <LimitStepper
                label={`Connection of ${title}`}
                hideLabel
                value={contact.connection}
                min={CREATION_CONTACT_RULES.minConnection}
                max={CONTACT_BOUNDS.connection.max}
                onChange={(v) => patch({ connection: v })}
                refuseIncrease={connection.gate.refusal}
                testId="karma-contact-connection"
              />
              <p className="text-xs text-dim">
                <PointQuote tap={connection} step={step} id={quoteC} />
              </p>
            </div>
            <div className="space-y-1">
              <span className="mono-label block" aria-hidden>
                Loyalty
              </span>
              <LimitStepper
                label={`Loyalty of ${title}`}
                hideLabel
                value={contact.loyalty}
                min={CREATION_CONTACT_RULES.minLoyalty}
                max={CONTACT_BOUNDS.loyalty.max}
                onChange={(v) => patch({ loyalty: v })}
                refuseIncrease={loyalty.gate.refusal}
                testId="karma-contact-loyalty"
              />
              <p className="text-xs text-dim">
                <PointQuote tap={loyalty} step={step} id={quoteL} />
              </p>
            </div>
          </div>
          <div>
            <label htmlFor={notesId} className={labelClass}>
              notes
            </label>
            <textarea
              id={notesId}
              className={`${inputClass} min-h-16`}
              value={contact.notes ?? ''}
              maxLength={4000}
              onChange={(e) => patch({ notes: e.target.value })}
            />
          </div>
        </>
      )}
      <IssueNotes issues={issues.get(index) ?? []} testId="karma-contact-issues" />
      {!readOnly && (
        <button
          type="button"
          className="btn px-3"
          aria-label={`remove ${title}`}
          data-testid="karma-contact-remove"
          onClick={() => step.update((b) => withoutContact(b, index))}
        >
          remove
        </button>
      )}
    </li>
  );
}

export default function Contacts(props: ContactsProps) {
  const { step, taps, readOnly } = props;
  const contacts = step.build.karma.contacts;
  const add = taps.contact(withNewContact, 'new');
  const addQuote = contactQuote(add);
  return (
    <Section
      title="Contacts"
      refValue={CREATION_CONTACT_RULES.ref}
      lead={`Contacts have a Karma pool of their own. Each costs its Connection plus its Loyalty, from ${CREATION_CONTACT_RULES.minKarmaPerContact} to ${CREATION_CONTACT_RULES.maxKarmaPerContact}; past the pool, they cost Karma.`}
      testId="karma-contacts"
    >
      <PoolLine budgets={step.budgets} pool="contactKarma" />
      {contacts.length === 0 ? (
        <EmptyLine>No contacts yet.</EmptyLine>
      ) : (
        <ul className="divide-y divide-edge/60" aria-label="Contacts">
          {contacts.map((c, i) => (
            <ContactCard key={i} {...props} contact={c} index={i} />
          ))}
        </ul>
      )}
      <TapButton
        label="add a contact"
        ariaLabel="add a contact at Connection 1 and Loyalty 1"
        gate={add.gate}
        price={addQuote.amount}
        pool={addQuote.pool}
        {...(addQuote.lead ? { quoteLead: addQuote.lead } : {})}
        budgets={step.budgets}
        readOnly={readOnly}
        testId="karma-add-contact"
        onPress={() => step.update(add.apply)}
      />
    </Section>
  );
}
