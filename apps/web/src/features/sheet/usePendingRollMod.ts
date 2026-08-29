/**
 * The sheet's half of the ruler → dice handoff (FR9.9).
 *
 * The Grid publishes a measured range modifier to `live/rollHandoff`; this
 * subscribes so the next roll dialog can offer it as a chip. Deliberately not
 * a zustand slice and deliberately not an import of the Grid's store: the
 * handoff is a localStorage key and a window event, and a phone that never
 * opens the Grid pays nothing for it.
 *
 * Read once on mount (the offer usually predates this component — it was made
 * on the map, before the player navigated to the sheet), then follow both the
 * in-tab CustomEvent and cross-tab `storage`.
 */
import { useEffect, useState } from 'react';
import {
  readPendingRollMod,
  subscribePendingRollMod,
  type PendingRollMod,
} from '../../live/rollHandoff.js';

export function usePendingRollMod(): PendingRollMod | null {
  const [mod, setMod] = useState<PendingRollMod | null>(() => readPendingRollMod());
  useEffect(() => subscribePendingRollMod(setMod), []);
  return mod;
}
