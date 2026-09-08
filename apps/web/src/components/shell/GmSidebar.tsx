/**
 * Desktop GM rail. Renders `GM_NAV` — the console's single map of itself — so
 * every screen the GM has appears here, in the order a GM works, and nothing
 * appears here that is not a screen.
 *
 * The old rail hid the party entirely (there was no roster route at all) and
 * offered "TV view ↗", which opened `/tv/:id` on the GM's own laptop where a GM
 * session counts as bound — so the kiosk drew "Standing by / RECONNECTING"
 * instead of telling anyone that the table display needs its own display-role
 * invite. It now says so, and hands over the QR that fixes it.
 */
import { NavLink } from 'react-router-dom';
import BuildBadge from './BuildBadge.js';
import { GM_NAV, GM_NAV_SECTIONS, gmHref } from './gmNav.js';

export interface GmSidebarProps {
  campaignId: string;
  onShowQr: () => void;
  /** Opens the join QR already switched to the display role (the table TV). */
  onShowDisplayQr?: () => void;
}

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `block rounded-md px-3 py-1.5 font-label text-xs uppercase tracking-widest transition-colors ${
    isActive ? 'bg-raised text-cyan' : 'text-dim hover:bg-panel hover:text-ink'
  }`;

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mt-5">
      <div className="mono-label px-3 text-faint">{label}</div>
      <div className="mt-1.5 space-y-0.5">{children}</div>
    </div>
  );
}

export default function GmSidebar({ campaignId, onShowQr, onShowDisplayQr }: GmSidebarProps) {
  return (
    <aside className="hidden w-52 shrink-0 flex-col border-r border-edge bg-deck md:flex">
      <div className="border-b border-edge px-4 py-4">
        <div className="font-label text-sm tracking-[0.3em] text-cyan">SAFEHOUSE</div>
        <div className="mono-label mt-1 text-faint">GM console</div>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 pb-4" aria-label="GM console">
        {GM_NAV_SECTIONS.map((section) => (
          <Section key={section.id} label={section.label}>
            {GM_NAV.filter((e) => e.section === section.id).map((entry) => (
              <NavLink
                key={entry.key}
                to={gmHref(campaignId, entry)}
                end={entry.end}
                data-nav={entry.key}
                title={entry.blurb}
                className={linkClass}
              >
                {entry.label}
              </NavLink>
            ))}
          </Section>
        ))}

        <Section label="Table display">
          <button
            type="button"
            data-nav="display-qr"
            className="block w-full rounded-md px-3 py-1.5 text-left font-label text-xs uppercase tracking-widest text-dim transition-colors hover:bg-panel hover:text-ink"
            onClick={onShowDisplayQr ?? onShowQr}
          >
            Pair the TV
          </button>
          <p className="px-3 pt-1 text-[0.7rem] leading-snug text-faint">
            The TV needs its own display invite — open the kiosk on that screen and scan.
          </p>
          <a
            href={`/tv/${campaignId}`}
            target="_blank"
            rel="noreferrer"
            data-nav="tv-preview"
            className="block rounded-md px-3 py-1.5 font-label text-xs uppercase tracking-widest text-dim transition-colors hover:bg-panel hover:text-ink"
          >
            Preview kiosk ↗
          </a>
        </Section>
      </nav>

      <div className="border-t border-edge p-3">
        <button className="btn btn-accent w-full" onClick={onShowQr}>
          Show join QR
        </button>
        {/* Which build is running — the answer to "is my change in here?". */}
        <BuildBadge className="mt-2.5 px-1" />
      </div>
    </aside>
  );
}
