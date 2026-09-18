/**
 * The one assistant, everywhere (FR12.1, UX proposal 4.2): GM-only, docked
 * over every screen, and aware of what that screen shows.
 *
 * Collapsed it is a corner chip; open it is the chat with a line saying
 * where the assistant thinks the GM is, chips for the verbs that screen used
 * to keep in its own panel, and — when the screen calls for it — the floor
 * drafter (map, Build mode), the page workshop (a codex page) and the NPC
 * voice (an NPC token selected), each the same component that used to live
 * on its screen. Backtick opens and closes it from anywhere.
 *
 * Mounted once in CampaignLayout so it follows the GM, floating clear of the
 * bars a screen pins to its bottom edge (`dockPlacement`). Hides entirely for
 * non-GM devices and when no LLM is configured (NG7).
 */
import { Suspense, lazy, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { levelTiles } from '@safehouse/rules';
import { getSession } from '../../../api/session.js';
import { useScene } from '../../grid/api.js';
import BuildWithAi from '../../grid/gm/BuildWithAi.js';
import { DEFAULT_TILESET_ID, useGridStore } from '../../grid/store.js';
import { aiDisabledFrom, useFixerStatus } from './api.js';
import { contextChips, contextLine, useAiContext, useAiPage } from './aiContext.js';
import { dockPlacement } from './dockPlacement.js';

// The codex is a lazy chunk (§15): its page workshop is pulled in only when
// the dock actually shows it, never on every screen the dock floats over.
const AiPanel = lazy(() => import('../../codex/ai/index.js').then((m) => ({ default: m.AiPanel })));
import FixerChat from './FixerChat.js';
import NpcVoice from './NpcVoice.js';

const OPEN_KEY = 'safehouse.fixerDock.open';

type DockTab = 'chat' | 'floor' | 'page' | 'voice';

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
  const [seed, setSeed] = useState<{ text: string; send: boolean; nonce: number } | null>(null);
  const ctx = useAiContext(campaignId);
  const placement = dockPlacement(useLocation().pathname);
  const scene = useScene(tab === 'floor' && ctx.sceneId ? ctx.sceneId : null);
  const paletteTileset = useGridStore((s) => s.tilesetId);
  const page = useAiPage(tab === 'page' ? ctx.pageId : undefined);

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

  if (!open) {
    return (
      <button
        className={`btn fixed z-40 ${placement}`}
        onClick={toggle}
        aria-label="Open the Fixer"
        title="Ask the Fixer about what you are looking at (`)"
      >
        ask the fixer
      </button>
    );
  }

  const canFloor = ctx.screen === 'map' && Boolean(ctx.sceneId);
  const canPage = ctx.screen === 'codex' && Boolean(ctx.pageId);
  const canVoice = Boolean(ctx.npcId);
  const tabs: Array<{ id: DockTab; label: string; on: boolean }> = [
    { id: 'chat', label: 'chat', on: true },
    { id: 'floor', label: 'draft a floor', on: canFloor },
    { id: 'page', label: 'this page', on: canPage },
    { id: 'voice', label: `speak as ${ctx.npcName ?? 'them'}`, on: canVoice },
  ];
  // A tab that no longer applies falls back to the chat.
  const shown: DockTab = tabs.find((t) => t.id === tab)?.on ? tab : 'chat';
  const where = contextLine(ctx);
  const chips = contextChips(ctx);
  const floorScene = scene.data ?? null;
  const floorLevel = ctx.level ?? 0;
  // The set the plan is drawn in: what the floor already carries, else the
  // palette's current set (a scene switched to the lake before anything is
  // painted has no tiles yet, and the Tiles tab keeps the store in step).
  const floorTileset = (floorScene ? levelTiles(floorScene, floorLevel)?.tilesetId : undefined) ?? paletteTileset ?? DEFAULT_TILESET_ID;

  return (
    <div
      className={`fixed z-40 flex max-h-[76vh] w-[min(28rem,calc(100vw-2rem))] flex-col rounded-md border border-edge bg-deck/95 p-2 shadow-lg backdrop-blur ${placement}`}
      data-testid="fixer-dock"
    >
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
        <button className="btn px-2.5 py-1" onClick={toggle} aria-label="Collapse the Fixer">
          dock ▾
        </button>
      </div>
      {where && (
        <div className="mono-label mb-1 truncate px-1 text-faint" data-testid="fixer-context" title={where}>
          looking at · {where}
        </div>
      )}
      {shown === 'chat' && (
        <>
          <div className="mb-1 flex flex-wrap gap-1 px-1" data-testid="fixer-chips">
            {chips.map((c) => (
              <button
                key={c.id}
                type="button"
                className="chip text-dim hover:text-cyan"
                title={c.hint ?? c.text}
                onClick={() => setSeed({ text: c.text, send: c.send, nonce: Date.now() })}
              >
                {c.label}
              </button>
            ))}
          </div>
          <FixerChat campaignId={campaignId} sessionLive={sessionLive} dense context={ctx} seed={seed} />
        </>
      )}
      {shown === 'floor' && floorScene && (
        <div className="panel overflow-y-auto p-3">
          <BuildWithAi scene={floorScene} tilesetId={floorTileset} level={floorLevel} />
        </div>
      )}
      {shown === 'page' && page.data && (
        <div className="overflow-y-auto">
          <Suspense fallback={<span className="mono-label animate-pulse text-cyan">loading the page workshop</span>}>
            <AiPanel key={page.data.id} campaignId={campaignId} page={page.data} sessionLive={sessionLive} />
          </Suspense>
        </div>
      )}
      {shown === 'voice' && ctx.npcId && (
        <div className="overflow-y-auto">
          <NpcVoice key={ctx.npcId} campaignId={campaignId} sessionLive={sessionLive} npcId={ctx.npcId} />
        </div>
      )}
    </div>
  );
}
