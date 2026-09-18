/**
 * "Character creation" on the GM console — how runners are built in this
 * campaign (FR3.9, docs/CHARGEN.md §3 "Sourcebook toggles, house-rule
 * options", §8.3 `ChargenSettingsSchema`, §8.5 `GET`/`PUT
 * /api/campaigns/:id/chargen`).
 *
 * The builder reads the campaign's creation settings on every step, and until
 * this panel nothing in the app could change them: every campaign ran
 * experienced, on the core table, with every shared book open and every
 * optional rule off. The GM now sets, in one place beside the other campaign
 * settings:
 *
 * - the creation level, as three cards that each carry the numbers the level
 *   moves (starting Karma, the quality cap, the Availability and device caps,
 *   Karma into nuyen, contact Karma) rather than a word;
 * - which printing of the priority table, with the one row where they differ;
 * - the four caps a level presets — highest Availability, highest device
 *   rating, Karma and nuyen carried into play — each beside the level's own
 *   number and a "reset to level" that makes it follow the level again;
 * - which of the table's shared books the builder draws on (none ticked is
 *   all of them);
 * - Sum to Ten, metavariants, the street/prime quality-cap reading,
 *   Uncouth/Uneducated doubling priority points, and AI drafts — shut, with
 *   the way to turn AI on, while the campaign has no AI.
 *
 * A save sends only what changed and the server merges it, so another
 * device's change to a different setting survives this one; picking another
 * level moves the untouched caps to that level's numbers on screen, exactly as
 * the server will store them, and the panel says which caps move and which the
 * GM kept (`chargenSettings.ts` has the rules). Builds already under way are
 * not rewritten: the walkthrough checks them against the new settings the next
 * time it opens them, and the panel says so.
 *
 * `ChargenSettingsView` is stateless for `renderToStaticMarkup`; the default
 * export owns the queries and the edit. The console loads this file lazily, so
 * the builder's engine stays out of the console's own chunk
 * (`router.chunks.test.ts`).
 */
import { useId, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  CREATION_LEVELS,
  PRIORITY_TABLES,
  type ChargenSettings,
  type ChargenSettingsWrite,
} from '@safehouse/contracts';
import { BOOK_QUALITY_CAP, CREATION_LEVEL_PRESETS } from '@safehouse/rules';
import { useBooks } from '../../gm/books/api.js';
import { useAiSettings } from '../../gm/fixer/api.js';
import { ErrorNote, inputClass, Spinner } from '../../gm/ui.js';
import { useChargenSettings, useSaveChargenSettings } from '../api.js';
import ChoiceCards, { type Choice } from '../kit/ChoiceCards.js';
import WhyLink from '../kit/WhyLink.js';
import {
  CAP_FIELDS,
  FIELD_LABELS,
  LEVEL_NAMES,
  TABLE_NAMES,
  aiAvailability,
  aiDraftsEnabled,
  bookOptions,
  booksLine,
  capAtLevel,
  capError,
  formOf,
  formOutcome,
  formatCap,
  levelChangeNote,
  levelDefault,
  levelFigures,
  levelRef,
  resetCap,
  saveLine,
  tableLine,
  tableRef,
  toggleBook,
  withCapText,
  withLevel,
  withValues,
  type AiAvailability,
  type BookOption,
  type CapField,
  type ChargenForm,
  type FlagField,
} from './chargenSettings.js';

export interface ChargenSettingsViewProps {
  campaignId: string;
  /** What the campaign holds (the edit's starting point); undefined while loading or unreadable. */
  base: ChargenSettings | undefined;
  loading: boolean;
  loadError: unknown;
  /** The form as it stands; `formOf(base)` when nothing is being edited. */
  form: ChargenForm | null;
  /** The table's shared books, as toggles. */
  books: readonly BookOption[];
  booksLoading: boolean;
  ai: AiAvailability;
  saving: boolean;
  saveError: unknown;
  /** The last save went through and nothing has been edited since. */
  justSaved: boolean;
  onForm: (next: ChargenForm) => void;
  onSave: (write: ChargenSettingsWrite) => void;
  onDiscard: () => void;
}

/** One sentence per option, in our words: what turning it on does. */
const FLAG_COPY: Readonly<Record<FlagField, { title: string; detail: string }>> = {
  allowSumToTen: {
    title: 'Allow Sum to Ten',
    detail: 'Players may buy priorities with ten points, repeating a letter, instead of one of each from A to E.',
  },
  allowMetavariants: {
    title: 'Allow metavariants',
    detail: 'The metavariants and metasapients from Run Faster join the five metatypes on the metatype step.',
  },
  levelQualityCaps: {
    title: 'Level quality caps',
    detail:
      `Read the street and prime Karma maximums as the cap on positive and on negative qualities (${CREATION_LEVEL_PRESETS.street.qualityCap} and ${CREATION_LEVEL_PRESETS.prime.qualityCap}). ` +
      `Off, every level keeps the book's flat ${BOOK_QUALITY_CAP}.`,
  },
  uncouthDoublesPriorityPoints: {
    title: 'Uncouth and Uneducated double priority points',
    detail: 'Both qualities always double Karma costs; on, they also double the skill points spent on the skills they cover.',
  },
  aiDrafts: {
    title: 'AI drafts',
    detail:
      'A player (or you) describes a runner and the Fixer drafts a build from it. The draft is checked like any other and edited before anyone submits it.',
  },
};

/** The word in front of each printing's page chip. */
const TABLE_SHORT: Readonly<Record<(typeof PRIORITY_TABLES)[number], string>> = { sr5: 'core', rf: 'revised' };

function flagPatch(field: FlagField, on: boolean): Partial<Record<FlagField, boolean>> {
  const patch: Partial<Record<FlagField, boolean>> = {};
  patch[field] = on;
  return patch;
}

function CapInput({
  field,
  form,
  onForm,
}: {
  field: CapField;
  form: ChargenForm;
  onForm: (next: ChargenForm) => void;
}) {
  const id = useId();
  const inputId = `${id}-input`;
  const defaultId = `${id}-default`;
  const errorId = `${id}-error`;
  const level = form.values.level;
  const preset = levelDefault(level, field);
  const error = capError(form.capText[field]);
  const atLevel = capAtLevel(form, field);
  const label = FIELD_LABELS[field];
  return (
    <div className="min-w-0" data-cap={field} data-at-level={atLevel ? 'yes' : 'no'}>
      <label htmlFor={inputId} className="mono-label block">
        {label}
      </label>
      <div className="mt-1 flex items-center gap-2">
        <input
          id={inputId}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          className={`${inputClass} min-w-0 flex-1 ${error ? 'border-danger' : ''}`}
          value={form.capText[field]}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${defaultId} ${errorId}` : defaultId}
          onChange={(e) => onForm(withCapText(form, field, e.target.value))}
          data-testid={`chargen-cap-${field}`}
        />
        <button
          type="button"
          className="btn shrink-0 px-2.5 py-1.5"
          disabled={atLevel}
          aria-label={`Reset ${label} to ${LEVEL_NAMES[level]}'s ${formatCap(field, preset)}`}
          onClick={() => onForm(resetCap(form, field))}
        >
          reset to level
        </button>
      </div>
      <p id={defaultId} className="mt-1 text-xs text-faint">
        {LEVEL_NAMES[level]} default: {formatCap(field, preset)}
        {!atLevel && !error ? ' · this campaign sets its own' : ''}
      </p>
      {error && (
        <p id={errorId} className="mt-1 text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

function BookToggles({
  books,
  loading,
  campaignId,
  onToggle,
}: {
  books: readonly BookOption[];
  loading: boolean;
  campaignId: string;
  onToggle: (code: string, on: boolean) => void;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  return (
    <fieldset className="space-y-2" aria-describedby={hintId} data-testid="chargen-books">
      <legend className="mono-label text-cyan">Books</legend>
      <p id={hintId} className="text-xs text-dim">
        The books the builder lists gear, qualities, spells and powers from. Tick none and every book shared with the
        table is in.
      </p>
      {loading ? (
        <Spinner label="loading the library" />
      ) : books.length === 0 ? (
        <p className="text-sm text-dim">
          No books are shared with the table yet.{' '}
          <Link className="text-cyan underline" to={`/c/${campaignId}/books`}>
            open the library
          </Link>
        </p>
      ) : (
        <ul className="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
          {books.map((book) => (
            <li key={book.code} data-book={book.code} data-status={book.status}>
              <label className="flex min-h-10 cursor-pointer items-center gap-2 text-sm text-ink">
                <input
                  type="checkbox"
                  className="h-5 w-5 shrink-0 accent-cyan"
                  checked={book.checked}
                  onChange={(e) => onToggle(book.code, e.target.checked)}
                />
                <span className="chip shrink-0">{book.code}</span>
                <span className="min-w-0 break-words">
                  {book.title}
                  {book.status === 'gm-only' && <span className="text-warn"> · not shared, players cannot open it</span>}
                  {book.status === 'missing' && <span className="text-warn"> · no longer in the library</span>}
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
      {!loading && books.length > 0 && (
        <p className="text-xs text-faint" data-testid="chargen-books-line">
          {booksLine(books)}
        </p>
      )}
    </fieldset>
  );
}

function FlagToggle({
  field,
  checked,
  disabled,
  note,
  onChange,
}: {
  field: FlagField;
  checked: boolean;
  disabled: boolean;
  note?: ReactNode;
  onChange: (on: boolean) => void;
}) {
  const id = useId();
  const detailId = `${id}-detail`;
  const noteId = `${id}-note`;
  const copy = FLAG_COPY[field];
  return (
    <div className="min-w-0" data-flag={field} data-disabled={disabled ? 'yes' : 'no'}>
      <label className={`flex min-h-10 items-center gap-2 text-sm ${disabled ? 'cursor-not-allowed text-dim' : 'cursor-pointer text-ink'}`}>
        <input
          type="checkbox"
          className="h-5 w-5 shrink-0 accent-cyan"
          checked={checked}
          disabled={disabled}
          aria-describedby={note ? `${detailId} ${noteId}` : detailId}
          onChange={(e) => onChange(e.target.checked)}
          data-testid={`chargen-flag-${field}`}
        />
        {copy.title}
      </label>
      <p id={detailId} className="ml-7 text-xs text-dim">
        {copy.detail}
      </p>
      {note && (
        <p id={noteId} className="ml-7 mt-1 text-xs text-warn">
          {note}
        </p>
      )}
    </div>
  );
}

function aiNote(ai: AiAvailability, checked: boolean, campaignId: string): ReactNode {
  const link = (
    <Link className="text-cyan underline" to={`/c/${campaignId}/gm/ai`}>
      choose an AI
    </Link>
  );
  if (ai === 'off') {
    return checked ? (
      <>AI is off for this campaign, so nothing is drafted until you {link}. You can still turn this off.</>
    ) : (
      <>AI is off for this campaign, so there is nothing to draft with — {link} first.</>
    );
  }
  if (ai === 'checking') return 'Checking whether this campaign has an AI…';
  if (ai === 'unknown') return 'The AI settings could not be read; drafts only run while an AI is on.';
  return undefined;
}

export function ChargenSettingsView(props: ChargenSettingsViewProps) {
  const { campaignId, base, form, onForm } = props;
  const id = useId();
  const titleId = `${id}-title`;
  const levelHeadId = `${id}-level`;
  const tableHeadId = `${id}-table`;
  const tableNoteId = `${id}-table-note`;

  const header = (
    <>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h2 id={titleId} className="mono-label text-cyan">
          Character creation
        </h2>
        <div className="mono-label text-faint">how runners are built here</div>
      </div>
      <p className="mt-1 text-sm text-dim">
        The rules every build in this campaign is checked against. Players see the level and its numbers on the
        builder's first step; only you can change them.
      </p>
    </>
  );

  if (!base || !form) {
    return (
      <section className="panel p-4" aria-labelledby={titleId} data-testid="chargen-settings" data-state="unavailable">
        {header}
        <div className="mt-3">
          {props.loading ? (
            <Spinner label="loading creation settings" />
          ) : (
            <>
              <ErrorNote error={props.loadError ?? 'The creation settings could not be read.'} />
              <p className="mt-2 text-xs text-dim">They cannot be changed here until the server answers.</p>
            </>
          )}
        </div>
      </section>
    );
  }

  const values = form.values;
  const outcome = formOutcome(base, form);
  const dirty = outcome.changed.length > 0 || outcome.invalid.length > 0;
  const levelNote = levelChangeNote(base, form);

  const levelChoices: Choice<(typeof CREATION_LEVELS)[number]>[] = CREATION_LEVELS.map((level) => {
    const figures = levelFigures(level, values.levelQualityCaps);
    const karma = figures.find((f) => f.key === 'karma')!;
    return {
      value: level,
      title: LEVEL_NAMES[level],
      aside: `${karma.value} Karma`,
      detail: figures
        .filter((f) => f.key !== 'karma')
        .map((f) => `${f.label} ${f.value}`)
        .join(' · '),
    };
  });

  const tableChoices: Choice<(typeof PRIORITY_TABLES)[number]>[] = PRIORITY_TABLES.map((table) => ({
    value: table,
    title: TABLE_NAMES[table],
    aside: `${tableRef(table).book} p.${tableRef(table).page}`,
    detail: tableLine(table),
  }));

  return (
    <section
      className="panel p-4"
      aria-labelledby={titleId}
      data-testid="chargen-settings"
      data-state={dirty ? 'editing' : 'clean'}
    >
      {header}
      <form
        className="mt-4 space-y-5"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (outcome.canSave && !props.saving) props.onSave(outcome.write);
        }}
      >
        <div className="space-y-2" data-testid="chargen-level">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div id={levelHeadId} className="mono-label text-cyan">
              Creation level
            </div>
            <WhyLink refValue={levelRef(values.level)} />
          </div>
          <ChoiceCards
            label="Creation level"
            choices={levelChoices}
            value={values.level}
            onChange={(level) => onForm(withLevel(form, level, base))}
            columns={3}
            testId="chargen-level-cards"
          />
          {levelNote && (
            <p className="rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn" data-testid="chargen-level-note">
              {levelNote}
            </p>
          )}
        </div>

        <div className="space-y-2" data-testid="chargen-table">
          <div id={tableHeadId} className="mono-label text-cyan">
            Priority table
          </div>
          <ChoiceCards
            label="Priority table"
            describedBy={tableNoteId}
            choices={tableChoices}
            value={values.table}
            onChange={(table) => onForm(withValues(form, { table }))}
            columns={2}
            testId="chargen-table-cards"
          />
          <p id={tableNoteId} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-dim">
            <span>
              The two printings differ only in the technomancer's row; the core book's own worked technomancer follows
              the revised one.
            </span>
            {PRIORITY_TABLES.map((table) => (
              <WhyLink key={table} refValue={tableRef(table)} label={TABLE_SHORT[table]} />
            ))}
          </p>
        </div>

        <fieldset className="space-y-2" data-testid="chargen-caps">
          <legend className="mono-label text-cyan">Caps and carry-over</legend>
          <p className="text-xs text-dim">
            Each starts at the level's number. Type your own to run a house cap; it then stays put if you change the
            level.
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {CAP_FIELDS.map((field) => (
              <CapInput key={field} field={field} form={form} onForm={onForm} />
            ))}
          </div>
        </fieldset>

        <BookToggles
          books={props.books}
          loading={props.booksLoading}
          campaignId={campaignId}
          onToggle={(code, on) => onForm(withValues(form, { books: toggleBook(values.books, code, on) }))}
        />

        <fieldset className="space-y-2" data-testid="chargen-flags">
          <legend className="mono-label text-cyan">Options and house rules</legend>
          {(['allowSumToTen', 'allowMetavariants', 'levelQualityCaps', 'uncouthDoublesPriorityPoints'] as const).map((field) => (
            <FlagToggle
              key={field}
              field={field}
              checked={values[field]}
              disabled={false}
              onChange={(on) => onForm(withValues(form, flagPatch(field, on)))}
            />
          ))}
          <FlagToggle
            field="aiDrafts"
            checked={values.aiDrafts}
            disabled={!aiDraftsEnabled(props.ai, values.aiDrafts)}
            note={aiNote(props.ai, values.aiDrafts, campaignId)}
            onChange={(on) => onForm(withValues(form, { aiDrafts: on }))}
          />
        </fieldset>

        <p className="rounded-md border border-edge bg-deck/50 px-3 py-2 text-xs text-dim" data-testid="chargen-revalidate-note">
          Builds already under way are not changed by a save. Each is checked against these settings the next time it
          is opened, and anything they no longer allow shows on its issues list for the player to fix.
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="submit"
            className="btn btn-accent px-3 py-1.5"
            disabled={!outcome.canSave || props.saving}
            data-testid="chargen-save"
          >
            {props.saving ? 'saving…' : 'save creation settings'}
          </button>
          {dirty && (
            <button type="button" className="btn px-3 py-1.5" disabled={props.saving} onClick={props.onDiscard}>
              discard changes
            </button>
          )}
          <span
            role="status"
            aria-live="polite"
            className={`min-w-0 text-xs ${outcome.invalid.length > 0 ? 'text-danger' : props.justSaved && !dirty ? 'text-ok' : 'text-dim'}`}
            data-testid="chargen-save-line"
          >
            {props.saving ? '' : props.justSaved && !dirty ? 'Saved.' : saveLine(outcome)}
          </span>
        </div>
        <ErrorNote error={props.saveError} />
      </form>
    </section>
  );
}

/** The edit in progress: the settings it started from, and the form. */
interface Edit {
  base: ChargenSettings;
  form: ChargenForm;
}

export default function ChargenSettingsPanel({ campaignId }: { campaignId: string }) {
  const qc = useQueryClient();
  const settings = useChargenSettings(campaignId);
  const save = useSaveChargenSettings(campaignId);
  const library = useBooks(campaignId);
  const aiSettings = useAiSettings(campaignId);
  const [edit, setEdit] = useState<Edit | null>(null);

  // An edit diffs against the settings it started from, so a refetch landing
  // mid-edit does not turn the other device's change into one of "ours".
  const base = edit?.base ?? settings.data;
  const form = edit?.form ?? (settings.data ? formOf(settings.data) : null);
  const books = bookOptions(library.data ?? [], form?.values.books ?? []);

  return (
    <ChargenSettingsView
      campaignId={campaignId}
      base={base}
      loading={settings.isPending}
      loadError={settings.error}
      form={form}
      books={books}
      booksLoading={library.isPending}
      ai={aiAvailability(aiSettings.data, aiSettings.isPending, aiSettings.error)}
      saving={save.isPending}
      saveError={save.error}
      justSaved={save.isSuccess && edit === null}
      onForm={(next) => {
        if (!base) return;
        if (save.isSuccess || save.isError) save.reset();
        setEdit({ base, form: next });
      }}
      onSave={(write) =>
        save.mutate(write, {
          // The hook has already put the merged settings in the cache.
          onSuccess: () => {
            setEdit(null);
            // The builder's pickers read the allowed books server-side, and
            // their pages are cached a minute; a new list should not wait.
            if (write.books) void qc.invalidateQueries({ queryKey: ['catalogue'] });
          },
        })
      }
      onDiscard={() => {
        save.reset();
        setEdit(null);
      }}
    />
  );
}
