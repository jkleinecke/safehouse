/**
 * Magic tab (FR8.1-lite, FR8.2–FR8.5) — the mage's whole surface.
 *
 * Two layers, deliberately separable:
 *
 *  - `SpellBook` needs nothing but the sheet: spells with a Force picker
 *    feeding the cast roll, the Drain resistance roll chained behind it, and
 *    adept powers as modifier toggles.
 *  - `MagicWorkbench` is the tracked half — sustained spells (and who is
 *    carrying them), the spirit list with its services countdown, the bonded
 *    focus rack whose toggles move real pools, and the reagent counter. It
 *    hydrates from REST on mount (LIVE-1) and reconciles from `magic.updated`.
 *
 * The workbench reaches for TanStack Query, so the tab checks that a client is
 * actually mounted before rendering it. In the app it always is; rendered bare
 * — the markup regression suite does exactly that — the tab degrades to the
 * spellbook rather than throwing, and sustaining falls back to the sheet
 * modifier convention it has always used.
 */
import { useContext } from 'react';
import { QueryClientContext } from '@tanstack/react-query';
import { sustainedSpells, toggleSustain } from '../lib.js';
import MagicPanel from '../magic/MagicPanel.js';
import SpellBook from '../magic/SpellBook.js';
import type { TabProps } from './shared.js';

export default function MagicTab(props: TabProps) {
  const hasQueryClient = useContext(QueryClientContext) !== undefined;
  const sheet = props.character.sheet;

  return (
    <div className="p-4">
      {hasQueryClient ? (
        <MagicPanel {...props} />
      ) : (
        <SpellBook
          {...props}
          sustainedNames={sustainedSpells(sheet)}
          onSustain={(name) => props.patchSheet(toggleSustain(sheet, name))}
        />
      )}
    </div>
  );
}
