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
  READ_ONLY_TOOLS,
  TOOLS_BY_NAME,
  executeTool,
  toolDefinitions,
  toolParameters,
  type FixerTool,
  type ToolContext,
  type ToolRunResult,
} from './tools.js';

export { CODEX_TOOLS } from './tools-codex.js';
export { RECAP_TOOLS } from './tools-recap.js';
export { TABLE_TOOLS } from './tools-table.js';
export { VISION_TOOL_NAME } from './tools.js';

export {
  MAX_VISION_IMAGE_BYTES,
  MapVisionProposalSchema,
  PROBE_IMAGE_DATA_URI,
  VISION_MIME_TYPES,
  cachedVisionCapability,
  gridAlignmentWarnings,
  loadMapImage,
  mapVisionJsonSchema,
  parseModelJson,
  proposeGeometryFromMap,
  readPropsVision,
  resetVisionCache,
  visionCapability,
  visionEnvOverride,
  type MapImage,
  type MapVisionInput,
  type MapVisionProposal,
  type MapVisionResult,
  type VisionCapability,
  type VisionVia,
} from './vision.js';

export {
  RECAP_EVENT_LIMIT,
  assembleRecap,
  recapDigest,
  recapSessionRow,
  type RecapAward,
  type RecapContribution,
  type RecapDigest,
  type RecapMoment,
  type RecapProse,
} from './recap.js';

export { default as fixerToolRoutes } from './routes.js';

export {
  LayoutDoorSchema,
  LayoutProposalSchema,
  LayoutRoomSchema,
  ROOM_KINDS,
  compileLayout,
  layoutJsonSchema,
  type CompiledLayout,
  type CompiledRoom,
  type LayoutDoor,
  type LayoutProposal,
  type LayoutRoom,
} from './geometry.js';

export {
  DEFAULT_PROXIMITY_M,
  distanceToPolygon,
  emitFogProximity,
  fogProximityPrompts,
  fogProximityState,
  pointInPolygon,
  resetProximityMemory,
  type ProximityPrompt,
  type ProximityState,
} from './proximity.js';

export {
  baseName,
  identifyTokensState,
  type TokenIdentification,
  type TokenIdentificationState,
} from './token-id.js';

export {
  FIXER_SYSTEM_PROMPT,
  MAX_TOOL_ROUNDS,
  buildSituationSnapshot,
  npcSystemPrompt,
  runFixerChat,
  runNpcConverse,
  toolsFor,
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
  campaignUsage,
  persistTurnUsage,
  usageMeter,
  type DurableUsage,
  type ModelUsage,
  type TurnUsageInput,
  type UsageKind,
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

export {
  readContactFavors,
  getBookPageState,
  getCalendarState,
  getRunState,
  listContactsState,
  listRunsState,
  searchCodexState,
  type BookPageState,
  type CalendarState,
  type CodexSearchState,
  type ContactsState,
  type Favors,
  type RunState,
  type RunSummary,
} from './state-codex.js';

export {
  getMagicState,
  getMatrixState,
  type MagicState,
  type MatrixState,
} from './state-play.js';

export { MockLlmServer, type MockResponder, type MockTurn } from './mock-llm.js';
