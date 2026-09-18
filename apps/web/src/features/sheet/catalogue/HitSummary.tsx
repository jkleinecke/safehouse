/**
 * One catalogue row, summarised: its name, the table it sat in, and its
 * printed columns on one line (`statsLine`).
 *
 * The sheet's "add from the books" dialog and the character builder's picker
 * both list catalogue rows, and a row should read the same in both — the
 * same name, the same heading, the same stats in the book's column order —
 * so the summary is this one component rather than a copy in each. The
 * builder shows price and Availability its own way (at a rating and grade,
 * against the campaign's caps), so it asks for the line without them
 * (`priced={false}`), and lets the line wrap (`wrap`): a builder row stacks
 * its stats above a price, where a cut-off "ACC 6 · DAMAGE 6P · MO…" hides the
 * damage and modes a player is choosing by.
 *
 * The summary sizes itself as a flex item in a row (`flex-1 basis-40`) — the
 * dialog puts it beside the add button. `bare` drops that sizing for a
 * caller that stacks it in a column, where a 10rem basis became a 10rem
 * *height* and left a gap under every picker row.
 */
import { KIND_LABEL, type CatalogueKind } from './api.js';
import { statsLine, type CatalogueHit } from './toSheet.js';

export interface HitSummaryProps {
  hit: CatalogueHit;
  /** Include Availability and price at the end of the stats line (default true). */
  priced?: boolean;
  /** Dim the name — a row that cannot be taken. */
  muted?: boolean;
  /** Let the stats line wrap instead of cutting it off (default false). */
  wrap?: boolean;
  /** No flex sizing of its own: for a caller that stacks the summary in a column (default false). */
  bare?: boolean;
}

export default function HitSummary({ hit, priced = true, muted = false, wrap = false, bare = false }: HitSummaryProps) {
  const line = statsLine(hit, { priced });
  return (
    <div className={bare ? 'min-w-0' : 'min-w-0 flex-1 basis-40'}>
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className={`text-sm ${muted ? 'text-dim' : 'text-ink'}`}>{hit.name}</span>
        <span className="mono-label text-faint">{hit.category.toLowerCase() || KIND_LABEL[hit.kind as CatalogueKind] || hit.kind}</span>
      </div>
      {line && <div className={`mono-label text-dim ${wrap ? 'break-words' : 'truncate'}`}>{line}</div>}
    </div>
  );
}
