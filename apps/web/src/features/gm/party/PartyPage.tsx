/**
 * `/c/:campaignId/gm/party` — the party roster screen.
 *
 * The user's first complaint was "there is nowhere to see the player
 * characters". This is that screen, at the depth a GM actually needs it: not
 * just a list of names, but the numbers they ask for out loud — condition
 * monitors and the wound modifier they imply, current Edge, defence, soak,
 * perception, initiative, and the karma and nuyen the ledger says each runner
 * holds. Damage, heals and awards apply from here through the same server
 * routes the sheet uses; nothing about this screen is a second source of truth.
 *
 * GM-only (DESIGN.md §13). The server already filters by role — `GmGuard` is
 * honest UI, not the boundary (Principle 4).
 *
 * The console home keeps `../home/PartyPanel` as its compact summary and links
 * here; handing a sheet to a device and importing a `.chum5` are that panel's
 * controls, reused on the rows below rather than reimplemented.
 */
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import JoinQrModal from '../../../components/shell/JoinQrModal.js';
import { GmGuard, SectionTitle } from '../ui.js';
import PartyRoster from './PartyRoster.js';

export default function PartyPage() {
  const { campaignId } = useParams<{ campaignId: string }>();
  const [qrOpen, setQrOpen] = useState(false);
  if (!campaignId) return null;

  return (
    <GmGuard>
      <div className="p-6">
        <SectionTitle hint="a sheet, the phone holding it, and the numbers on it">
          The crew
        </SectionTitle>
        <h1 className="mt-1 text-lg font-semibold">Party</h1>
        <p className="mt-1 max-w-2xl text-sm text-dim">
          Every character in this campaign, claimed or not. Open any sheet from here — the GM
          never has to know a character&apos;s id. Handing a sheet to a player is two steps: they
          scan the join QR, then you pick their name on their row.
        </p>

        <div className="mt-4 max-w-4xl">
          <PartyRoster campaignId={campaignId} />
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button className="btn btn-accent px-3 py-1.5" onClick={() => setQrOpen(true)}>
            show join QR
          </button>
          <Link className="btn px-3 py-1.5" to={`/c/${campaignId}/gm`}>
            back to the console
          </Link>
        </div>

        <JoinQrModal campaignId={campaignId} open={qrOpen} onClose={() => setQrOpen(false)} />
      </div>
    </GmGuard>
  );
}
