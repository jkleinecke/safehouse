/**
 * Where the magic workbench meets live state.
 *
 * The workbench itself takes the fight, the log window and the viewer's role as
 * plain props so it can be rendered from a fixture; this is the half that knows
 * those come from the live store and the device session. The store is
 * BACKFILLED over REST by the campaign shell on mount, so reading the running
 * encounter from it is reading hydrated state, not "whatever event this tab
 * happened to be mounted for" (LIVE-1).
 */
import { getSession } from '../../../api/session.js';
import { useLiveStore } from '../../../live/store.js';
import type { TabProps } from '../tabs/shared.js';
import MagicWorkbench from './MagicWorkbench.js';

export default function MagicPanel(props: TabProps) {
  const encounter = useLiveStore((s) => s.encounter);
  const events = useLiveStore((s) => s.events);
  const isGm = getSession()?.role === 'gm';

  return (
    <MagicWorkbench
      {...props}
      encounter={encounter ? { id: encounter.id, name: encounter.name } : null}
      events={events}
      isGm={isGm}
    />
  );
}
