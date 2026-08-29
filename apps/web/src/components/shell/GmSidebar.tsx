/** Desktop GM sidebar — prep tools + table views + kiosk link. */
import { NavLink } from 'react-router-dom';

export interface GmSidebarProps {
  campaignId: string;
  onShowQr: () => void;
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

export default function GmSidebar({ campaignId, onShowQr }: GmSidebarProps) {
  const c = `/c/${campaignId}`;
  return (
    <aside className="hidden w-52 shrink-0 flex-col border-r border-edge bg-deck md:flex">
      <div className="border-b border-edge px-4 py-4">
        <div className="font-label text-sm tracking-[0.3em] text-cyan">SAFEHOUSE</div>
        <div className="mono-label mt-1 text-faint">GM console</div>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 pb-4">
        <Section label="Table">
          <NavLink to={c} end className={linkClass}>
            Overview
          </NavLink>
          <NavLink to={`${c}/table`} className={linkClass}>
            Table log
          </NavLink>
          <NavLink to={`${c}/grid`} className={linkClass}>
            Grid
          </NavLink>
          <NavLink to={`${c}/codex`} className={linkClass}>
            Codex
          </NavLink>
          <NavLink to={`${c}/calendar`} className={linkClass}>
            Calendar
          </NavLink>
        </Section>

        <Section label="Prep">
          <NavLink to={`${c}/gm`} end className={linkClass}>
            GM home
          </NavLink>
          <NavLink to={`${c}/gm/runs`} className={linkClass}>
            Runs
          </NavLink>
          <NavLink to={`${c}/gm/scenes`} className={linkClass}>
            Scenes
          </NavLink>
          <NavLink to={`${c}/gm/generator`} className={linkClass}>
            Generator
          </NavLink>
          <NavLink to={`${c}/gm/fixer`} className={linkClass}>
            Fixer
          </NavLink>
          <NavLink to={`${c}/gm/books`} className={linkClass}>
            Books
          </NavLink>
          <NavLink to={`${c}/gm/sessions`} className={linkClass}>
            Sessions
          </NavLink>
        </Section>

        <Section label="Screens">
          <a
            href={`/tv/${campaignId}`}
            target="_blank"
            rel="noreferrer"
            className="block rounded-md px-3 py-1.5 font-label text-xs uppercase tracking-widest text-dim transition-colors hover:bg-panel hover:text-ink"
          >
            TV view ↗
          </a>
        </Section>
      </nav>

      <div className="border-t border-edge p-3">
        <button className="btn btn-accent w-full" onClick={onShowQr}>
          Show join QR
        </button>
      </div>
    </aside>
  );
}
