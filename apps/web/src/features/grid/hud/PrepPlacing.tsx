/**
 * What the GM puts on the map in Prep, as Build's placing row does for tiles:
 * one control per kind of thing, each a split button — press the face to
 * pick the tool up, press the caret to say which one.
 *
 *   Token ▾   which runner, NPC or prop, and how big — then click the map
 *   Fog ▾     a rectangle (two clicks) or a polygon (click round, back on the first)
 *   Camera    click to mount one
 *   Note      click to drop one
 *
 * The Tokens tab's placement form (pick, size, "place at centre") and the Fog
 * tab's drafting section (click, name, save polygon / save rect / clear) were
 * the same questions asked in the panel, a long way from the map they were
 * about; here the answer is where the click lands.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useCharacters, useNpcTemplates } from '../api.js';
import { useGridStore, type TokenStamp } from '../store.js';
import type { GridTool } from '../types.js';
import HudButton, { HudIcon } from './HudButton.js';
import { toolTitle } from './Toolbar.js';

function useMenu() {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return undefined;
    const away = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', key);
    };
  }, [open]);
  return { open, setOpen, box };
}

/** A tool with a caret beside it, and the menu the caret opens. */
function Split({
  tool,
  label,
  glyph,
  face,
  menuLabel,
  children,
}: {
  tool: GridTool;
  label: string;
  glyph: string;
  /** Pressing the face: pick the tool up (or, with nothing chosen yet, open the menu). */
  face?: (open: () => void) => void;
  menuLabel: string;
  children: (close: () => void) => ReactNode;
}) {
  const current = useGridStore((s) => s.tool);
  const setTool = useGridStore((s) => s.setTool);
  const { open, setOpen, box } = useMenu();
  return (
    <div ref={box} className="relative flex items-center">
      <HudButton
        active={current === tool}
        title={label}
        testId={`tool-${tool}`}
        onClick={() => (face ? face(() => setOpen(true)) : setTool(tool))}
        className="rounded-r-none"
      >
        <HudIcon>{glyph}</HudIcon>
      </HudButton>
      <button
        type="button"
        data-testid={`prep-menu-${tool}`}
        title={menuLabel}
        aria-label={menuLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="btn -ml-px rounded-l-none px-1 py-1.5 text-[0.6rem] text-dim"
      >
        <span aria-hidden>▾</span>
      </button>
      {open && (
        <div
          role="menu"
          aria-label={menuLabel}
          className="absolute left-0 top-full z-30 mt-1 max-h-96 w-64 overflow-y-auto rounded-lg border border-edge bg-panel p-1 shadow-lg"
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

function Heading({ children }: { children: ReactNode }) {
  return <div className="mono-label px-1.5 pb-0.5 pt-1.5 text-faint">{children}</div>;
}

function Item({ on, children, onClick }: { on: boolean; children: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={on}
      onClick={onClick}
      className={
        'flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-xs ' +
        (on ? 'bg-raised text-cyan' : 'text-ink hover:bg-raised/60')
      }
    >
      {children}
    </button>
  );
}

function TokenMenu({ campaignId, close }: { campaignId: string; close: () => void }) {
  const stamp = useGridStore((s) => s.tokenStamp);
  const setStamp = useGridStore((s) => s.setTokenStamp);
  const setTool = useGridStore((s) => s.setTool);
  const characters = useCharacters(campaignId, true);
  const templates = useNpcTemplates(campaignId, true);
  const [prop, setProp] = useState('');
  const pick = (next: TokenStamp) => {
    setStamp(next);
    setTool('token');
    close();
  };
  const chosen = (kind: TokenStamp['kind'], id: string | null) => stamp?.kind === kind && stamp.sourceId === id;
  return (
    <div data-testid="token-menu">
      <Heading>Runners</Heading>
      {(characters.data ?? []).map((c) => (
        <Item key={c.id} on={chosen('character', c.id)} onClick={() => pick({ kind: 'character', sourceId: c.id, name: c.name ?? c.alias ?? 'Runner' })}>
          {c.name ?? c.alias ?? c.id}
        </Item>
      ))}
      {(characters.data ?? []).length === 0 && <p className="px-1.5 text-xs text-faint">no characters yet</p>}
      <Heading>NPCs</Heading>
      {(templates.data ?? []).map((t) => (
        <Item key={t.id} on={chosen('npc_template', t.id)} onClick={() => pick({ kind: 'npc_template', sourceId: t.id, name: t.name })}>
          {t.name}
        </Item>
      ))}
      {(templates.data ?? []).length === 0 && <p className="px-1.5 text-xs text-faint">no NPC templates yet</p>}
      <Heading>Prop</Heading>
      <form
        className="flex items-center gap-1 px-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          pick({ kind: 'prop', sourceId: null, name: prop.trim() || 'Prop' });
        }}
      >
        <input
          className="min-w-0 flex-1 rounded border border-edge bg-deck px-1.5 py-1 text-xs text-ink"
          placeholder="Crate, van, barricade…"
          value={prop}
          onChange={(e) => setProp(e.target.value)}
          aria-label="Prop name"
        />
        <button type="submit" className="btn px-2 py-1 text-xs">
          use
        </button>
      </form>
    </div>
  );
}

/** Squares a token covers, and what usually fills that many — the hint beside each choice. */
const SIZES: ReadonlyArray<[number, string]> = [
  [1, 'a person'],
  [2, 'a troll, a bike, a drone swarm'],
  [3, 'a car, a large spirit'],
  [4, 'a van'],
  [6, 'a truck'],
];

/**
 * How big the next token is: its own menu beside Token, so it can be set
 * before or after the pick and stays for every token placed after it.
 */
function SizeMenu() {
  const size = useGridStore((s) => s.tokenSize);
  const setSize = useGridStore((s) => s.setTokenSize);
  const { open, setOpen, box } = useMenu();
  return (
    <div ref={box} className="relative flex items-center">
      <button
        type="button"
        className="btn min-h-9 gap-1 px-2 py-1 text-xs"
        title="Token size — squares across"
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid="token-size"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="tabular-nums">
          {size}×{size}
        </span>
        <span aria-hidden className="text-[0.6rem] text-dim">
          ▾
        </span>
      </button>
      {open && (
        <div role="menu" aria-label="Token size" className="absolute left-0 top-full z-30 mt-1 w-60 rounded-lg border border-edge bg-panel p-1 shadow-lg">
          {SIZES.map(([n, hint]) => (
            <Item
              key={n}
              on={size === n}
              onClick={() => {
                setSize(n);
                setOpen(false);
              }}
            >
              <span className="w-10 tabular-nums">
                {n}×{n}
              </span>
              <span className="mono-label text-faint">{hint}</span>
            </Item>
          ))}
        </div>
      )}
    </div>
  );
}

export default function PrepPlacing({ campaignId }: { campaignId: string }) {
  const stamp = useGridStore((s) => s.tokenStamp);
  const setTool = useGridStore((s) => s.setTool);
  const fogShape = useGridStore((s) => s.fogShape);
  const setFogShape = useGridStore((s) => s.setFogShape);
  const clearFogDraft = useGridStore((s) => s.clearFogDraft);
  const current = useGridStore((s) => s.tool);
  return (
    <div className="flex items-center gap-1.5" role="group" aria-label="Placing">
      <Split
        tool="token"
        glyph="●"
        label={stamp ? `Token: ${stamp.name}` : 'Token'}
        menuLabel="Pick a token"
        face={(open) => (stamp ? setTool('token') : open())}
      >
        {(close) => <TokenMenu campaignId={campaignId} close={close} />}
      </Split>
      <SizeMenu />
      <Split tool="fogdef" glyph="⬡" label={fogShape === 'rect' ? 'Fog: rectangle' : 'Fog: polygon'} menuLabel="Fog shape">
        {(close) => (
          <>
            <Item
              on={fogShape === 'rect'}
              onClick={() => {
                setFogShape('rect');
                clearFogDraft();
                setTool('fogdef');
                close();
              }}
            >
              <span className="flex-1">Rectangle</span>
              <span className="mono-label text-faint">two corners</span>
            </Item>
            <Item
              on={fogShape === 'polygon'}
              onClick={() => {
                setFogShape('polygon');
                clearFogDraft();
                setTool('fogdef');
                close();
              }}
            >
              <span className="flex-1">Polygon</span>
              <span className="mono-label text-faint">back on the first to close</span>
            </Item>
          </>
        )}
      </Split>
      {(['camera', 'note'] as const).map((t) => (
        <HudButton
          key={t}
          active={current === t}
          title={toolTitle(t)}
          testId={`tool-${t}`}
          onClick={() => setTool(t)}
        >
          <HudIcon>{t === 'camera' ? '◉' : '🗒'}</HudIcon>
        </HudButton>
      ))}
    </div>
  );
}
