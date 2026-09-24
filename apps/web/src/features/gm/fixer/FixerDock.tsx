/**
 * The one assistant, everywhere (FR12.1, UX proposal 4.2): GM-only, docked
 * over every screen, and aware of what that screen shows.
 *
 * Collapsed it is a corner chip; open it is a drawer slid in from the right
 * edge (drag its left edge to widen, double-click to reset) holding the chat
 * with a line saying where the assistant thinks the GM is, and — when the
 * screen calls for it — the floor
 * drafter (map, Build mode), the page workshop (a codex page) and the NPC
 * voice (an NPC token selected), each the same component that used to live
 * on its screen. Backtick opens and closes it from anywhere.
 *
 * Mounted once in CampaignLayout so it follows the GM, floating clear of the
 * bars a screen pins to its bottom edge (`dockPlacement`). Hides entirely for
 * non-GM devices and when no LLM is configured (NG7).
 */
import { Suspense, lazy, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useLocation } from 'react-router-dom';
import { getSession } from '../../../api/session.js';
import { aiDisabledFrom, useFixerStatus } from './api.js';
import { contextLine, useAiContext, useAiPage } from './aiContext.js';
import { dockPlacement } from './dockPlacement.js';

// The codex is a lazy chunk (§15): its page workshop is pulled in only when
// the dock actually shows it, never on every screen the dock floats over.
const AiPanel = lazy(() => import('../../codex/ai/index.js').then((m) => ({ default: m.AiPanel })));
import FixerChat from './FixerChat.js';
import NpcVoice from './NpcVoice.js';

const OPEN_KEY = 'safehouse.fixerDock.open';
const WIDTH_KEY = 'safehouse.fixerDock.width';
const DEFAULT_WIDTH = 448;
const MIN_WIDTH = 320;

/** Keep the drawer between a readable minimum and most of the window. */
function clampWidth(px: number): number {
  const max = Math.max(MIN_WIDTH, Math.round(window.innerWidth * 0.9));
  return Math.min(max, Math.max(MIN_WIDTH, Math.round(px)));
}

type DockTab = 'chat' | 'page' | 'voice';

export interface FixerDockProps {
  campaignId: string;
  sessionLive?: boolean;
}

function typingSomewhere(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (el as HTMLElement).isContentEditable;
}

export default function FixerDock({ campaignId, sessionLive }: FixerDockProps) {
  const status = useFixerStatus();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<DockTab>('chat');
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const dragging = useRef(false);
  const ctx = useAiContext(campaignId);
  const placement = dockPlacement(useLocation().pathname);
  const page = useAiPage(tab === 'page' ? ctx.pageId : undefined);

  useEffect(() => {
    try {
      setOpen(localStorage.getItem(OPEN_KEY) === '1');
      const stored = Number(localStorage.getItem(WIDTH_KEY));
      if (stored > 0) setWidth(clampWidth(stored));
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

  const saveWidth = (px: number) => {
    try {
      localStorage.setItem(WIDTH_KEY, String(px));
    } catch {
      // ignore
    }
  };

  // Drag the left edge: the width is the pointer's distance from the window's right edge.
  const onHandleDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    dragging.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onHandleMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (dragging.current) setWidth(clampWidth(window.innerWidth - e.clientX));
  };
  const onHandleUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    dragging.current = false;
    e.currentTarget.releasePointerCapture(e.pointerId);
    const next = clampWidth(window.innerWidth - e.clientX);
    setWidth(next);
    saveWidth(next);
  };
  const resetWidth = () => {
    setWidth(DEFAULT_WIDTH);
    saveWidth(DEFAULT_WIDTH);
  };

  // Backtick: the dock from anywhere, unless the GM is typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '`' || e.ctrlKey || e.metaKey || e.altKey || typingSomewhere()) return;
      e.preventDefault();
      toggle();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const session = getSession();
  if (session?.role !== 'gm') return null;
  if (aiDisabledFrom(status.data, status.error)) return null;

  const canPage = ctx.screen === 'codex' && Boolean(ctx.pageId);
  const canVoice = Boolean(ctx.npcId);
  const tabs: Array<{ id: DockTab; label: string; on: boolean }> = [
    { id: 'chat', label: 'chat', on: true },
    { id: 'page', label: 'this page', on: canPage },
    { id: 'voice', label: `speak as ${ctx.npcName ?? 'them'}`, on: canVoice },
  ];
  // A tab that no longer applies falls back to the chat.
  const shown: DockTab = tabs.find((t) => t.id === tab)?.on ? tab : 'chat';
  const where = contextLine(ctx);

  // The drawer stays mounted while closed — slid off the right edge and
  // invisible — so opening it animates and the conversation survives a close.
  return (
    <>
      {!open && (
        <button
          className={`btn fixed z-40 ${placement}`}
          onClick={toggle}
          aria-label="Open the Fixer"
          title="Ask the Fixer about what you are looking at (`)"
        >
          ask the fixer
        </button>
      )}
      <aside
        className={`fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-edge bg-deck/95 p-2 pt-[max(0.5rem,env(safe-area-inset-top))] pb-[max(0.5rem,env(safe-area-inset-bottom))] shadow-2xl backdrop-blur transition-[transform,visibility] duration-200 ease-out md:w-[var(--fixer-w)] ${
          open ? 'visible translate-x-0' : 'invisible translate-x-full'
        }`}
        style={{ ['--fixer-w' as string]: `${width}px` }}
        aria-hidden={!open}
        data-testid="fixer-dock"
      >
        <div
          className="absolute inset-y-0 left-0 hidden w-1.5 -translate-x-1/2 cursor-col-resize touch-none hover:bg-cyan/40 active:bg-cyan/60 md:block"
          role="separator"
          aria-orientation="vertical"
          aria-label="Drag to resize the Fixer"
          title="Drag to widen · double-click to reset"
          onPointerDown={onHandleDown}
          onPointerMove={onHandleMove}
          onPointerUp={onHandleUp}
          onPointerCancel={onHandleUp}
          onDoubleClick={resetWidth}
        />
        <div className="flex items-center justify-between gap-2 pb-1">
          <div className="flex min-w-0 items-center gap-1">
            {tabs
              .filter((t) => t.on)
              .map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={`chip ${shown === t.id ? 'border-cyan text-cyan' : 'text-dim hover:text-ink'}`}
                  aria-pressed={shown === t.id}
                  onClick={() => setTab(t.id)}
                >
                  {t.label}
                </button>
              ))}
          </div>
          <button className="btn px-2.5 py-1" onClick={toggle} aria-label="Close the Fixer">
            close ▸
          </button>
        </div>
        {where && (
          <div className="mono-label mb-1 truncate px-1 text-faint" data-testid="fixer-context" title={where}>
            looking at · {where}
          </div>
        )}
        {shown === 'chat' && (
          <FixerChat campaignId={campaignId} sessionLive={sessionLive} dense fill context={ctx} />
        )}
        {shown === 'page' && page.data && (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <Suspense fallback={<span className="mono-label animate-pulse text-cyan">loading the page workshop</span>}>
              <AiPanel key={page.data.id} campaignId={campaignId} page={page.data} sessionLive={sessionLive} />
            </Suspense>
          </div>
        )}
        {shown === 'voice' && ctx.npcId && (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <NpcVoice key={ctx.npcId} campaignId={campaignId} sessionLive={sessionLive} npcId={ctx.npcId} />
          </div>
        )}
      </aside>
    </>
  );
}
