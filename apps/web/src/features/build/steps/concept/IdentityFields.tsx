/**
 * Step 1's identity fields — alias, real name, age, sex (FR3.9,
 * docs/CHARGEN.md §4.4 Step 1 "Complete when: an alias exists").
 *
 * The alias is the only thing that holds Next shut on this step, so the field
 * says so before the player reaches Next: it is marked required, and while
 * the validator's `alias-missing` stands its sentence and page sit under the
 * field, tied to it with `aria-describedby` and marked invalid — in words,
 * not a red border alone. The other three are optional and say nothing.
 *
 * Every keystroke is a pure field set through `onEdit` (`./identity.ts`), so
 * the frame's gate and the header's alias follow the typing on the same
 * render, and the record is never copied into local state. Read-only viewers
 * (a submitted build, the GM's review) get the same four lines as a
 * definition list rather than inputs that would silently do nothing.
 *
 * One column on a phone, two from `sm`; inputs reach 40 px on touch.
 */
import { useId } from 'react';
import type { BuildIdentity, CharacterBuild, Issue } from '@safehouse/contracts';
import { RefChip } from '../../../gm/books/RefChip.js';
import { inputClass } from '../../../gm/ui.js';
import {
  AGE_MAX_DIGITS,
  IDENTITY_TEXT_MAX,
  ageText,
  identityLines,
  setIdentityAge,
  setIdentityText,
  type IdentityTextField,
} from './identity.js';

export interface IdentityFieldsProps {
  identity: BuildIdentity;
  /** The validator's `alias-missing`, while it stands. */
  aliasIssue: Issue | null;
  readOnly: boolean;
  onEdit: (fn: (build: CharacterBuild) => CharacterBuild) => void;
}

const FIELD_CLASS = `${inputClass} pointer-coarse:min-h-10`;

export default function IdentityFields({ identity, aliasIssue, readOnly, onEdit }: IdentityFieldsProps) {
  const id = useId();
  const headingId = `${id}-heading`;

  if (readOnly) {
    return (
      <section aria-labelledby={headingId} className="space-y-2" data-testid="concept-identity" data-editable="no">
        <h2 id={headingId} className="mono-label text-cyan">
          Who the runner is
        </h2>
        <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {identityLines(identity).map((line) => (
            <div key={line.field} className="min-w-0" data-field={line.field}>
              <dt className="mono-label text-faint">{line.label}</dt>
              <dd className="break-words text-sm text-ink">{line.value}</dd>
            </div>
          ))}
        </dl>
      </section>
    );
  }

  const text = (field: IdentityTextField) => (event: { target: { value: string } }) => {
    const raw = event.target.value;
    onEdit((b) => setIdentityText(b, field, raw));
  };
  const aliasHint = `${id}-alias-hint`;
  const aliasWhy = `${id}-alias-why`;

  return (
    <section aria-labelledby={headingId} className="space-y-2" data-testid="concept-identity" data-editable="yes">
      <h2 id={headingId} className="mono-label text-cyan">
        Who the runner is
      </h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="min-w-0 sm:col-span-2">
          <label htmlFor={`${id}-alias`} className="mono-label block">
            Alias <span className="text-faint normal-case">(needed)</span>
          </label>
          <input
            id={`${id}-alias`}
            type="text"
            className={`mt-1 ${FIELD_CLASS}`}
            value={identity.alias}
            maxLength={IDENTITY_TEXT_MAX}
            autoComplete="off"
            spellCheck={false}
            required
            aria-required="true"
            {...(aliasIssue ? { 'aria-invalid': true } : {})}
            aria-describedby={aliasIssue ? `${aliasHint} ${aliasWhy}` : aliasHint}
            onChange={text('alias')}
            data-testid="concept-alias"
          />
          <p id={aliasHint} className="mt-1 text-xs text-dim">
            The name the table calls this runner.
          </p>
          {aliasIssue && (
            <p className="mt-1 flex items-baseline gap-1.5 text-xs text-warn" data-testid="concept-alias-issue">
              <span aria-hidden className="shrink-0">
                !
              </span>
              <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 gap-y-1">
                <span id={aliasWhy}>{aliasIssue.message}</span>
                <RefChip refValue={aliasIssue.ref} className="pointer-coarse:min-h-10" />
              </span>
            </p>
          )}
        </div>
        <div className="min-w-0">
          <label htmlFor={`${id}-real`} className="mono-label block">
            Real name
          </label>
          <input
            id={`${id}-real`}
            type="text"
            className={`mt-1 ${FIELD_CLASS}`}
            value={identity.realName ?? ''}
            maxLength={IDENTITY_TEXT_MAX}
            autoComplete="off"
            onChange={text('realName')}
            data-testid="concept-real-name"
          />
        </div>
        <div className="grid min-w-0 grid-cols-2 gap-3">
          <div className="min-w-0">
            <label htmlFor={`${id}-age`} className="mono-label block">
              Age
            </label>
            <input
              id={`${id}-age`}
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              className={`mt-1 ${FIELD_CLASS}`}
              value={ageText(identity.age)}
              maxLength={AGE_MAX_DIGITS}
              autoComplete="off"
              onChange={(event) => {
                const raw = event.target.value;
                onEdit((b) => setIdentityAge(b, raw));
              }}
              data-testid="concept-age"
            />
          </div>
          <div className="min-w-0">
            <label htmlFor={`${id}-sex`} className="mono-label block">
              Sex
            </label>
            <input
              id={`${id}-sex`}
              type="text"
              className={`mt-1 ${FIELD_CLASS}`}
              value={identity.sex ?? ''}
              maxLength={IDENTITY_TEXT_MAX}
              autoComplete="off"
              onChange={text('sex')}
              data-testid="concept-sex"
            />
          </div>
        </div>
      </div>
    </section>
  );
}
