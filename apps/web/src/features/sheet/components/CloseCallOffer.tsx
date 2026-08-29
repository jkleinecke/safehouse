/**
 * Close Call (FR2.3): after a glitch, one point of Edge buys it off.
 *
 * It has to be an *offer* rather than a menu item, because the moment it
 * matters is the moment the dice land — a critical glitch on a burst of
 * automatic fire is exactly when nobody wants to go hunting through a submenu.
 * The offer appears under the identity strip as soon as a glitched
 * `roll.created` for this character reaches the live store, and disappears the
 * moment the spend is logged (the server posts `edgeAction: 'close_call'`
 * carrying the `rollId`), so two phones cannot both think it is still open.
 *
 * The roll row itself is never edited — G5 keeps the record immutable; the
 * spend is appended as its own log line.
 */
import { EDGE_ACTION_HINTS, type CloseCallOffer } from '../edgeActions.js';

export default function CloseCallOfferCard({
  offer,
  edgeCurrent,
  busy,
  onSpend,
  onDismiss,
}: {
  offer: CloseCallOffer;
  edgeCurrent: number;
  busy?: boolean;
  onSpend: () => void;
  onDismiss: () => void;
}) {
  const critical = offer.glitch === 'critical';
  const affordable = edgeCurrent > 0;

  return (
    <div
      className={`mx-4 mt-2 rounded border p-2.5 ${
        critical ? 'border-danger/70 bg-danger/10' : 'border-warn/60 bg-warn/5'
      }`}
      role="region"
      aria-label="Close Call offer"
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className={`mono-label ${critical ? 'text-danger' : 'text-warn'}`}>
            {critical ? 'Critical glitch' : 'Glitch'} — {offer.title}
          </div>
          <p className="mt-0.5 text-xs text-dim">
            {affordable
              ? EDGE_ACTION_HINTS.close_call
              : 'No Edge left to buy this one off.'}
          </p>
        </div>
        <div className="flex shrink-0 gap-1.5">
          <button
            type="button"
            className="chip text-dim"
            onClick={onDismiss}
            aria-label="Dismiss the Close Call offer"
          >
            Let it ride
          </button>
          <button
            type="button"
            className="chip border-warn text-warn disabled:opacity-40"
            disabled={!affordable || busy}
            onClick={onSpend}
            aria-label={`Close Call — spend 1 Edge to negate the ${
              critical ? 'critical glitch' : 'glitch'
            } on ${offer.title}`}
          >
            {busy ? 'Spending…' : 'Close Call'}
          </button>
        </div>
      </div>
    </div>
  );
}
