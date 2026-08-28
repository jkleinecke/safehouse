/**
 * /c/:campaignId/table — the shared table screen (M2 + M4).
 *
 * Desktop: the session log runs down the left with the dice roller docked
 * under it; the initiative tracker and rollable tables stack on the right.
 * Phones (390px, the player's actual device) get one pane at a time behind a
 * segmented control, with the roller always within thumb reach.
 */
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import DiceRoller from './DiceRoller.js';
import LogStream from './LogStream.js';
import RollTablesPanel from './RollTablesPanel.js';
import Tracker from './Tracker.js';
import './table.css';

type Pane = 'log' | 'tracker' | 'tables';

const PANES: Array<{ id: Pane; label: string }> = [
  { id: 'log', label: 'Log' },
  { id: 'tracker', label: 'Tracker' },
  { id: 'tables', label: 'Tables' },
];

function MissingCampaign() {
  return (
    <div className="p-6">
      <div className="panel max-w-sm p-6 text-center">
        <div className="mono-label text-magenta">No campaign</div>
        <p className="mt-2 text-sm text-dim">This route needs a campaign id.</p>
      </div>
    </div>
  );
}

export default function TablePage() {
  const { campaignId } = useParams<{ campaignId: string }>();
  const [pane, setPane] = useState<Pane>('log');

  if (!campaignId) return <MissingCampaign />;

  return (
    <div className="flex h-full min-h-[70dvh] flex-col md:flex-row">
      {/* Phone pane switcher — desktop shows every pane at once. */}
      <nav className="flex shrink-0 gap-1 border-b border-edge bg-deck px-2 py-1.5 md:hidden">
        {PANES.map((p) => (
          <button
            key={p.id}
            type="button"
            className={`chip flex-1 justify-center ${
              pane === p.id ? 'border-cyan text-cyan' : 'border-edge text-dim'
            }`}
            aria-pressed={pane === p.id}
            onClick={() => setPane(p.id)}
          >
            {p.label}
          </button>
        ))}
      </nav>

      <div
        className={`min-h-0 min-w-0 flex-1 flex-col ${pane === 'log' ? 'flex' : 'hidden'} md:flex`}
      >
        <LogStream campaignId={campaignId} />
        <DiceRoller campaignId={campaignId} />
      </div>

      <aside
        className={`min-h-0 shrink-0 flex-col gap-2 overflow-y-auto border-edge p-2 md:flex md:w-96 md:border-l ${
          pane === 'log' ? 'hidden' : 'flex flex-1'
        }`}
      >
        <div className={`min-h-0 ${pane === 'tables' ? 'hidden md:flex' : 'flex'} flex-1 flex-col`}>
          <Tracker campaignId={campaignId} />
        </div>
        <div className={pane === 'tracker' ? 'hidden md:block' : 'block'}>
          <RollTablesPanel campaignId={campaignId} />
        </div>
      </aside>
    </div>
  );
}
