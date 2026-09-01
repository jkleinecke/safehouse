/**
 * AI inside the codex (M12 × M5) — the GM's "help me fill this in".
 *
 * Import from here rather than from the deep paths. `AiPanel` is the on-page
 * block (draft / expand / summarise the log / suggest links); `NewPagePrompt`
 * is the browser-pane "describe a page and get one". Both produce
 * `ProposalCard`s, and a proposal is never applied text — the GM accepts, edits
 * or rejects it (Principle 8).
 */
export { default as AiPanel } from './AiPanel.js';
export type { AiPanelProps } from './AiPanel.js';
export { default as NewPagePrompt } from './NewPagePrompt.js';
export type { NewPagePromptProps } from './NewPagePrompt.js';
export { default as ProposalCard } from './ProposalCard.js';
export type { AcceptPayload, ProposalCardProps } from './ProposalCard.js';

export {
  codexAiKeys,
  proposalFromDraft,
  useAcceptAsNewPage,
  useApplyToPage,
  useCodexAsk,
  useRejectProposal,
  useWikiDrafts,
} from './api.js';
export type {
  AcceptAsPageInput,
  ApplyInput,
  AskInput,
  CodexProposal,
  ProposalSeed,
} from './api.js';

export {
  ACTION_BY_ID,
  CODEX_AI_ACTIONS,
  applyProposal,
  askErrorLine,
  buildPrompt,
  diffLines,
  diffStat,
  disabledReason,
  headingLines,
  isStub,
  sectionRange,
  sectionText,
  titleFromBrief,
} from './lib.js';
export type {
  ActionSpec,
  CodexAiAction,
  DiffKind,
  DiffLine,
  MergeMode,
  PageContext,
  PromptInput,
} from './lib.js';
