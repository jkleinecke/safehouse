/**
 * `/c/:campaignId` — where a device lands after joining.
 *
 * Two audiences, one route. A player gets the phone-first card stack (their
 * sheet, the table, the map, the lore, and — new — the shared rules library,
 * which they previously had no route to at all). A GM gets sent on to the
 * console rather than a shorter version of the player's menu, because the GM's
 * "where to?" is answered by `GM_NAV`, not by four cards.
 */
import { Link, useParams } from 'react-router-dom';
import { useMyCharacterId } from '../../api/campaigns.js';
import { getSession } from '../../api/session.js';
import { PLAYER_NAV } from './gmNav.js';

function Card({ to, title, blurb }: { to: string; title: string; blurb: string }) {
  return (
    <Link to={to} className="panel block p-4 transition-colors hover:border-cyan">
      <div className="font-label text-sm uppercase tracking-widest text-cyan">{title}</div>
      <p className="mt-1 text-sm text-dim">{blurb}</p>
    </Link>
  );
}

export default function CampaignHome() {
  const { campaignId } = useParams<{ campaignId: string }>();
  const session = getSession();
  const myCharacterId = useMyCharacterId(campaignId);
  const c = `/c/${campaignId}`;
  const isGm = session?.role === 'gm';

  return (
    <div className="mx-auto max-w-lg space-y-3 p-4">
      <div className="mono-label">Where to, runner?</div>

      {isGm && (
        <Card
          to={`${c}/gm`}
          title="GM console"
          blurb="Party, settings, invites — and every prep tool, named and described."
        />
      )}

      {myCharacterId ? (
        <Card
          to={`${c}/sheet/${myCharacterId}`}
          title="Sheet"
          blurb="Your character — pools, monitors, gear, one tap to roll."
        />
      ) : (
        !isGm && (
          <div
            data-testid="no-character-note"
            className="rounded-md border border-dashed border-edge-bright bg-deck/40 p-4"
          >
            <div className="mono-label text-warn">No sheet on this device yet</div>
            <p className="mt-1 text-sm text-dim">
              Your device has joined, but no character has been handed to it. Ask the GM to pick
              your name on their Party roster — it takes them one click and your Sheet tab appears.
            </p>
          </div>
        )
      )}

      {PLAYER_NAV.map((entry) => (
        <Card key={entry.key} to={`${c}${entry.to}`} title={entry.label} blurb={entry.blurb} />
      ))}
    </div>
  );
}
