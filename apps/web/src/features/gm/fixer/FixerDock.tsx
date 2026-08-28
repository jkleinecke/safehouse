/**
 * Dockable Fixer panel (FR12.1): GM-only, invokable from anywhere. Collapsed
 * it is a corner chip; open it is the chat with its tool chips and usage
 * meter. Hides entirely for non-GM devices and when no LLM is configured (NG7).
 *
 * Mounted once in CampaignLayout so it follows the GM across every screen.
 */
import { useEffect, useState } from 'react';
import { getSession } from '../../../api/session.js';
import { aiDisabledFrom, useFixerStatus } from './api.js';
import FixerChat from './FixerChat.js';

const OPEN_KEY = 'safehouse.fixerDock.open';

export interface FixerDockProps {
  campaignId: string;
  sessionLive?: boolean;
}

export default function FixerDock({ campaignId, sessionLive }: FixerDockProps) {
  const status = useFixerStatus();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    try {
      setOpen(localStorage.getItem(OPEN_KEY) === '1');
    } catch {
      // storage blocked — the dock just starts closed.
    }
  }, []);

  const toggle = () => {
    setOpen((o) => {
      const next = !o;
      try {
        localStorage.setItem(OPEN_KEY, next ? '1' : '0');
      } catch {
        // ignore
      }
      return next;
    });
  };

  const session = getSession();
  if (session?.role !== 'gm') return null;
  if (aiDisabledFrom(status.data, status.error)) return null;

  if (!open) {
    return (
      <button
        className="btn btn-accent fixed bottom-4 right-4 z-40 shadow-glow-cyan"
        onClick={toggle}
        aria-label="Open the Fixer"
      >
        ask the fixer
      </button>
    );
  }

  return (
    <div className="fixed bottom-4 right-4 z-40 flex max-h-[70vh] w-[min(26rem,calc(100vw-2rem))] flex-col">
      <div className="flex items-center justify-end gap-2 pb-1">
        <button className="btn px-2.5 py-1" onClick={toggle} aria-label="Collapse the Fixer">
          dock ▾
        </button>
      </div>
      <FixerChat campaignId={campaignId} sessionLive={sessionLive} dense />
    </div>
  );
}
