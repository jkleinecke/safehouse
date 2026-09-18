/**
 * The contract between the walkthrough shell and a step screen (FR3.9,
 * docs/CHARGEN.md §4.4, §8.6).
 *
 * The shell owns everything *around* a step: loading and autosave, the
 * progress strip, the rail and issues list, the frame with its intro, "why?"
 * link and Back/Next gate, the GM's note, guided versus free mode. A step
 * screen owns only its body, and it gets everything it needs as props — so a
 * step can be rendered to static markup in a node test with a hand-built
 * `StepProps`, and so no step ever re-derives a rule the engine already
 * answers.
 *
 * ## The rules a step follows
 *
 * - **Edit through `update(fn)` only**, with a pure `CharacterBuild →
 *   CharacterBuild` function — preferably the engine's own updaters
 *   (`setPriority`, `setMetatype`, `setAttributePoints`, `applyConcept`…) or a
 *   field set. The shell recomputes budgets, issues, steps and the preview
 *   from the result on the same render and schedules the autosave. Never
 *   mutate `build`; never keep a private copy of it in component state
 *   (that copy would miss a GM's return or a save's echo).
 * - **Ask the engine, show the answer.** Remaining points are
 *   `budgets.pools.*.remaining`; what is wrong is `issues` (this step's) with
 *   each issue's `ref` for the "why?" chip; whether a skill or group is open
 *   is `skillEligibilityIn(eligibility, row)` / `groupEligibilityIn`; the
 *   derived numbers (limits, initiative, pools) are `preview.derived`;
 *   bases, maxima, granted and group ratings are `ratings`.
 * - **Refuse before the fact, with the engine's sentence.** A refusing
 *   control is `LimitStepper`; its `refuseIncrease` comes from
 *   `probe(fn, key)`, which validates the candidate change and returns the
 *   errors it would *introduce* — the second attribute reaching its natural
 *   maximum, a skill past 6 (7 with Aptitude), a contact past 7 — each with
 *   its message and page. Pass a stable `key` per control ("agi+1") so a
 *   screen of steppers validates each candidate once per draft, not per
 *   render. Whether an introduced *overspend* refuses or is allowed (and
 *   shown red on the rail) is the step's design call; a cap never is.
 * - **Losses at Next are the registry's.** A warning the player must
 *   acknowledge before leaving (unspent special points, nuyen above the
 *   carry-over) is `nextConfirmFor` in `./confirm.ts`, keyed by the
 *   validator's warning code; the frame asks, the step does not.
 * - **`readOnly` means render, do not offer edits** (a submitted build, a
 *   GM's review, an observer). `update` is already a no-op then; a step that
 *   hides its controls is kinder than one whose buttons silently do nothing.
 * - **`reviewMode`** is the GM looking at a submitted build: show the
 *   choices, let `actions.setApprovals` decide approval issues, and leave
 *   approving and returning to the Finish/Review screen.
 * - **Do not navigate.** Next/Back are the frame's; a step that needs to send
 *   the player elsewhere ("fix this in step 3") calls `goTo(step)`.
 * - Numbers chosen earlier are shown where they matter later — read them
 *   from `build`, `budgets` and `steps`, all of which are current.
 *
 * ## Build the body from the kit (`../kit/index.ts`)
 *
 * Every step says the same few things, and the kit is where they are said
 * once — reach for it before writing a control:
 *
 * - **A pool or a price:** `PoolLine` ("12 of 28 skill points left", an
 *   overspend in words) and `CostQuote` ("costs 10 Karma — you have 26")
 *   over `budgets`; `WhyLink` for a rule's page.
 * - **One of a few:** `ChoiceCards` (concept, metatype, magic type) — a
 *   radio group whose refused cards carry the engine's sentence.
 * - **From the books:** `CataloguePicker` (the campaign's creation books,
 *   browsed, rows over the caps greyed with why) → `hitToQuality` /
 *   `hitToPurchase` / `hitToPick` / `hitToPower` → `update(...)`. A row that
 *   needs a rating (`hitRatingRange`) asks through `RatingPicker` first.
 *   Never price a row by hand: `hitPrice`, `hitAvailability` and
 *   `hitCapRefusals` read it through the rules engine.
 * - **Invented rows for tests:** `catalogueHit()` in `../testing.ts`.
 */
import type {
  ApprovalDecision,
  Budgets,
  BuildCheckDto,
  BuildMode,
  BuildStep,
  CharacterBuild,
  ChargenSettings,
  Issue,
  Role,
} from '@safehouse/contracts';
import type { BuildRatings, EligibilityContext, StepStatus } from '@safehouse/rules';
import type { BuildPreview, BuildProber } from '../analysis.js';
import type { BuildUpdater, FlushResult } from '../session.js';
import type { StepMeta } from './meta.js';

/** What the Finish step and the GM's review do beyond editing the record. */
export interface BuildActions {
  /** Save whatever is unsaved now; says whether everything reached the server. */
  flush(): Promise<FlushResult>;
  /** Save, re-check on the server, and submit for approval (owner). Rejects with the server's refusal. */
  submit(): Promise<void>;
  /** GM: send the build back with a note pinned to a step (or to none). */
  returnWithNotes(notes: string, step: BuildStep | null): Promise<void>;
  /** GM: record decisions on `approval` issues, merged over the row's; `null` takes a decision back. */
  setApprovals(approvals: Record<string, ApprovalDecision | null>): Promise<void>;
  /** GM: approve and create the character; resolves with its id when the server names it. The approve route takes decisions, never a take-back. */
  approve(approvals?: Record<string, ApprovalDecision>): Promise<string | null>;
  /** Delete the build (owner while a draft, GM before approval). */
  remove(): Promise<void>;
  /** Which action is running, if any. */
  busy: 'submit' | 'return' | 'approvals' | 'approve' | 'delete' | null;
  /** The last action's refusal, in words; issues it carried are in `refusalIssues`. */
  error: string | null;
  refusalIssues: readonly Issue[];
  /** The server's own check (§8.6): fetched on the Finish step and before submit. */
  check: {
    data: BuildCheckDto | null;
    loading: boolean;
    error: string | null;
    refresh(): void;
  };
}

export interface StepProps {
  campaignId: string;
  buildId: string;
  /** The character this build became, once approved (the row's `characterId`); null before. */
  characterId: string | null;
  /**
   * Whether this device is the build's owner — the player making it, or the
   * GM on a runner of their own. Submit is the owner's alone on the server, so
   * a GM editing a player's build is not offered it.
   */
  isOwner: boolean;
  /** This screen's number, name, title, intro and page. */
  meta: StepMeta;
  /** The record as it stands this render (never mutate). */
  build: CharacterBuild;
  /** The campaign's creation settings the engine ran with. */
  settings: ChargenSettings;
  /** False when the campaign's settings could not be read and the build's own level stands in. */
  settingsFromCampaign: boolean;
  budgets: Budgets;
  /** Every issue filed under this step, all severities, in the validator's order. */
  issues: readonly Issue[];
  /** Every issue in the build (Finish renders the whole checklist). */
  allIssues: readonly Issue[];
  /** This step's status: complete, skipped, what blocks it, what is worth a look. */
  status: StepStatus;
  /** All nine statuses, in order. */
  steps: readonly StepStatus[];
  /** The skill and group fences, gathered once for this build (`skillEligibilityIn`). */
  eligibility: EligibilityContext;
  /** The compiled sheet and its derived character, or the error that stopped them. */
  preview: BuildPreview;
  /** Every attribute, skill, group, knowledge and language rating, with base, maxima and grants. */
  ratings: BuildRatings;
  /**
   * What a candidate change would break: `blocking` is every error the
   * changed record has, `introduced` the ones the change brings in. `key`
   * caches the answer for this draft.
   */
  probe: BuildProber;
  /** Apply a pure updater to the build; recomputes and autosaves. A no-op when `readOnly`. */
  update(fn: BuildUpdater): void;
  /**
   * Move the walkthrough to another step (saves first). In guided mode a
   * jump past an unfinished step lands on that step instead (`reachableStep`),
   * so a shortcut never walks round Next's gate.
   */
  goTo(step: BuildStep): void;
  readOnly: boolean;
  /** The GM reviewing a submitted build. */
  reviewMode: boolean;
  mode: BuildMode;
  role: Role | null;
  actions: BuildActions;
}

/** Actions that do nothing — for static renders, tests and read-only previews. */
export function inertActions(): BuildActions {
  const done = async () => undefined;
  return {
    flush: async () => ({ saved: true, status: 'idle', error: null }),
    submit: done,
    returnWithNotes: done,
    setApprovals: done,
    approve: async () => null,
    remove: done,
    busy: null,
    error: null,
    refusalIssues: [],
    check: { data: null, loading: false, error: null, refresh: () => undefined },
  };
}
