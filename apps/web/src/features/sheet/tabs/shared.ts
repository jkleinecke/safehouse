/** Props every sheet tab receives from SheetPage. */
import type { DerivedCharacter, SheetV1 } from '@safehouse/contracts';
import type { CharacterRecord } from '../api.js';
import type { ConditionState } from '../lib.js';
import type { OverrideApi } from '../components/Provenance.js';
import type { RollConfig } from '../components/RollDialog.js';

export interface TabProps {
  character: CharacterRecord;
  derived: DerivedCharacter;
  campaignId: string;
  /** Persist a sheet mutation (PATCH → revision). Optimistic in the cache. */
  patchSheet: (next: SheetV1) => void;
  /** Persist monitor fills (drain application, manual damage/heal). */
  setCondition: (next: ConditionState) => void;
  /** Open the roll dialog; `onSent` fires after the roll request goes out. */
  roll: (config: RollConfig, onSent?: () => void) => void;
  /** Override plumbing for a modifier target (Principle 2). */
  overrideFor: (target: string) => OverrideApi;
}
