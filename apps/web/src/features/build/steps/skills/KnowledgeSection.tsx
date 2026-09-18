/**
 * Step 6's knowledge skills and languages, below the active skills (FR3.9,
 * docs/CHARGEN.md §4.4 Step 6).
 *
 * Knowledge has a pool of its own, and the screen quotes it with the numbers
 * that make it — "(INT 3 + LOG 4) × 2 = 14 free knowledge points" — because a
 * player who raised Logic in step 3 should see where the extra points came
 * from. The four categories each sit under their linked attribute; languages
 * sit last, where the native pick lives (one free, two with Bilingual — the
 * count is the engine's `qualityEffects`).
 *
 * The book lets active skill points buy knowledge and language ranks too, and
 * not the other way round. That trade is stated once, with its price asked of
 * `budgets` (a doubling quality moves it) and what is left in the skill pool,
 * and each row carries a second stepper for it — labelled apart from the free
 * one, so a player can always tell which pool a rank came out of. Ratings stop
 * at the creation maximum with the validator's sentence; a native language
 * the free count cannot cover refuses the same way.
 */
import { useId, useState, type ReactNode } from 'react';
import { type Issue, type KnowledgeCategory } from '@safehouse/contracts';
import { CREATION_SKILL_RULES, KNOWLEDGE_CATEGORY_TABLE, LANGUAGE_SKILL, qualityEffects } from '@safehouse/rules';
import { inputClass } from '../../../gm/ui.js';
import LimitStepper, { RefusalNote, type Refusal } from '../../components/LimitStepper.js';
import { PoolLine, WhyLink } from '../../kit/index.js';
import type { StepProps } from '../types.js';
import {
  CATEGORY_ORDER,
  CATEGORY_WORDS,
  KNOWLEDGE_RAISE_CODES,
  NATIVE_CODES,
  SPEC_FLOOR_CODES,
  addKnowledge,
  addLanguage,
  capRefusal,
  categoryAttribute,
  knowledgeLines,
  knowledgeQuote,
  knowledgeRatingWords,
  languageLines,
  mainCost,
  mayPassMax,
  nativeLine,
  patchKnowledge,
  patchLanguage,
  priceOf,
  removeKnowledge,
  removeLanguage,
  tradeLine,
  tradePrices,
  type KnowledgeLine,
  type LanguageLine,
} from './model.js';
import { Badge, IssueNotes, SpecSlot, TextButton, TextField } from './parts.js';

export interface KnowledgeSectionProps {
  props: StepProps;
  knowledgeIssues: ReadonlyMap<number, Issue[]>;
  languageIssues: ReadonlyMap<number, Issue[]>;
  languageListIssues: readonly Issue[];
}

type RankPatch = { points?: number; skillPoints?: number; spec?: string | null };

/** The app's field look, sized to its content: a category name, not a full-width bar. */
const SELECT_CLASS = inputClass.replace('w-full ', '');

/** The two rank steppers and the specialisation a knowledge skill or language shares. */
function Ranks({
  props,
  name,
  keyBase,
  points,
  skillPoints,
  spec,
  karma,
  total,
  patch,
  lead,
}: {
  props: StepProps;
  name: string;
  keyBase: string;
  points: number;
  skillPoints: number;
  spec: string;
  karma: number;
  total: number;
  patch: (b: StepProps['build'], p: RankPatch) => StepProps['build'];
  /** A control that leads the steppers' line (a knowledge skill's category). */
  lead?: ReactNode;
}) {
  const readOnly = props.readOnly;
  const refuse = (field: 'points' | 'skillPoints', delta: number, codes: ReadonlySet<string>, hint?: string): Refusal | null =>
    capRefusal(
      props.probe(
        (b) => patch(b, field === 'points' ? { points: points + delta } : { skillPoints: skillPoints + delta }),
        `${keyBase}:${field}${delta > 0 ? '+' : '-'}`,
      ),
      codes,
      props.allIssues,
      hint,
    );
  // A rank can only pass the creation maximum from one below it: ask the engine then, not on every row every render.
  const max = CREATION_SKILL_RULES.maxKnowledgeRating;
  const raise = (field: 'points' | 'skillPoints'): Refusal | null =>
    mayPassMax(total, max) ? refuse(field, 1, KNOWLEDGE_RAISE_CODES, `at ${max}`) : null;
  const hasSpec = spec.trim() !== '';
  const floorFor = (field: 'points' | 'skillPoints', value: number): Refusal | null =>
    hasSpec && value > 0 ? refuse(field, -1, SPEC_FLOOR_CODES) : null;
  const floorPoints = floorFor('points', points);
  const floorSkill = floorFor('skillPoints', skillPoints);

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-start gap-x-4 gap-y-1.5">
        {lead}
        <div className="flex flex-col gap-0.5">
          <span className="mono-label text-faint" aria-hidden>
            knowledge pts
          </span>
          <LimitStepper
            label={`Knowledge points on ${name}`}
            hideLabel
            value={points}
            onChange={(v) => props.update((b) => patch(b, { points: v }))}
            refuseIncrease={raise('points')}
            {...(floorPoints ? { refuseDecrease: floorPoints } : {})}
            readOnly={readOnly}
            testId="knowledge-points"
          />
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="mono-label text-faint" aria-hidden>
            skill pts
          </span>
          <LimitStepper
            label={`Skill points on ${name}`}
            hideLabel
            value={skillPoints}
            onChange={(v) => props.update((b) => patch(b, { skillPoints: v }))}
            refuseIncrease={raise('skillPoints')}
            {...(floorSkill ? { refuseDecrease: floorSkill } : {})}
            readOnly={readOnly}
            testId="knowledge-skill-points"
          />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <p className="text-xs text-dim" data-testid="knowledge-rating">
          {knowledgeRatingWords(points, skillPoints, karma, total)}
        </p>
        <SpecSlot
          name={name}
          spec={spec}
          rated={total > 0}
          readOnly={readOnly}
          onChange={(text) => props.update((b) => patch(b, { spec: text }))}
          price={() => mainCost(priceOf(props.build, props.settings, props.budgets, (b) => patch(b, { spec: 'x' })))}
          budgets={props.budgets}
          testId="knowledge-spec"
        />
      </div>
    </div>
  );
}

function KnowledgeRow({ props, line, position, issues }: { props: StepProps; line: KnowledgeLine; position: number; issues: readonly Issue[] }) {
  const { index, entry, rating, total } = line;
  const readOnly = props.readOnly;
  const words = CATEGORY_WORDS[entry.category];
  const name = entry.name.trim() || `${words.noun} ${position}`;
  return (
    <li className="space-y-1.5 p-2.5" data-testid="knowledge-row" data-index={index}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <TextField
          label={`Name of ${words.noun} skill ${position}`}
          hideLabel
          value={entry.name}
          onChange={(text) => props.update((b) => patchKnowledge(b, index, { name: text }))}
          readOnly={readOnly}
          hint="what the runner knows"
          className="min-w-[10rem] flex-1"
          emptyText="unnamed"
          testId="knowledge-name"
        />
        {!readOnly && (
          <TextButton onClick={() => props.update((b) => removeKnowledge(b, index))} label={`remove ${name}`} tone="danger" testId="knowledge-remove">
            remove
          </TextButton>
        )}
      </div>
      <Ranks
        props={props}
        name={name}
        keyBase={`know:${index}`}
        points={entry.points}
        skillPoints={entry.skillPoints}
        spec={entry.spec ?? ''}
        karma={rating?.karma ?? 0}
        total={total}
        patch={(b, p) => patchKnowledge(b, index, p)}
        lead={
          readOnly ? null : (
            <label className="flex flex-col gap-0.5">
              <span className="mono-label text-faint">category</span>
              <select
                className={SELECT_CLASS}
                value={entry.category}
                aria-label={`Category of ${name}`}
                onChange={(e) => props.update((b) => patchKnowledge(b, index, { category: e.target.value as KnowledgeCategory }))}
                data-testid="knowledge-category"
              >
                {CATEGORY_ORDER.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_WORDS[c].title}
                  </option>
                ))}
              </select>
            </label>
          )
        }
      />
      <IssueNotes issues={issues} />
    </li>
  );
}

function LanguageRow({ props, line, position, issues }: { props: StepProps; line: LanguageLine; position: number; issues: readonly Issue[] }) {
  const { index, entry, rating, total } = line;
  const readOnly = props.readOnly;
  const refusalId = useId();
  const [pressedReason, setPressedReason] = useState<string | null>(null);
  const name = entry.name.trim() || `language ${position}`;
  // Marking one more native can only pass the free count once every free one is taken; only then ask the engine.
  const full = languagesNative(props) >= qualityEffects(props.build).nativeLanguages;
  const refused =
    entry.native || !full
      ? null
      : nativeRefusal(capRefusal(props.probe((b) => patchLanguage(b, index, { native: true }), `lang:${index}:native`), NATIVE_CODES, props.allIssues));
  const showRanks = !entry.native || entry.points > 0 || entry.skillPoints > 0;
  return (
    <li className="space-y-1.5 p-2.5" data-testid="language-row" data-index={index} data-native={entry.native ? 'yes' : 'no'}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <TextField
          label={`Name of language ${position}`}
          hideLabel
          value={entry.name}
          onChange={(text) => props.update((b) => patchLanguage(b, index, { name: text }))}
          readOnly={readOnly}
          hint="which language?"
          className="min-w-[10rem] flex-1"
          emptyText="unnamed"
          testId="language-name"
        />
        {readOnly ? (
          entry.native && <Badge tone="text-cyan">native</Badge>
        ) : (
          <button
            type="button"
            className={`btn px-3 py-1.5 ${entry.native ? 'border-cyan-dim text-cyan' : ''} ${refused ? 'cursor-not-allowed opacity-60' : ''}`}
            aria-pressed={entry.native}
            aria-label={`native — ${name}`}
            {...(refused ? { 'aria-disabled': 'true', 'aria-describedby': refusalId } : {})}
            data-refused={refused ? 'yes' : 'no'}
            onClick={() => {
              if (refused) setPressedReason(refused.reason);
              else props.update((b) => patchLanguage(b, index, { native: !entry.native }));
            }}
            data-testid="language-native"
          >
            native
          </button>
        )}
        {!readOnly && (
          <TextButton onClick={() => props.update((b) => removeLanguage(b, index))} label={`remove ${name}`} tone="danger" testId="language-remove">
            remove
          </TextButton>
        )}
      </div>
      {refused && !readOnly && (
        <RefusalNote id={refusalId} refusal={refused} voice={pressedReason === refused.reason ? 'pressed' : 'quiet'} direction="increase" />
      )}
      {entry.native && !showRanks ? (
        <p className="text-xs text-dim" data-testid="language-native-note">
          Native: spoken fluently, no points needed.
        </p>
      ) : (
        <Ranks
          props={props}
          name={name}
          keyBase={`lang:${index}`}
          points={entry.points}
          skillPoints={entry.skillPoints}
          spec={entry.spec ?? ''}
          karma={rating?.karma ?? 0}
          total={total}
          patch={(b, p) => patchLanguage(b, index, p)}
        />
      )}
      <IssueNotes issues={issues} />
    </li>
  );
}

/** How many languages the build marks native. */
function languagesNative(props: StepProps): number {
  return props.build.skills.languages.filter((l) => l.native).length;
}

/**
 * The native toggle's refusal framed as what the tap would do — the
 * validator's sentence describes the build *after* the tap ("2 native
 * languages; one is free"), which under a toggle nobody pressed read as if
 * the build already had two.
 */
export function nativeRefusal(refusal: Refusal | null): Refusal | null {
  return refusal ? { ...refusal, reason: `Can't mark it native: ${refusal.reason}`, hint: 'no free native slot left' } : null;
}

export default function KnowledgeSection({ props, knowledgeIssues, languageIssues, languageListIssues }: KnowledgeSectionProps) {
  const headingId = useId();
  const pool = props.budgets.pools.knowledge;
  const quote = knowledgeQuote(props.ratings, pool);
  const readOnly = props.readOnly;
  const nativeFree = qualityEffects(props.build).nativeLanguages;
  const languages = languageLines(props.build, props.ratings);
  const nativeCount = languages.filter((l) => l.entry.native).length;
  const trade = readOnly ? null : tradeLine(tradePrices(props.build, props.settings, props.budgets), props.budgets.pools.skills);

  return (
    <section aria-labelledby={headingId} className="space-y-3" data-testid="skills-knowledge">
      <h2 id={headingId} className="text-base font-semibold text-ink">
        Knowledge &amp; languages
      </h2>
      <PoolLine budgets={props.budgets} pool="knowledge" />
      <p className="flex flex-wrap items-center gap-x-2 text-sm text-dim" data-testid="knowledge-quote">
        <span>{quote.text}.</span>
        <WhyLink refValue={KNOWLEDGE_CATEGORY_TABLE.academic.ref} />
      </p>
      {trade && (
        <p className="text-sm text-dim" data-testid="knowledge-trade">
          {trade}
        </p>
      )}

      {CATEGORY_ORDER.map((category) => {
        const lines = knowledgeLines(props.build, props.ratings, category);
        const words = CATEGORY_WORDS[category];
        return (
          <div key={category} className="space-y-1.5" data-testid="knowledge-category-section" data-category={category}>
            <h3 className="mono-label text-cyan">
              {words.title} <span className="text-faint">· {categoryAttribute(category)}</span>
            </h3>
            {lines.length > 0 ? (
              <ul className="divide-y divide-edge rounded-md border border-edge bg-deck" aria-label={`${words.title} knowledge skills`}>
                {lines.map((line, i) => (
                  <KnowledgeRow key={line.index} props={props} line={line} position={i + 1} issues={knowledgeIssues.get(line.index) ?? []} />
                ))}
              </ul>
            ) : (
              <p className="text-xs text-faint">No {words.noun} skills.</p>
            )}
            {!readOnly && (
              <TextButton onClick={() => props.update((b) => addKnowledge(b, category))} testId={`knowledge-add-${category}`}>
                + {words.noun}
              </TextButton>
            )}
          </div>
        );
      })}

      <div className="space-y-1.5" data-testid="language-section">
        <h3 className="mono-label text-cyan">
          Languages <span className="text-faint">· {LANGUAGE_SKILL.attr.toUpperCase()}</span>
        </h3>
        <p className="flex flex-wrap items-center gap-x-2 text-sm text-dim" data-testid="native-line">
          <span>{nativeLine(nativeFree, nativeCount)}</span>
          <WhyLink refValue={LANGUAGE_SKILL.ref} />
        </p>
        <IssueNotes issues={languageListIssues} testId="language-list-issues" />
        {languages.length > 0 ? (
          <ul className="divide-y divide-edge rounded-md border border-edge bg-deck" aria-label="Languages">
            {languages.map((line, i) => (
              <LanguageRow key={line.index} props={props} line={line} position={i + 1} issues={languageIssues.get(line.index) ?? []} />
            ))}
          </ul>
        ) : (
          <p className="text-xs text-faint">No languages.</p>
        )}
        {!readOnly && (
          <div className="flex flex-wrap gap-2">
            {nativeCount < nativeFree && (
              <TextButton onClick={() => props.update((b) => addLanguage(b, true))} testId="language-add-native">
                + native language
              </TextButton>
            )}
            <TextButton onClick={() => props.update((b) => addLanguage(b, false))} testId="language-add">
              + language
            </TextButton>
          </div>
        )}
      </div>
    </section>
  );
}
