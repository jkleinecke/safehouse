/**
 * "Describe your runner" on Step 1 — the Fixer's draft, as data and words
 * (FR3.9 P6, docs/CHARGEN.md §4.4 Step 1, §8.5 `propose_build`).
 *
 * The server does the drafting (`apps/server/src/fixer/build-draft.ts`): a
 * description in, a proposed build out, laid over the player's own record,
 * run through the validator and never written. This module is the builder's
 * half of that, pure so a node test can pin it:
 *
 * - **The three routes**, as plain functions: whether the Draft button works
 *   for this build (`fetchDraftAvailability`), the draft itself
 *   (`proposeBuild`), and the stop button (`stopDraft`). The proposal's build
 *   is parsed with the contract's own schema, as every build read in this
 *   feature is — a record the walkthrough may autosave cannot be a guess.
 * - **What the draft would change** (`proposalSummary`): the rows a player
 *   weighs a build by — priorities, metatype, magic, the strongest
 *   attributes and skills, qualities, gear, lifestyle, contacts — each as
 *   "was / would be", in the same words the concept cards use, plus the
 *   proposal's own issue counts and what the Fixer could not find.
 * - **Taking it** (`acceptProposal`): a pure updater's body. The spend comes
 *   from the proposal; who the runner is stays the player's (anything typed
 *   while the draft was being written included); the walkthrough's frame and
 *   the GM's fields stay the record's. The shell's autosave then PATCHes it
 *   like any other edit — the lane itself writes nothing.
 *
 * Our own words (DESIGN.md §14).
 */
import {
  ATTRIBUTE_CODES,
  CharacterBuildSchema,
  IssueSchema,
  type BuildAttributeId,
  type CharacterBuild,
  type ChargenSettings,
  type Issue,
} from '@safehouse/contracts';
import { BUILD_ATTRIBUTE_NAMES, budgets, ratings } from '@safehouse/rules';
import { ApiError, apiDelete, apiGet, apiPost } from '../../../../api/client.js';
import { formatNuyen, priorityLine } from '../../lib.js';
import { listWords, magicWords, metatypeName } from './plan.js';

// ---------------------------------------------------------------------------
// Shapes and routes
// ---------------------------------------------------------------------------

/** Why the Draft button is off: the campaign has not turned drafts on, or has no model. */
export type DraftUnavailableReason = 'drafts_off' | 'ai_off';

/** `GET /api/builds/:id/propose` — on or off and why, never the provider or model. */
export interface DraftAvailability {
  available: boolean;
  reason: DraftUnavailableReason | null;
  /** A draft for this build is being written now (another tab, another device). */
  running: boolean;
}

/** `POST /api/builds/:id/propose` — the proposed record, never written. */
export interface BuildProposal {
  build: CharacterBuild;
  issues: Issue[];
  warnings: string[];
  note: string | null;
  model: string;
  usage: { promptTokens: number; completionTokens: number; totalTokens: number };
  latencyMs: number;
}

/** The description's bounds, as the route checks them. */
export const PROMPT_MIN = 3;
export const PROMPT_MAX = 2000;

export const draftKeys = {
  /** Under the build's own key, so a state change that refreshes the build refreshes this too. */
  availability: (buildId: string) => ['build', buildId, 'draft'] as const,
};

/**
 * Tolerant: anything that is not a clear "on" reads as off.
 *
 * The route's own invariant is that a reason and availability are the same
 * fact said twice (`available === (reason === null)`), so a reason present
 * means off however it is spelled — including one a newer server has and this
 * build of the app does not, which hides the box rather than offering a button
 * that would answer 403.
 */
export function normalizeAvailability(raw: unknown): DraftAvailability {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const said = typeof r['reason'] === 'string' && r['reason'].trim() !== '' ? r['reason'] : null;
  const reason: DraftUnavailableReason | null =
    said === 'drafts_off' || said === 'ai_off' ? said : said !== null ? 'drafts_off' : null;
  const available = r['available'] === true && reason === null;
  return { available, reason: available ? null : (reason ?? 'drafts_off'), running: r['running'] === true };
}

/** Strict about the build, as every build read here is; tolerant about the words around it. */
export function normalizeProposal(raw: unknown): BuildProposal {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const build = CharacterBuildSchema.parse(r['build']);
  const issues = Array.isArray(r['issues']) ? r['issues'].flatMap((i) => {
    const parsed = IssueSchema.safeParse(i);
    return parsed.success ? [parsed.data] : [];
  }) : [];
  const warnings = Array.isArray(r['warnings']) ? r['warnings'].filter((w): w is string => typeof w === 'string') : [];
  const usage = (typeof r['usage'] === 'object' && r['usage'] !== null ? r['usage'] : {}) as Record<string, unknown>;
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  return {
    build,
    issues,
    warnings,
    note: typeof r['note'] === 'string' && r['note'].trim() ? r['note'] : null,
    model: typeof r['model'] === 'string' ? r['model'] : '',
    usage: { promptTokens: n(usage['promptTokens']), completionTokens: n(usage['completionTokens']), totalTokens: n(usage['totalTokens']) },
    latencyMs: n(r['latencyMs']),
  };
}

export async function fetchDraftAvailability(buildId: string): Promise<DraftAvailability> {
  return normalizeAvailability(await apiGet<unknown>(`/api/builds/${buildId}/propose`));
}

export async function proposeBuild(buildId: string, prompt: string): Promise<BuildProposal> {
  return normalizeProposal(await apiPost<unknown>(`/api/builds/${buildId}/propose`, { prompt: prompt.trim() }));
}

/** Stop this build's draft; true when there was one to stop. */
export async function stopDraft(buildId: string): Promise<boolean> {
  const r = await apiDelete<{ cancelled?: unknown }>(`/api/builds/${buildId}/propose`);
  return r?.cancelled === true;
}

/** Whether the description is long enough to send. */
export function canDraft(prompt: string): boolean {
  const length = prompt.trim().length;
  return length >= PROMPT_MIN && length <= PROMPT_MAX;
}

/** A refusal in the player's words; null for a stop they asked for (the screen says that its own way). */
export function draftErrorWords(error: unknown): string | null {
  if (!error) return null;
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'ai_cancelled':
        return null;
      // Any of three: this runner on another screen, another runner of this
      // player's, or the whole table at its cap. The server says which and
      // the message is always ours, but it is not echoed here — a code whose
      // words the screen writes itself can never carry anything out.
      case 'ai_busy':
        return 'The Fixer is already drafting a runner — wait for that draft to finish, or stop it if it is this one.';
      case 'ai_drafts_disabled':
        return 'This campaign has turned the Fixer’s drafts off. The GM can turn them on under character creation.';
      case 'ai_disabled':
        return 'The Fixer is switched off for this campaign. The GM can point it at a model under AI.';
      case 'build_state':
        return 'This build can no longer be changed, so there is nothing to draft onto.';
      case 'ai_error':
      case 'ai_unreachable':
        return `The Fixer could not draft this runner: ${error.message}`;
      default:
        return error.message;
    }
  }
  return error instanceof Error ? error.message : String(error);
}

/** Whether an error was the player's own stop. */
export function isDraftStopped(error: unknown): boolean {
  return error instanceof ApiError && error.code === 'ai_cancelled';
}

// ---------------------------------------------------------------------------
// What the draft would change
// ---------------------------------------------------------------------------

export const SUMMARY_KEYS = ['priorities', 'metatype', 'magic', 'attributes', 'skills', 'qualities', 'gear', 'lifestyle', 'contacts'] as const;
export type SummaryKey = (typeof SUMMARY_KEYS)[number];

export interface SummaryLine {
  key: SummaryKey;
  label: string;
  before: string;
  after: string;
  changed: boolean;
}

export interface ProposalSummary {
  lines: SummaryLine[];
  /** How many of the lines the draft changes. */
  changed: number;
  /** The proposal's own issues, by severity. */
  counts: { errors: number; warnings: number; approvals: number };
  /** What the Fixer named and could not find or fit — in the server's words. */
  leftOut: readonly string[];
  note: string | null;
}

const NONE = 'none';

function attributeWords(build: CharacterBuild, settings: ChargenSettings): string {
  if (build.metatype === null && Object.values(build.attributes).every((n) => n === 0)) return NONE;
  const r = ratings(build, settings);
  const order = ATTRIBUTE_CODES as readonly BuildAttributeId[];
  const top = [...order]
    .map((id) => ({ id, rating: r.attributes[id].rating }))
    .sort((a, b) => b.rating - a.rating || order.indexOf(a.id) - order.indexOf(b.id))
    .slice(0, 3);
  return top.map((a) => `${BUILD_ATTRIBUTE_NAMES[a.id].name} ${a.rating}`).join(', ');
}

function skillWords(build: CharacterBuild, settings: ChargenSettings): string {
  const rated = ratings(build, settings)
    .skills.filter((s) => s.rating > 0)
    .map((s) => ({ name: s.row?.name ?? s.id, rating: s.rating }))
    .sort((a, b) => b.rating - a.rating || a.name.localeCompare(b.name));
  if (rated.length === 0) return NONE;
  const shown = rated.slice(0, 4).map((s) => `${s.name} ${s.rating}`);
  return rated.length > 4 ? `${shown.join(', ')} and ${rated.length - 4} more` : shown.join(', ');
}

function qualityWords(build: CharacterBuild): string {
  if (build.qualities.length === 0) return NONE;
  const names = build.qualities.map((q) => (q.rating !== null ? `${q.name} ${q.rating}` : q.name));
  return names.length > 3 ? `${names.slice(0, 3).join(', ')} and ${names.length - 3} more` : listWords(names);
}

function gearWords(build: CharacterBuild, settings: ChargenSettings): string {
  if (build.purchases.length === 0) return NONE;
  const items = build.purchases.length;
  const spent = budgets(build, settings).pools.nuyen.spent;
  return `${items} item${items === 1 ? '' : 's'}, ${formatNuyen(spent)} spent`;
}

function lifestyleWords(build: CharacterBuild): string {
  if (build.lifestyles.length === 0) return NONE;
  return listWords(build.lifestyles.map((l) => `${l.name}, ${l.months} month${l.months === 1 ? '' : 's'}`));
}

function contactWords(build: CharacterBuild): string {
  const n = build.karma.contacts.length;
  return n === 0 ? NONE : `${n} contact${n === 1 ? '' : 's'}`;
}

const READERS: Readonly<Record<SummaryKey, { label: string; words: (b: CharacterBuild, s: ChargenSettings) => string }>> = {
  priorities: {
    label: 'Priorities',
    words: (b) => (Object.values(b.priorities).some((p) => p !== null) ? priorityLine(b) : NONE),
  },
  metatype: { label: 'Metatype', words: (b) => metatypeName(b.metatype) },
  magic: { label: 'Magic', words: (b) => magicWords(b.magic) },
  attributes: { label: 'Strongest attributes', words: attributeWords },
  skills: { label: 'Best skills', words: skillWords },
  qualities: { label: 'Qualities', words: qualityWords },
  gear: { label: 'Gear', words: gearWords },
  lifestyle: { label: 'Lifestyle', words: lifestyleWords },
  contacts: { label: 'Contacts', words: contactWords },
};

/**
 * The draft beside the build it would replace, a line per thing a player
 * weighs a runner by, and the proposal's own issues. `current` is the record
 * as it stands now — which may have moved on while the draft was written.
 */
export function proposalSummary(
  current: CharacterBuild,
  proposal: Pick<BuildProposal, 'build' | 'issues' | 'warnings' | 'note'>,
  settings: ChargenSettings,
): ProposalSummary {
  const next = proposal.build;
  const lines = SUMMARY_KEYS.map((key): SummaryLine => {
    const reader = READERS[key];
    const before = reader.words(current, settings);
    const after = reader.words(next, settings);
    return { key, label: reader.label, before, after, changed: before !== after };
  });
  const by = (severity: Issue['severity']) => proposal.issues.filter((i) => i.severity === severity).length;
  return {
    lines,
    changed: lines.filter((l) => l.changed).length,
    counts: { errors: by('error'), warnings: by('warning'), approvals: by('approval') },
    leftOut: proposal.warnings,
    note: proposal.note,
  };
}

/** "2 errors to fix, 1 warning, 1 for the GM" — or that the draft holds none. */
export function issueCountWords(counts: ProposalSummary['counts']): string {
  const parts: string[] = [];
  if (counts.errors > 0) parts.push(`${counts.errors} error${counts.errors === 1 ? '' : 's'} to fix`);
  if (counts.warnings > 0) parts.push(`${counts.warnings} warning${counts.warnings === 1 ? '' : 's'}`);
  if (counts.approvals > 0) parts.push(`${counts.approvals} for the GM to decide`);
  return parts.length === 0 ? 'Nothing for the rules to flag.' : `The rules flag ${listWords(parts)}.`;
}

// ---------------------------------------------------------------------------
// Taking it
// ---------------------------------------------------------------------------

/** "Keep what is there unless it is empty." */
const keptText = (mine: string | undefined, drafted: string | undefined): string | undefined =>
  mine !== undefined && mine.trim() !== '' ? mine : drafted;

/**
 * The record with the draft taken: every spend section from the proposal;
 * who the runner is from the record as it stands (the alias unless it is
 * empty, and the same for real name, age, sex and background — the draft
 * fills only blanks), with the proposal's concept card, since the spend is
 * now the draft's; and the walkthrough's frame and the GM's fields — method,
 * level, printing, mode, step, approvals, notes, returned step, state — from
 * the record, never from the proposal.
 */
export function acceptProposal(current: CharacterBuild, proposed: CharacterBuild): CharacterBuild {
  const mine = current.identity;
  const drafted = proposed.identity;
  const realName = keptText(mine.realName, drafted.realName);
  const sex = keptText(mine.sex, drafted.sex);
  const background = keptText(mine.background, drafted.background);
  const age = mine.age != null ? mine.age : drafted.age;
  const { realName: _r, sex: _s, background: _b, age: _a, concept: _c, ...rest } = mine;
  void _r;
  void _s;
  void _b;
  void _a;
  void _c;
  return {
    ...current,
    priorities: proposed.priorities,
    metatype: proposed.metatype,
    special: proposed.special,
    attributes: proposed.attributes,
    magic: proposed.magic,
    grants: proposed.grants,
    powers: proposed.powers,
    qualities: proposed.qualities,
    skills: proposed.skills,
    purchases: proposed.purchases,
    lifestyles: proposed.lifestyles,
    karma: proposed.karma,
    identity: {
      ...rest,
      alias: mine.alias.trim() !== '' ? mine.alias : drafted.alias,
      ...(realName !== undefined ? { realName } : {}),
      ...(sex !== undefined ? { sex } : {}),
      ...(background !== undefined ? { background } : {}),
      ...(age != null ? { age } : {}),
      ...(drafted.concept !== undefined ? { concept: drafted.concept } : {}),
    },
  };
}
