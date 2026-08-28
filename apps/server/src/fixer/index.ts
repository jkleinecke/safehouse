/**
 * The Fixer (M12) — barrel. The GM's AI copilot: an OpenAI-compatible client
 * against a local model, a read-only live-state tool catalog (FR12.17), an
 * agent loop that streams to the GM's panel, and drafts that never apply
 * themselves (Principle 8).
 */
export {
  LlmClient,
  ChatAccumulator,
  chatCompletionsUrl,
  isAiEnabled,
  llmConfigFromEnv,
  sseLines,
  ZERO_USAGE,
  type ChatMessage,
  type ChatOptions,
  type ChatRequest,
  type ChatToolCall,
  type ChatTurn,
  type LlmConfig,
  type LlmUsage,
  type ModelSlot,
  type ToolDefinition,
} from './llm.js';

export {
  FIXER_TOOLS,
  TOOLS_BY_NAME,
  executeTool,
  toolDefinitions,
  toolParameters,
  type FixerTool,
  type ToolContext,
  type ToolRunResult,
} from './tools.js';

export {
  FIXER_SYSTEM_PROMPT,
  MAX_TOOL_ROUNDS,
  buildSituationSnapshot,
  npcSystemPrompt,
  runFixerChat,
  runNpcConverse,
  type FixerChatInput,
  type FixerDeps,
  type FixerHub,
  type FixerToolTrace,
  type FixerTurnResult,
  type NpcConverseInput,
} from './agent.js';

export {
  HISTORY_WINDOW,
  listConversations,
  loadConversation,
  saveConversation,
  type ConversationHandle,
  type ConversationSummary,
} from './conversations.js';

export {
  DRAFT_KINDS,
  acceptDraft,
  createDraft,
  getDraft,
  listDrafts,
  rejectDraft,
  serializeDraft,
  spoilerScan,
  type AcceptResult,
  type AppliedRef,
  type CreateDraftInput,
  type DraftDto,
  type DraftKind,
  type SpoilerFlag,
} from './drafts.js';

export {
  UsageMeter,
  usageMeter,
  type ModelUsage,
  type UsageRecord,
  type UsageTotals,
} from './usage.js';

export {
  getCampaignState,
  getCharacterState,
  getEncounterState,
  getLedgerState,
  getNpcState,
  getSceneState,
  getSessionLogState,
  isSessionLive,
  listCharactersState,
  listNpcsState,
  searchBooksState,
  type CampaignState,
  type CharacterState,
  type CharacterSummary,
  type EncounterState,
  type LedgerState,
  type SceneState,
} from './state.js';

export { MockLlmServer, type MockResponder, type MockTurn } from './mock-llm.js';
