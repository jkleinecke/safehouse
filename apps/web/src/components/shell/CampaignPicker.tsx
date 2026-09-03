/**
 * "Pick up where you left off" — the front door's campaign list.
 *
 * The GM hosts the table on their own laptop and plays it over months. Before
 * this, reopening the browser worked only while exactly one device session
 * survived in localStorage; a second campaign evicted the first, cleared
 * storage was unrecoverable, and the three sign-in tabs all asked for
 * something a returning GM does not have (a code only a live GM can mint, or a
 * campaign UUID nothing in the app would tell them).
 *
 * This list is the answer to all three. Every row is a (campaign, role) pair:
 *
 *   - **held here** — a device token this browser already has, or one the
 *     loopback probe just minted for this machine and has not stored yet. One
 *     tap makes it this tab's session and goes; every other campaign's token
 *     is left exactly where it was, which is the whole reason sessions are
 *     keyed by (campaign, role).
 *   - **listed by the server** — the same user is a member, but the device for
 *     it is on another machine. Tapping tries `POST /api/gm/recover`, which
 *     succeeds only on the laptop hosting the server. Where it refuses the row
 *     says what to do instead, in plain words and without an alarm: a refusal
 *     on a player's phone is the correct answer, not a fault.
 *
 * The tap is also where a recovered device is *stored*: opening the front door
 * on the host machine mints nothing the GM keeps until they pick a table.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { recoverGmSession, type CampaignCard } from '../../api/my-campaigns.js';
import { saveSession, sessionKey } from '../../api/session.js';
import { resetClientState } from './signin-api.js';
import { destinationFor, roleLabel } from './signin.js';

/** A campaign the server has not named yet reads as its id, never as blank. */
function label(card: CampaignCard): string {
  return card.name.trim() || `Campaign ${card.campaignId.slice(0, 8)}`;
}

function cardKey(card: CampaignCard): string {
  return sessionKey({ role: card.role, campaignId: card.campaignId });
}

export interface CampaignPickerProps {
  cards: CampaignCard[];
}

export default function CampaignPicker({ cards }: CampaignPickerProps) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);

  // Nothing to offer yet renders nothing at all — the sign-in tabs below are
  // always there, so an empty list is never a dead end and never a spinner
  // that a player's phone would sit under forever.
  if (cards.length === 0) return null;

  const enter = (session: NonNullable<CampaignCard['session']>) => {
    // `saveSession` both stores and pins, so an already-stored device and a
    // just-recovered one take the same path in.
    saveSession(session);
    resetClientState();
    navigate(destinationFor(session), { replace: true });
  };

  const open = async (card: CampaignCard) => {
    setBlocked(null);
    if (card.session) {
      enter(card.session);
      return;
    }

    // No device here for that table. The one path that can mint one without a
    // secret is the loopback recovery, and it is silent when it declines.
    setBusy(cardKey(card));
    const recovered = await recoverGmSession(card.campaignId);
    setBusy(null);
    if (recovered) {
      enter(recovered);
      return;
    }
    setBlocked(cardKey(card));
  };

  return (
    <section className="mt-6 text-left" data-testid="campaign-picker">
      <div className="mono-label">Your campaigns</div>
      <ul className="mt-2 space-y-1.5">
        {cards.map((card) => {
          const key = cardKey(card);
          return (
            <li key={key}>
              <button
                type="button"
                className="btn w-full items-center justify-between gap-3 px-3 py-2"
                data-campaign={card.campaignId}
                data-role={card.role}
                data-held={card.session ? 'yes' : 'no'}
                disabled={busy === key}
                aria-label={`Open ${label(card)} as ${roleLabel(card.role)}`}
                onClick={() => void open(card)}
              >
                <span className="flex min-w-0 flex-col text-left">
                  <span className="truncate">{label(card)}</span>
                  {card.gmName && (
                    <span className="truncate text-xs font-normal text-faint">
                      started by {card.gmName}
                    </span>
                  )}
                </span>
                <span className="mono-label shrink-0 text-faint">
                  {busy === key ? 'claiming…' : roleLabel(card.role)}
                </span>
              </button>
              {blocked === key && (
                <p className="mt-1 px-3 text-xs text-dim" data-testid="campaign-elsewhere">
                  This browser has no device for that table, and this machine is not the one
                  running the server. Open Safehouse on the laptop hosting it, or mint a token
                  there with <code className="text-cyan">pnpm gm:token</code>.
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
