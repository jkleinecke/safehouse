/**
 * "Add from the books" — a player (or the GM on their sheet) finds an item,
 * spell or power by name in the catalogue the seeder read out of the GM's
 * books, and it lands on the sheet with the stats the book printed and the
 * page it came from (`toSheet.ts`). Or writes their own, for the thing that
 * is in no table, or in no book (`CustomItemForm.tsx`).
 *
 * How the runner came by it is worked out with the GM, out loud; this keeps
 * the inventory and the numbers. When the row has a price, the same tap can
 * put the nuyen on the ledger — as a proposal pending the GM's approval when
 * a player does it (FR3.6), as a recorded spend when the GM does — so the
 * ledger says what was bought without the app deciding whether it was.
 */
import { useEffect, useState } from 'react';
import type { SheetV1 } from '@safehouse/contracts';
import { getSession } from '../../../api/session.js';
import { useProposeSpend } from '../api.js';
import { RefChip, Sheet } from '../components/ui.js';
import { KIND_LABEL, useCatalogueSearch, type CatalogueKind } from './api.js';
import CustomItemForm from './CustomItemForm.js';
import { statsLine, withCatalogueItem, type CatalogueHit } from './toSheet.js';

export interface AddFromBooksProps {
  characterId: string;
  sheet: SheetV1;
  patchSheet: (next: SheetV1) => void;
  /** Which kinds this button is for: the Weapons section asks for weapons. */
  kinds: readonly CatalogueKind[];
  /** The button's label. */
  label?: string;
  /** Test handle prefix. */
  testId?: string;
}

export interface AddFromBooksViewProps {
  open: boolean;
  onClose: () => void;
  query: string;
  onQuery: (q: string) => void;
  kinds: readonly CatalogueKind[];
  kind: CatalogueKind | '';
  onKind: (k: CatalogueKind | '') => void;
  hits: readonly CatalogueHit[] | undefined;
  searching: boolean;
  error: unknown;
  recordSpend: boolean;
  onRecordSpend: (v: boolean) => void;
  /** The GM records a spend outright; a player proposes one. */
  gm: boolean;
  /** The write-your-own form is open. */
  custom: boolean;
  onCustom: (v: boolean) => void;
  onAdd: (hit: CatalogueHit) => void;
  /** The last thing that happened: "added Zap Gun", "already on the sheet". */
  note: string | null;
  testId: string;
}

const inputClass = 'w-full rounded border border-edge bg-ground px-2 py-2 text-sm text-ink placeholder:text-faint focus:border-cyan focus:outline-none';

/** The dialog, given its state — the half a static render can see. */
export function AddFromBooksView(p: AddFromBooksViewProps) {
  const label = p.kinds.length === 1 ? KIND_LABEL[p.kinds[0]!] : 'items';
  return (
    <Sheet open={p.open} onClose={p.onClose} title={`Add ${label}`}>
      <div data-testid={`${p.testId}-dialog`}>
        <form
          role="search"
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
          }}
        >
          <input
            className={`${inputClass} min-w-[10rem] flex-1`}
            type="search"
            value={p.query}
            onChange={(e) => p.onQuery(e.target.value)}
            placeholder="part of the name — predator, armor jacket, manabolt…"
            aria-label={`Search the books for ${label}`}
            autoFocus
          />
          {p.kinds.length > 1 && (
            <select className={`${inputClass} w-auto`} value={p.kind} onChange={(e) => p.onKind(e.target.value as CatalogueKind | '')} aria-label="Only this kind">
              <option value="">any kind</option>
              {p.kinds.map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]}
                </option>
              ))}
            </select>
          )}
        </form>
        <p className="mono-label mt-1 text-faint">
          {p.searching ? 'searching…' : 'from the books the GM seeded · the stats the book printed, and its page'}
        </p>
        {p.error !== null && p.error !== undefined && (
          <p className="mt-2 rounded border border-danger/40 bg-danger/10 px-2 py-1 text-xs text-danger">
            {p.error instanceof Error ? p.error.message : String(p.error)}
          </p>
        )}
        <label className="mt-2 flex items-center gap-2 text-xs text-dim">
          <input type="checkbox" checked={p.recordSpend} onChange={(e) => p.onRecordSpend(e.target.checked)} data-testid={`${p.testId}-spend`} />
          {p.gm ? 'record the nuyen spend on the ledger when the item has a price' : 'propose the nuyen spend when the item has a price (pending until the GM approves)'}
        </label>
        {p.note && (
          <p className="mt-2 text-xs text-cyan" role="status" data-testid={`${p.testId}-note`}>
            {p.note}
          </p>
        )}
        {p.hits && p.hits.length === 0 && p.query.trim().length >= 2 && !p.searching && (
          <p className="mt-3 text-sm text-dim" data-testid={`${p.testId}-empty`}>
            Nothing by that name. The books index every table the seeder could read; a thing that is only in prose is
            still a page away through search — or write it in below and give it the page.
          </p>
        )}
        {p.hits && p.hits.length > 0 && (
          <ul className="mt-3 divide-y divide-edge/60" data-testid={`${p.testId}-hits`}>
            {p.hits.map((hit) => (
              <li key={hit.id} className="flex items-center gap-2 py-2" data-testid={`${p.testId}-hit`} data-kind={hit.kind}>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-sm text-ink">{hit.name}</span>
                    <span className="mono-label text-faint">{hit.category.toLowerCase() || KIND_LABEL[hit.kind as CatalogueKind] || hit.kind}</span>
                  </div>
                  <div className="mono-label truncate text-dim">{statsLine(hit)}</div>
                </div>
                <RefChip refInfo={hit.ref} />
                <button type="button" className="btn btn-accent px-2.5 py-1" onClick={() => p.onAdd(hit)} aria-label={`Add ${hit.name} to the sheet`} data-testid={`${p.testId}-add`}>
                  add
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-3">
          <button type="button" className="chip text-cyan hover:border-cyan" onClick={() => p.onCustom(!p.custom)} aria-expanded={p.custom} data-testid={`${p.testId}-custom-open`}>
            {p.custom ? 'hide the form' : 'or write your own'}
          </button>
          {p.custom && (
            <CustomItemForm
              kinds={p.kinds}
              kind={(p.kind || p.kinds[0] || 'gear') as CatalogueKind}
              onKind={(k) => p.onKind(k)}
              onAdd={p.onAdd}
              testId={p.testId}
            />
          )}
        </div>
      </div>
    </Sheet>
  );
}

export default function AddFromBooks({ label, testId = 'add-from-books', ...rest }: AddFromBooksProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="chip text-cyan hover:border-cyan" onClick={() => setOpen(true)} data-testid={`${testId}-open`}>
        {label ?? '+ add'}
      </button>
      {open && <AddFromBooksDialog {...rest} testId={testId} onClose={() => setOpen(false)} />}
    </>
  );
}

/**
 * The live half, mounted only while the dialog is open — so a tab that shows
 * the button renders without a query client, and the search runs only once
 * someone is looking.
 */
function AddFromBooksDialog({
  characterId,
  sheet,
  patchSheet,
  kinds,
  testId,
  onClose,
}: Omit<AddFromBooksProps, 'label' | 'testId'> & { testId: string; onClose: () => void }) {
  const [draft, setDraft] = useState('');
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<CatalogueKind | ''>(kinds.length === 1 ? kinds[0]! : '');
  const [recordSpend, setRecordSpend] = useState(true);
  const [custom, setCustom] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const spend = useProposeSpend(characterId);
  const gm = getSession()?.role === 'gm';

  // A short pause after typing, so the server sees words rather than letters.
  useEffect(() => {
    const t = window.setTimeout(() => setQuery(draft), 250);
    return () => window.clearTimeout(t);
  }, [draft]);

  const search = useCatalogueSearch(query, kind);
  const hits = search.data?.filter((h) => kinds.length === 0 || kinds.includes(h.kind as CatalogueKind) || kind === h.kind);

  const add = (hit: CatalogueHit) => {
    const result = withCatalogueItem(sheet, hit);
    if (!result.added) {
      setNote(`${hit.name} is already on the sheet`);
      return;
    }
    patchSheet(result.sheet);
    if (recordSpend && hit.cost !== null && hit.cost > 0) {
      const where = hit.bookCode ? ` (${hit.bookCode} p.${hit.printedPage})` : '';
      spend.mutate({ currency: 'nuyen', amount: hit.cost, reason: `bought ${hit.name}${where}` });
      setNote(`added ${hit.name} · ${hit.cost.toLocaleString('en-US')}¥ ${gm ? 'recorded' : 'proposed'} on the ledger`);
    } else {
      setNote(`added ${hit.name}`);
    }
  };

  return (
    <AddFromBooksView
      open
      onClose={onClose}
      query={draft}
      onQuery={setDraft}
      kinds={kinds}
      kind={kind}
      onKind={setKind}
      hits={hits}
      searching={search.isFetching}
      error={search.error}
      recordSpend={recordSpend}
      onRecordSpend={setRecordSpend}
      gm={gm}
      custom={custom}
      onCustom={setCustom}
      onAdd={add}
      note={note}
      testId={testId}
    />
  );
}
