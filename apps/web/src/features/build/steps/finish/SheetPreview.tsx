/**
 * The runner as play will see it, on the Finish step and in the GM's review
 * (FR3.9, docs/CHARGEN.md §4.4 Step 9 "the full derived sheet as the player
 * will see it in play").
 *
 * It renders the compiled sheet and its derived character — `preview` from
 * the walkthrough's analysis, the same numbers the rail shows — through the
 * sheet feature's read-only pieces: every derived number is the sheet's own
 * `BreakdownButton`, so "why is my Automatics pool 11?" opens the same
 * receipt it will open at the table, and the page chips open the reader
 * over the page as the sheet's do. What it leaves out is everything that
 * acts: no roll rows, no tap-to-damage monitor boxes, no override editor (no
 * `override` is passed, so the breakdown sheet has none), no add-from-books.
 * A preview whose buttons silently did nothing would be worse than one that
 * shows numbers.
 *
 * Laid out as one column on a phone, with the two wide tables (skills,
 * weapons) each inside its own horizontal scroller so the page never scrolls
 * sideways; two columns of sections on a wide screen, and flowing down two
 * columns when printed (`print.ts`), which is what fits a runner on a page.
 *
 * A half-made record may not compile; the preview then says why in words
 * instead of showing numbers from an earlier draft.
 */
import { useId, type ReactNode } from 'react';
import type { CharacterBuild, PoolBreakdown, Ref } from '@safehouse/contracts';
import { BreakdownButton } from '../../../sheet/components/Provenance.js';
import { RefChip } from '../../../gm/books/RefChip.js';
import type { BuildPreview } from '../../analysis.js';
import { PRINT_HIDE_ATTR, PRINT_SHEET_ATTR } from './print.js';
import {
  armorLines,
  attributeCells,
  augmentLines,
  contactLines,
  gearLines,
  initiativeCells,
  knowledgeLines,
  lifestyleLines,
  limitCells,
  magicLines,
  monitorCells,
  openingLine,
  previewIdentity,
  qualityLines,
  skillLines,
  specialCells,
  weaponLines,
  type ItemLine,
  type MonitorCell,
  type ValueCell,
} from './preview.js';

export interface SheetPreviewProps {
  preview: BuildPreview;
  build: Pick<CharacterBuild, 'identity'>;
  /**
   * Where the background shows inside the sheet: `always` (a read-only
   * screen), `print` (the editable screen has its own box, so only the
   * printout carries it), or `none`.
   */
  background?: 'always' | 'print' | 'none';
  /** The print button; absent, none is offered. */
  onPrint?: () => void;
  /** Section heading (an h2). */
  title?: string;
  testId?: string;
}

const PRINT_ATTRS = { [PRINT_SHEET_ATTR]: '' };
const HIDE_ATTRS = { [PRINT_HIDE_ATTR]: '' };

/** A derived number, read-only, sized for a thumb on a touch screen. */
function ValueButton({ cell, className }: { cell: Pick<ValueCell, 'name' | 'value' | 'breakdown' | 'text'>; className?: string }) {
  return (
    <BreakdownButton
      title={cell.name}
      value={cell.value}
      breakdown={cell.breakdown}
      className={
        className ??
        'inline-flex min-h-8 items-center justify-center rounded border border-edge bg-raised px-2 font-label text-sm text-cyan pointer-coarse:min-h-10 pointer-coarse:min-w-10'
      }
    >
      {cell.text}
    </BreakdownButton>
  );
}

function PoolNumber({ name, pool }: { name: string; pool: PoolBreakdown | null }) {
  if (!pool) return <span className="text-faint">—</span>;
  return (
    <BreakdownButton
      title={`${name} pool`}
      value={pool.total}
      breakdown={pool.breakdown}
      {...(pool.limit ? { limit: pool.limit } : {})}
      className="inline-flex min-h-8 min-w-8 items-center justify-center rounded border border-edge bg-raised px-2 font-label text-sm text-cyan pointer-coarse:min-h-10 pointer-coarse:min-w-10"
    >
      {pool.total}
    </BreakdownButton>
  );
}

/**
 * One section of the sheet. `wide` spans both columns on a wide screen (the
 * attribute row, the tables); on paper every section flows down two columns
 * and is kept whole.
 */
function Block({ title, children, testId, wide = false }: { title: string; children: ReactNode; testId?: string; wide?: boolean }) {
  const id = useId();
  return (
    <section
      aria-labelledby={id}
      className={`min-w-0 print:mb-3 print:break-inside-avoid ${wide ? 'xl:col-span-2' : ''}`}
      {...(testId ? { 'data-testid': testId } : {})}
    >
      <h3 id={id} className="mono-label mb-1.5 text-cyan">
        {title}
      </h3>
      {children}
    </section>
  );
}

function CellList({ cells, label, columns }: { cells: readonly ValueCell[]; label: string; columns: string }) {
  return (
    <ul className={`grid gap-1.5 ${columns}`} aria-label={label}>
      {cells.map((cell) => (
        <li key={cell.key} className="flex min-w-0 flex-col items-center gap-0.5 rounded-md border border-edge bg-deck px-1 py-1.5" data-cell={cell.key}>
          <span className="mono-label text-faint" aria-hidden>
            {cell.label}
          </span>
          <ValueButton cell={cell} />
        </li>
      ))}
    </ul>
  );
}

function MonitorLine({ cell }: { cell: MonitorCell }) {
  const tone = cell.tone === 'physical' ? 'border-danger/70' : cell.tone === 'stun' ? 'border-warn/70' : 'border-magenta/60';
  return (
    <li className="flex flex-wrap items-center gap-2" data-monitor={cell.tone}>
      <span className="w-16 shrink-0 text-xs text-dim">{cell.label}</span>
      <ValueButton cell={cell} />
      <span className="flex flex-wrap items-center gap-y-1" aria-hidden>
        {Array.from({ length: cell.boxes }, (_, i) => (
          <span key={i} className={`inline-block h-3.5 w-3.5 rounded-[2px] border ${tone} ${(i + 1) % 3 === 0 ? 'mr-1.5' : 'mr-px'}`} />
        ))}
      </span>
    </li>
  );
}

function Items({ lines, empty, label }: { lines: readonly ItemLine[]; empty: string; label: string }) {
  if (lines.length === 0) return <p className="text-sm text-faint">{empty}</p>;
  return (
    <ul className="divide-y divide-edge/60" aria-label={label}>
      {lines.map((line) => (
        <li key={line.key} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 py-1.5">
          <span className="min-w-0 text-sm text-ink">{line.name}</span>
          {line.detail && <span className="mono-label text-dim">{line.detail}</span>}
          {line.ref && <RefOf refValue={line.ref} />}
        </li>
      ))}
    </ul>
  );
}

function RefOf({ refValue }: { refValue: Ref }) {
  return (
    <span className="ml-auto print:hidden">
      <RefChip refValue={refValue} className="text-faint pointer-coarse:min-h-10" />
    </span>
  );
}

const TH = 'px-2 py-1 text-left font-normal mono-label text-faint';
const TD = 'px-2 py-1 align-middle';

/**
 * On a phone the skills and weapons tables are wider than the screen and cut
 * the Limit and Pool columns mid-glyph, with nothing to say they scroll. A
 * line above each, on narrow screens only, says so (decoration: a screen
 * reader reads the whole table anyway). It rides in the scroller's own left
 * edge, so it never widens the page.
 */
function ScrollHint() {
  return (
    <p aria-hidden className="sticky left-0 pb-1 text-xs text-faint sm:hidden" data-testid="table-scroll-hint">
      swipe the table sideways for limit and pool →
    </p>
  );
}

export default function SheetPreview({
  preview,
  build,
  background = 'none',
  onPrint,
  title = 'The runner in play',
  testId = 'finish-sheet',
}: SheetPreviewProps) {
  const headingId = useId();
  const { compiled, derived, error } = preview;
  const backgroundText = build.identity.background?.trim() ?? '';

  if (!compiled) {
    return (
      <section aria-labelledby={headingId} className="panel space-y-2 p-3" data-testid={testId} data-state="error">
        <h2 id={headingId} className="text-base font-semibold text-ink">
          {title}
        </h2>
        <p className="text-sm text-warn" role="status">
          The sheet cannot be put together from this build yet{error ? ` (${error})` : ''}. It appears here once the steps
          before it hold enough to compile.
        </p>
      </section>
    );
  }

  const sheet = compiled.sheet;
  const who = previewIdentity(sheet);
  const skills = skillLines(sheet, derived);
  const knowledge = knowledgeLines(sheet);
  const weapons = weaponLines(sheet, derived);
  const magic = magicLines(sheet, derived);
  const contacts = contactLines(compiled);
  const armorPool = derived?.pools['armor'] ?? null;
  const defense = derived?.pools['defense'] ?? null;
  const soak = derived?.pools['soak'] ?? null;

  return (
    <section
      aria-labelledby={headingId}
      className="panel space-y-4 p-3 sm:p-4 print:space-y-2 print:border-0 print:p-0"
      data-testid={testId}
      data-state={derived ? 'ready' : 'underived'}
      {...PRINT_ATTRS}
    >
      <header className="flex flex-wrap items-start gap-x-3 gap-y-1">
        <div className="min-w-0 flex-1">
          <h2 id={headingId} className="mono-label text-faint print:hidden">
            {title}
          </h2>
          <p className="text-lg font-semibold text-ink" data-testid={`${testId}-alias`}>
            {who.alias}
          </p>
          <p className="text-sm text-dim">
            {[who.metatype, ...(who.awakening ? [who.awakening] : []), ...who.details].join(' · ')}
          </p>
        </div>
        {onPrint && (
          <button
            type="button"
            className="btn px-3 py-1.5"
            onClick={onPrint}
            aria-label="print this sheet"
            data-testid={`${testId}-print`}
            {...HIDE_ATTRS}
          >
            print
          </button>
        )}
      </header>

      {!derived && (
        <p className="text-sm text-warn" role="status">
          The sheet compiled but its dice pools could not be worked out{error ? ` (${error})` : ''}.
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2 print:block print:columns-2 print:gap-6">
        {derived && (
          <Block title="Attributes" testId={`${testId}-attributes`} wide>
            <CellList cells={attributeCells(sheet, derived)} label="Attributes" columns="grid-cols-4 sm:grid-cols-8" />
            <div className="mt-1.5">
              <CellList cells={specialCells(sheet, derived)} label="Edge, Essence and special attributes" columns="grid-cols-4 sm:grid-cols-8" />
            </div>
          </Block>
        )}

        {derived && (
          <Block title="Limits and initiative" testId={`${testId}-limits`}>
            <CellList cells={limitCells(derived)} label="Limits" columns="grid-cols-3" />
            <div className="mt-1.5">
              <CellList cells={initiativeCells(sheet, derived)} label="Initiative" columns="grid-cols-2 sm:grid-cols-3" />
            </div>
          </Block>
        )}

        {derived && (
          <Block title="Condition monitors" testId={`${testId}-monitors`}>
            <ul className="space-y-1.5" aria-label="Condition monitors">
              {monitorCells(derived).map((cell) => (
                <MonitorLine key={cell.key} cell={cell} />
              ))}
            </ul>
          </Block>
        )}

        <Block title="Skills" testId={`${testId}-skills`} wide>
          {skills.length === 0 ? (
            <p className="text-sm text-faint">No active skills.</p>
          ) : (
            <div className="overflow-x-auto" data-testid={`${testId}-skills-scroll`}>
              <ScrollHint />
              <table className="w-full min-w-[18rem] border-collapse text-sm">
                <caption className="sr-only">Active skills with their ratings and dice pools</caption>
                <thead>
                  <tr className="border-b border-edge">
                    <th scope="col" className={TH}>
                      Skill
                    </th>
                    <th scope="col" className={TH}>
                      Rating
                    </th>
                    <th scope="col" className={TH}>
                      Pool
                    </th>
                    <th scope="col" className={TH}>
                      Limit
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {skills.map((s) => (
                    <tr key={s.key} className="border-b border-edge/50" data-skill={s.key}>
                      <th scope="row" className={`${TD} text-left font-normal text-ink`}>
                        {s.name}
                        <span className="mono-label ml-1.5 text-faint">
                          {s.attr}
                          {s.spec ? ` · ${s.spec}` : ''}
                          {s.group ? ` · ${s.group}` : ''}
                        </span>
                      </th>
                      <td className={`${TD} font-label`}>{s.rating}</td>
                      <td className={TD}>
                        <PoolNumber name={s.name} pool={s.pool} />
                      </td>
                      <td className={`${TD} font-label text-dim`}>{s.pool?.limit ? `${s.pool.limit.kind} ${s.pool.limit.value}` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {knowledge.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Knowledge skills and languages">
              {knowledge.map((k) => (
                <li key={k.key} className="chip text-dim">
                  <span className="normal-case tracking-normal text-ink">{k.name}</span>
                  <span>
                    {' '}
                    {k.kind} {k.rating}
                    {k.spec ? ` · ${k.spec}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Block>

        {magic.map((group) => (
          <Block key={group.title} title={group.title} testId={`${testId}-magic`}>
            <ul className="divide-y divide-edge/60" aria-label={group.title}>
              {group.lines.map((line) => (
                <li key={line.key} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 py-1.5">
                  <span className="text-sm text-ink">{line.name}</span>
                  {line.detail && <span className="mono-label text-dim">{line.detail}</span>}
                  {line.pool && <PoolNumber name={line.name} pool={line.pool} />}
                  {line.ref && <RefOf refValue={line.ref} />}
                </li>
              ))}
            </ul>
          </Block>
        ))}

        <Block title="Weapons" testId={`${testId}-weapons`} wide>
          {weapons.length === 0 ? (
            <p className="text-sm text-faint">No weapons.</p>
          ) : (
            <div className="overflow-x-auto" data-testid={`${testId}-weapons-scroll`}>
              <ScrollHint />
              <table className="w-full min-w-[22rem] border-collapse text-sm">
                <caption className="sr-only">Weapons with their damage and dice pools</caption>
                <thead>
                  <tr className="border-b border-edge">
                    {['Weapon', 'DV', 'AP', 'Acc', 'Modes', 'Pool'].map((h) => (
                      <th key={h} scope="col" className={TH}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {weapons.map((w) => (
                    <tr key={w.key} className="border-b border-edge/50" data-weapon={w.name}>
                      <th scope="row" className={`${TD} text-left font-normal text-ink`}>
                        {w.name}
                      </th>
                      <td className={`${TD} font-label`}>{w.dv}</td>
                      <td className={`${TD} font-label`}>{w.ap}</td>
                      <td className={`${TD} font-label`}>{w.acc}</td>
                      <td className={`${TD} font-label`}>{w.modes}</td>
                      <td className={TD}>
                        <PoolNumber name={w.name} pool={w.pool} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Block>

        <Block title="Armor and defense" testId={`${testId}-armor`}>
          {derived && (
            <ul className="mb-1.5 flex flex-wrap gap-3" aria-label="Armor, defense and soak">
              {[
                { key: 'armor', name: 'Armor', pool: armorPool },
                { key: 'defense', name: 'Defense', pool: defense },
                { key: 'soak', name: 'Soak', pool: soak },
              ].map((p) => (
                <li key={p.key} className="flex items-center gap-1.5">
                  <span className="mono-label text-faint">{p.name}</span>
                  <PoolNumber name={p.name} pool={p.pool} />
                </li>
              ))}
            </ul>
          )}
          <Items lines={armorLines(sheet)} empty="No armor." label="Armor" />
        </Block>

        <Block title="Augmentations" testId={`${testId}-augments`}>
          <Items lines={augmentLines(sheet)} empty="No augmentations." label="Augmentations" />
        </Block>

        <Block title="Qualities" testId={`${testId}-qualities`}>
          <Items lines={qualityLines(sheet)} empty="No qualities." label="Qualities" />
        </Block>

        <Block title="Gear" testId={`${testId}-gear`}>
          <Items lines={gearLines(sheet)} empty="No other gear." label="Gear" />
        </Block>

        <Block title="Lifestyle and contacts" testId={`${testId}-life`}>
          <Items lines={lifestyleLines(compiled)} empty="No lifestyle." label="Lifestyles" />
          {contacts.length > 0 ? (
            <ul className="mt-1.5 divide-y divide-edge/60" aria-label="Contacts">
              {contacts.map((c) => (
                <li key={c.key} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 py-1.5">
                  <span className="text-sm text-ink">{c.name}</span>
                  {c.role && <span className="mono-label text-dim">{c.role}</span>}
                  <span className="ml-auto font-label text-xs text-dim">
                    <span aria-hidden>
                      C{c.connection} L{c.loyalty}
                    </span>
                    <span className="sr-only">
                      connection {c.connection}, loyalty {c.loyalty}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1.5 text-sm text-faint">No contacts.</p>
          )}
          <p className="mt-1.5 text-xs text-dim" data-testid={`${testId}-opening`}>
            {openingLine(compiled)}
          </p>
        </Block>
      </div>

      {background !== 'none' && (
        <section
          className={background === 'print' ? 'hidden print:block' : ''}
          aria-label="Background"
          data-testid={`${testId}-background`}
        >
          <h3 className="mono-label mb-1 text-cyan">Background</h3>
          {backgroundText ? (
            <p className="whitespace-pre-wrap text-sm text-ink">{backgroundText}</p>
          ) : (
            <p className="text-sm text-faint">No background written.</p>
          )}
        </section>
      )}
    </section>
  );
}
