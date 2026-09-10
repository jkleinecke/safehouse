/**
 * Generate panel (FR10.2): tier dial, squad size, seed with reroll and
 * per-aspect lock buttons ("keep the stats, reroll the names"), result card
 * with the statblock + persona stub, promote-to-template, add-to-encounter.
 * Generation is server-authoritative — this panel only asks.
 */
import { useMemo, useState } from 'react';
import type { NpcTemplate } from '@safehouse/contracts';
import type { GeneratedGruntGroup, GeneratedNpc } from '@safehouse/rules';
import { randomSeed } from '../common.js';
import { ErrorNote, Field, inputClass, SectionTitle, Spinner } from '../ui.js';
import { LOCK_ASPECTS, useGenerateGroup, useGenerateNpc, type LockAspect } from './api.js';
import GeneratorEmptyState from './EmptyState.js';
import ResultCard from './ResultCard.js';
import { entryFromGroup, entryFromNpc, type RosterEntry } from './roster.js';

export interface GeneratePanelProps {
  campaignId: string;
  templates: readonly NpcTemplate[];
  onAddEntry: (entry: RosterEntry) => void;
  /**
   * Archetype to open on, from a codex page's "follow the link" (FR5.6 →
   * `features/codex/templates.ts#generatorPathFor`). Landing on the generator
   * with the list loaded but nothing chosen made the link a navigation rather
   * than an answer.
   */
  initialTemplateId?: string | undefined;
  /** Cold start: the list is empty and the GM needs a way out, not a dead select. */
  onBrowseLibrary?: (() => void) | undefined;
  onCreateOwn?: (() => void) | undefined;
  /** Tune the archetype you are looking at (edit in place / fork it first). */
  onEditTemplate?: ((tpl: NpcTemplate) => void) | undefined;
  onDuplicateTemplate?: ((tpl: NpcTemplate) => void) | undefined;
  /** Still fetching — an empty list is not yet news. */
  isLoading?: boolean | undefined;
}

type Mode = 'npc' | 'gruntGroup';

/**
 * Which archetype the panel opens on: the one a codex link named, else the
 * first in the list.
 *
 * A link's id is not trusted to exist. Templates are GM data — one can be
 * renamed, re-created or deleted between the page that links to it and the tap
 * that follows the link — and a panel sitting on an id nothing matches has an
 * empty tier list and a dead Generate button. Falling back to the first row
 * loses the deep link, which is the smaller loss by far.
 */
export function pickInitialTemplate(
  templates: readonly { id: string }[],
  wanted: string | undefined,
): string {
  if (templates.length === 0) return '';
  return templates.find((t) => t.id === wanted)?.id ?? templates[0]!.id;
}

export default function GeneratePanel({
  campaignId,
  templates,
  onAddEntry,
  initialTemplateId,
  onBrowseLibrary,
  onCreateOwn,
  onEditTemplate,
  onDuplicateTemplate,
  isLoading,
}: GeneratePanelProps) {
  // The picker's *pending* choice. Empty (or stale, after a delete) means
  // "whatever the list says is first" — resolved during render below rather
  // than written back by an effect, so the very first paint already shows a
  // real archetype with real tiers instead of a blank select that fills in a
  // frame later.
  const [pickedId, setPickedId] = useState('');
  const [pickedTier, setPickedTier] = useState('');
  const [mode, setMode] = useState<Mode>('npc');
  const [size, setSize] = useState(4);
  const [seed, setSeed] = useState<number>(() => randomSeed());
  const [locks, setLocks] = useState<LockAspect[]>([]);
  const [prevSeed, setPrevSeed] = useState<number | undefined>(undefined);
  const [npc, setNpc] = useState<GeneratedNpc | null>(null);
  const [group, setGroup] = useState<GeneratedGruntGroup | null>(null);
  /**
   * Which archetype + tier the card on screen actually came from.
   *
   * The picker keeps moving after a roll — that is the point of the tier dial —
   * and the result card carries `templateId` into promote-to-template
   * (FR10.3). Reading it off the *current* selection meant switching archetype
   * with a card still up promoted the visible NPC under a different
   * archetype's id, so re-rolling that promoted copy produced someone else.
   */
  const [source, setSource] = useState<{ templateId: string; tierId: string } | null>(null);

  const genNpc = useGenerateNpc();
  const genGroup = useGenerateGroup();

  const templateId = useMemo(
    () =>
      templates.some((t) => t.id === pickedId)
        ? pickedId
        : pickInitialTemplate(templates, initialTemplateId),
    [templates, pickedId, initialTemplateId],
  );
  const template = useMemo(
    () => templates.find((t) => t.id === templateId),
    [templates, templateId],
  );
  const resultTemplate = useMemo(
    () => (source ? templates.find((t) => t.id === source.templateId) : undefined),
    [templates, source],
  );
  const tiers = template?.gen?.tiers ?? [];
  const tierId = tiers.some((t) => t.id === pickedTier) ? pickedTier : (tiers[0]?.id ?? '');

  const toggleLock = (aspect: LockAspect) =>
    setLocks((l) => (l.includes(aspect) ? l.filter((x) => x !== aspect) : [...l, aspect]));

  const canGenerate = Boolean(templateId && tierId) && !genNpc.isPending && !genGroup.isPending;
  const sameSource = source?.templateId === templateId && source?.tierId === tierId;

  const run = (nextSeed: number) => {
    if (!templateId || !tierId) return;
    setSeed(nextSeed);
    if (mode === 'gruntGroup') {
      genGroup.mutate(
        { templateId, tierId, size: Math.max(1, size), seed: nextSeed },
        {
          onSuccess: (res) => {
            setGroup(res.group);
            setNpc(null);
            setPrevSeed(res.seed);
            setSource({ templateId, tierId });
          },
        },
      );
      return;
    }
    // Locks replay a prior roll and re-roll only the unlocked aspects — but
    // only within the archetype and tier that roll came from. Replaying a seed
    // through different ranges is not "keep the stats", it is new stats.
    const useLocks = locks.length > 0 && prevSeed !== undefined && sameSource;
    genNpc.mutate(
      {
        templateId,
        tierId,
        seed: nextSeed,
        ...(useLocks ? { locks, prevSeed } : {}),
      },
      {
        onSuccess: (res) => {
          setNpc(res.npc);
          setGroup(null);
          setPrevSeed(res.npc.seed);
          setSource({ templateId, tierId });
        },
      },
    );
  };

  // Cold start (G9): an empty select over a dead Generate button is the moment
  // a GM decides the generator is broken. While the list is still in flight an
  // empty array is not yet news — say "loading", never "you have none".
  if (templates.length === 0 && isLoading) {
    return (
      <div className="panel p-6">
        <Spinner label="loading archetypes" />
      </div>
    );
  }
  if (templates.length === 0) {
    return (
      <GeneratorEmptyState
        campaignId={campaignId}
        onBrowseLibrary={onBrowseLibrary}
        onCreateOwn={onCreateOwn}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="panel p-4">
        <SectionTitle hint="seeded, so the same squad comes back identical">
          Generate
        </SectionTitle>

        <div className="mt-3 flex flex-wrap items-end gap-3">
          <Field label="Archetype">
            <select
              className={`${inputClass} w-56`}
              value={templateId}
              onChange={(e) => {
                setPickedId(e.target.value);
                setPickedTier('');
              }}
            >
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </Field>

          {template && (onEditTemplate || onDuplicateTemplate) && (
            <Field label="This archetype">
              <span className="flex gap-1.5">
                {onEditTemplate && (
                  <button
                    className="btn px-2.5 py-1.5"
                    onClick={() => onEditTemplate(template)}
                    title="Open this archetype's ranges in the editor"
                  >
                    edit
                  </button>
                )}
                {onDuplicateTemplate && (
                  <button
                    className="btn px-2.5 py-1.5"
                    onClick={() => onDuplicateTemplate(template)}
                    title="Fork it into a new archetype — tune the copy, keep this one"
                  >
                    duplicate &amp; edit
                  </button>
                )}
              </span>
            </Field>
          )}

          <Field label="Output">
            <span className="flex gap-1.5">
              <button
                className={`chip cursor-pointer ${mode === 'npc' ? 'border-cyan text-cyan' : 'text-dim'}`}
                onClick={() => setMode('npc')}
              >
                one NPC
              </button>
              <button
                className={`chip cursor-pointer ${
                  mode === 'gruntGroup' ? 'border-cyan text-cyan' : 'text-dim'
                }`}
                onClick={() => setMode('gruntGroup')}
              >
                grunt group
              </button>
            </span>
          </Field>

          {mode === 'gruntGroup' && (
            <Field label="Squad size">
              <input
                type="number"
                min={1}
                max={24}
                className={`${inputClass} w-20`}
                value={size}
                onChange={(e) => setSize(Math.max(1, Math.min(24, Number(e.target.value) || 1)))}
              />
            </Field>
          )}
        </div>

        <div className="mt-3">
          <span className="mono-label">Tier dial</span>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            {tiers.map((t) => (
              <button
                key={t.id}
                className={`chip cursor-pointer ${
                  t.id === tierId ? 'border-cyan text-cyan' : 'text-dim hover:text-ink'
                }`}
                onClick={() => setPickedTier(t.id)}
              >
                {t.label}
              </button>
            ))}
            {tiers.length === 0 && (
              <span className="flex items-center gap-2 text-sm text-faint">
                This archetype has no tiers, so there is nothing to roll inside.
                {template && onEditTemplate && (
                  <button className="btn px-2.5 py-1" onClick={() => onEditTemplate(template)}>
                    add a tier
                  </button>
                )}
              </span>
            )}
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-end gap-3">
          <Field label="Seed">
            <input
              type="number"
              className={`${inputClass} w-40`}
              value={seed}
              onChange={(e) => setSeed(Math.max(0, Number(e.target.value) || 0))}
            />
          </Field>
          <button className="btn px-3 py-1.5" onClick={() => setSeed(randomSeed())}>
            new seed
          </button>
          <button
            className="btn btn-accent px-3 py-1.5"
            disabled={!canGenerate}
            onClick={() => run(seed)}
          >
            generate
          </button>
          <button
            className="btn px-3 py-1.5"
            disabled={!canGenerate}
            onClick={() => run(randomSeed())}
            title="Roll again — locked aspects survive"
          >
            reroll
          </button>
          {(genNpc.isPending || genGroup.isPending) && <Spinner label="rolling" />}
        </div>

        {mode === 'npc' && (
          <div className="mt-3">
            <span className="mono-label">
              Locks{' '}
              {prevSeed === undefined ? (
                <span className="text-faint">(generate once first)</span>
              ) : !sameSource ? (
                <span className="text-faint">(generate once on this archetype and tier)</span>
              ) : null}
            </span>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {LOCK_ASPECTS.map((aspect) => (
                <button
                  key={aspect}
                  className={`chip cursor-pointer ${
                    locks.includes(aspect) ? 'border-warn text-warn' : 'text-dim hover:text-ink'
                  }`}
                  onClick={() => toggleLock(aspect)}
                  title={`Keep ${aspect} from the previous roll`}
                >
                  {locks.includes(aspect) ? '🔒' : '○'} {aspect}
                </button>
              ))}
            </div>
          </div>
        )}

        <ErrorNote error={genNpc.error ?? genGroup.error} />
      </div>

      {npc && resultTemplate && (
        <ResultCard
          npc={npc}
          campaignId={campaignId}
          templateId={resultTemplate.id}
          templateName={resultTemplate.name}
          gen={resultTemplate.gen}
          onAddToEncounter={() =>
            onAddEntry(
              entryFromNpc(npc, {
                templateId: resultTemplate.id,
                templateName: resultTemplate.name,
              }),
            )
          }
        />
      )}

      {group && resultTemplate && (
        <div className="space-y-3">
          <div className="panel flex flex-wrap items-center gap-2 p-4">
            <span className="text-base font-semibold">
              {resultTemplate.name} ×{group.members.length}
            </span>
            <span className="chip text-dim">{group.metatype}</span>
            <span className="chip border-warn/40 text-warn">PR {group.professionalRating}</span>
            <span className="chip text-faint">seed {group.seed}</span>
            <span className="mono-label text-faint">
              one shared statblock, {group.members.length} faces
            </span>
            <button
              className="btn ml-auto px-3 py-1.5"
              onClick={() =>
                onAddEntry(
                  entryFromGroup(group, {
                    templateId: resultTemplate.id,
                    templateName: resultTemplate.name,
                  }),
                )
              }
            >
              add squad to encounter
            </button>
          </div>
          <div className="panel p-4">
            <SectionTitle>Faces</SectionTitle>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {group.members.map((m, i) => (
                <span key={`${m.name}-${i}`} className="chip text-dim" title={m.flavor.quirk}>
                  {i + 1}. {m.name}
                </span>
              ))}
            </div>
          </div>
          {group.members[0] && (
            <ResultCard
              npc={{ ...group.members[0], sheet: group.statblock }}
              campaignId={campaignId}
              templateId={resultTemplate.id}
              templateName={resultTemplate.name}
              gen={resultTemplate.gen}
              addLabel="add squad to the fight"
              onAddToEncounter={() =>
                onAddEntry(
                  entryFromGroup(group, {
                    templateId: resultTemplate.id,
                    templateName: resultTemplate.name,
                  }),
                )
              }
            />
          )}
        </div>
      )}
    </div>
  );
}
