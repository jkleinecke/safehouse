/**
 * What the GM is looking at, for the one assistant that follows them
 * everywhere (UX proposal 4.2).
 *
 * The dock used to be a chat with no idea which screen it was floating over,
 * so every screen grew its own AI panel. Now the dock reads the route and
 * the stores, stamps a small context on each message (the server folds it
 * into the situation snapshot as one line, `fixer/context.ts`), and offers
 * chips — the old panels' verbs — for wherever the GM is.
 *
 * The context and the chips are pure functions of plain inputs; the hook is
 * the only thing that touches React.
 */
import { useQuery } from '@tanstack/react-query';
import { useLocation } from 'react-router-dom';
import { apiGet } from '../../../api/client.js';
import type { CodexPage } from '../../codex/api.js';
import { useScene, useSceneTokens } from '../../grid/api.js';
import { useGridStore } from '../../grid/store.js';
import { useActiveSceneId } from '../../grid/useGridLive.js';
import { useCharacter } from '../../sheet/api.js';

/**
 * The codex page under the dock, read directly. The codex feature is a lazy
 * chunk (§15) that nothing outside it may import statically, so the dock
 * keeps its own small query rather than pulling the whole chunk in for one
 * title. A 404 is an answer (a page this device may not read), not a retry.
 */
export function useAiPage(pageId: string | undefined) {
  return useQuery({
    queryKey: ['ai-context', 'page', pageId ?? ''],
    queryFn: async () => (await apiGet<{ page: CodexPage }>(`/api/wiki/${pageId}`)).page,
    enabled: Boolean(pageId),
    retry: false,
  });
}

export type AiScreen =
  | 'map'
  | 'codex'
  | 'sheet'
  | 'sessions'
  | 'scenes'
  | 'runs'
  | 'generator'
  | 'party'
  | 'table'
  | 'other';

/** Mirrors the server's `AiContextSchema` — every field optional, labels short. */
export interface AiContext {
  screen?: AiScreen;
  sceneId?: string;
  sceneName?: string;
  sceneLive?: boolean;
  level?: number;
  levelName?: string;
  selectedTokenId?: string;
  selectedTokenName?: string;
  selectedTokenSource?: 'character' | 'combatant' | 'npc_template' | 'prop';
  pageId?: string;
  pageTitle?: string;
  characterId?: string;
  characterName?: string;
  npcId?: string;
  npcName?: string;
}

/**
 * The ids in the path. The dock lives in the campaign layout, above the
 * routes that own `:pageId` and `:characterId`, so `useParams` there never
 * sees them — the path itself is the one thing both agree on.
 */
export function idsOf(pathname: string): { pageId?: string; characterId?: string } {
  const rest = pathname.replace(/^\/c\/[^/]+\/?/, '').split('/');
  const out: { pageId?: string; characterId?: string } = {};
  if (rest[0] === 'codex' && rest[1]) out.pageId = rest[1];
  if (rest[0] === 'sheet' && rest[1]) out.characterId = rest[1];
  return out;
}

/** Which screen a campaign-relative path is, for the model's orientation. */
export function screenOf(pathname: string): AiScreen {
  const rest = pathname.replace(/^\/c\/[^/]+\/?/, '');
  const head = rest.split('/')[0] ?? '';
  if (head === 'grid') return 'map';
  if (head === 'codex') return 'codex';
  if (head === 'sheet') return 'sheet';
  if (head === 'table') return 'table';
  if (head === 'gm') {
    const sub = rest.split('/')[1] ?? '';
    if (sub === 'sessions') return 'sessions';
    if (sub === 'scenes') return 'scenes';
    if (sub === 'runs') return 'runs';
    if (sub === 'generator') return 'generator';
    if (sub === 'party') return 'party';
  }
  return 'other';
}

export interface ContextChip {
  id: string;
  label: string;
  /** What the chip puts in the box. */
  text: string;
  /** Send at once (no blank to fill) or leave it in the box for the GM to finish. */
  send: boolean;
  /** One line under the label. */
  hint?: string;
}

/**
 * The verbs for this context — what the per-screen panels used to offer,
 * as prompts the one assistant already has the tools for. A chip that ends
 * in a colon wants the GM's words after it and stays in the box.
 */
export function contextChips(ctx: AiContext): ContextChip[] {
  const chips: ContextChip[] = [];
  if (ctx.screen === 'map' && ctx.sceneId) {
    chips.push({
      id: 'read-map',
      label: 'Read the map',
      text: `Read the map image of "${ctx.sceneName ?? 'the scene on screen'}" and propose its rooms and doors as a draft.`,
      send: true,
      hint: 'needs a model that sees images',
    });
    chips.push({
      id: 'reveal',
      label: 'Suggest a reveal',
      text: `Looking at "${ctx.sceneName ?? 'the scene'}", which fog region should be revealed next and why? Propose it as a draft.`,
      send: true,
    });
    if (ctx.selectedTokenName) {
      chips.push({
        id: 'threat',
        label: `Read ${ctx.selectedTokenName}`,
        text: `What is ${ctx.selectedTokenName} [${ctx.selectedTokenId}] on this scene — stats, threat against the party, what they know?`,
        send: true,
      });
    }
  }
  if (ctx.screen === 'codex' && ctx.pageId) {
    const page = `"${ctx.pageTitle ?? 'this page'}" [${ctx.pageId}]`;
    chips.push({
      id: 'describe',
      label: 'Describe it',
      text: `Write the codex page ${page} in full from what the campaign already knows about it; call draft_wiki_page once, player-facing.`,
      send: true,
    });
    chips.push({
      id: 'expand',
      label: 'Expand:',
      text: `Expand the codex page ${page} with a new section about: `,
      send: false,
      hint: 'say which part',
    });
    chips.push({
      id: 'spoilers',
      label: 'Spoiler check',
      text: `Read the codex page ${page} and list anything a player-facing reveal would give away, with the line each spoiler comes from.`,
      send: true,
    });
  }
  if (ctx.screen === 'sheet' && ctx.characterId) {
    chips.push({
      id: 'sheet-read',
      label: `Read ${ctx.characterName ?? 'the sheet'}`,
      text: `Read the sheet of ${ctx.characterName ?? 'this character'} [${ctx.characterId}]: strengths, gaps, and one hook the campaign could use.`,
      send: true,
    });
  }
  if (ctx.screen === 'sessions') {
    chips.push({
      id: 'recap',
      label: 'Draft the recap',
      text: 'Read tonight’s session log and draft the recap for the players; leave out anything they did not learn.',
      send: true,
    });
  }
  if (ctx.screen === 'runs') {
    chips.push({
      id: 'run',
      label: 'Draft a run:',
      text: 'Draft a run for the board — Johnson, the job, the twist, the payout — about: ',
      send: false,
    });
  }
  chips.push({
    id: 'rules',
    label: 'Rules:',
    text: 'In the books, how does this work: ',
    send: false,
    hint: 'answered from your own PDFs, page cited',
  });
  return chips;
}

/** One line for the dock's header: where the assistant thinks the GM is. */
export function contextLine(ctx: AiContext): string | null {
  const bits: string[] = [];
  if (ctx.sceneName) bits.push(`${ctx.sceneName}${ctx.sceneLive === false ? ' (staged)' : ''}`);
  if (ctx.levelName) bits.push(ctx.levelName);
  if (ctx.selectedTokenName) bits.push(`${ctx.selectedTokenName} selected`);
  if (ctx.pageTitle) bits.push(`page: ${ctx.pageTitle}`);
  if (ctx.characterName) bits.push(`sheet: ${ctx.characterName}`);
  return bits.length > 0 ? bits.join(' · ') : null;
}

/**
 * The context for the screen the GM is on. Cheap: every query it reads is
 * one the screen itself already has in the cache.
 */
export function useAiContext(campaignId: string): AiContext {
  const { pathname } = useLocation();
  const params = idsOf(pathname);
  const screen = screenOf(pathname);

  const viewSceneId = useGridStore((s) => s.viewSceneId);
  const activeLevel = useGridStore((s) => s.activeLevel);
  const selectedTokenId = useGridStore((s) => s.selectedTokenId);
  const liveSceneId = useActiveSceneId();
  const sceneId = screen === 'map' ? (viewSceneId ?? liveSceneId) : null;
  const scene = useScene(sceneId);
  const tokens = useSceneTokens(sceneId);
  const page = useAiPage(screen === 'codex' ? params.pageId : undefined);
  const character = useCharacter(screen === 'sheet' ? params.characterId : null);

  const ctx: AiContext = { screen };
  if (sceneId) {
    ctx.sceneId = sceneId;
    const row = scene.data;
    if (row) {
      ctx.sceneName = row.name;
      ctx.sceneLive = sceneId === liveSceneId;
      if (activeLevel > 0) {
        ctx.level = activeLevel;
        const name = row.levels?.[activeLevel - 1]?.name;
        if (name) ctx.levelName = name;
      }
      if (selectedTokenId) {
        const token = (tokens.data ?? []).find((t) => t.id === selectedTokenId);
        if (token) {
          ctx.selectedTokenId = token.id;
          ctx.selectedTokenName = token.name;
          ctx.selectedTokenSource = token.source;
          if (token.source === 'npc_template' && token.sourceId) {
            ctx.npcId = token.sourceId;
            ctx.npcName = token.name;
          }
        }
      }
    }
  }
  if (screen === 'codex' && params.pageId) {
    ctx.pageId = params.pageId;
    if (page.data?.title) ctx.pageTitle = page.data.title;
  }
  if (screen === 'sheet' && params.characterId) {
    ctx.characterId = params.characterId;
    if (character.data?.name) ctx.characterName = character.data.name;
  }
  void campaignId;
  return ctx;
}
