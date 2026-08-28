/** Phone-first bottom navigation: Sheet / Table / Grid (+ GM for the GM). */
import { NavLink } from 'react-router-dom';
import type { Role } from '@safehouse/contracts';

export interface BottomNavProps {
  campaignId: string;
  role: Role;
  characterId?: string;
}

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `flex flex-1 flex-col items-center gap-0.5 py-2 font-label text-[0.65rem] uppercase tracking-widest transition-colors ${
    isActive ? 'text-cyan' : 'text-dim hover:text-ink'
  }`;

export default function BottomNav({ campaignId, role, characterId }: BottomNavProps) {
  // Resolved from the roster by owner (see `useMyCharacterId`). A device with
  // no character of its own — the GM, an observer, the TV — gets no Sheet tab
  // rather than a link to a sheet that does not exist.
  const sheetPath = characterId ? `/c/${campaignId}/sheet/${characterId}` : null;

  return (
    <nav className="sticky bottom-0 z-40 flex border-t border-edge bg-deck/95 backdrop-blur md:hidden">
      {sheetPath && (
        <NavLink to={sheetPath} className={linkClass}>
          <span aria-hidden>▚</span>
          Sheet
        </NavLink>
      )}
      <NavLink to={`/c/${campaignId}/table`} className={linkClass}>
        <span aria-hidden>⬡</span>
        Table
      </NavLink>
      <NavLink to={`/c/${campaignId}/grid`} className={linkClass}>
        <span aria-hidden>▦</span>
        Grid
      </NavLink>
      {role === 'gm' && (
        <NavLink to={`/c/${campaignId}/gm`} className={linkClass}>
          <span aria-hidden>◆</span>
          GM
        </NavLink>
      )}
    </nav>
  );
}
