/**
 * Interrupt-action menu (FR4.4): common interrupts with initiative costs +
 * a custom cost line. Deducts from the actor's score immediately (optimistic;
 * the server's `encounter.updated` is authoritative).
 */
import { useState } from 'react';
import type { Combatant } from '@safehouse/contracts';
import { DEFAULT_INTERRUPTS, canInterrupt } from '@safehouse/rules';
import { patchCombatantLocal, postInterrupt } from './commands.js';

export interface InterruptMenuProps {
  encounterId: string;
  combatant: Combatant;
  onClose: () => void;
}

export default function InterruptMenu({ encounterId, combatant, onClose }: InterruptMenuProps) {
  const [customCost, setCustomCost] = useState(5);

  const apply = (action: { id: string; name: string; cost: number }) => {
    patchCombatantLocal(combatant.id, { initScore: combatant.initScore - action.cost });
    postInterrupt(encounterId, combatant.id, action).catch(() => {
      // roll the optimistic deduction back on failure
      patchCombatantLocal(combatant.id, { initScore: combatant.initScore });
    });
    onClose();
  };

  return (
    <div
      className="absolute right-0 top-full z-30 mt-1 w-52 rounded-md border border-edge-bright bg-raised p-1 shadow-lg"
      role="menu"
      aria-label={`Interrupts for ${combatant.name}`}
    >
      {DEFAULT_INTERRUPTS.map((a) => {
        const affordable = canInterrupt(combatant, a);
        return (
          <button
            key={a.id}
            type="button"
            role="menuitem"
            className={`flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-sm hover:bg-panel ${
              affordable ? '' : 'text-faint'
            }`}
            title={affordable ? undefined : 'Score below cost — GM call'}
            onClick={() => apply(a)}
          >
            <span>{a.name}</span>
            <span className="font-label text-danger">−{a.cost}</span>
          </button>
        );
      })}

      <div className="mt-1 flex items-center gap-1.5 border-t border-edge px-2 py-1.5">
        <span className="mono-label">Custom</span>
        <input
          type="number"
          min={0}
          max={30}
          value={customCost}
          onChange={(e) => setCustomCost(Math.max(0, Number(e.target.value) || 0))}
          className="w-14 rounded border border-edge bg-deck px-1.5 py-0.5 text-sm outline-none focus:border-cyan-dim"
        />
        <button
          type="button"
          className="btn ml-auto px-2 py-0.5"
          onClick={() => apply({ id: 'custom', name: 'Interrupt', cost: customCost })}
        >
          −{customCost}
        </button>
      </div>
    </div>
  );
}
