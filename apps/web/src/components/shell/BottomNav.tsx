/**
 * Phone-first bottom navigation (Principle 7 — 390 px first).
 *
 * The tabs come from `PLAYER_NAV` so the phone and the campaign home offer the
 * same set. Books is on it now: FR11.5 shares the library with the table by
 * default, and a player used to be able to reach a rulebook only by tapping a
 * ref chip that happened to be embedded in something they were already reading.
 */
import { NavLink } from 'react-router-dom';
import type { Role } from '@safehouse/contracts';
import { PLAYER_NAV } from './gmNav.js';

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
  const tabs = PLAYER_NAV.filter((e) => e.glyph !== undefined);

  return (
    <nav className="sticky bottom-0 z-40 flex border-t border-edge bg-deck/95 backdrop-blur md:hidden">
      {sheetPath && (
        <NavLink to={sheetPath} data-nav="sheet" className={linkClass}>
          <span aria-hidden>▚</span>
          Sheet
        </NavLink>
      )}
      {tabs.map((tab) => (
        <NavLink
          key={tab.key}
          to={`/c/${campaignId}${tab.to}`}
          data-nav={tab.key}
          className={linkClass}
        >
          <span aria-hidden>{tab.glyph}</span>
          {tab.label}
        </NavLink>
      ))}
      {role === 'gm' && (
        <NavLink to={`/c/${campaignId}/gm`} data-nav="gm" className={linkClass}>
          <span aria-hidden>◆</span>
          GM
        </NavLink>
      )}
    </nav>
  );
}
