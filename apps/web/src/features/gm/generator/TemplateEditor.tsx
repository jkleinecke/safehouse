/**
 * Archetype template editor (FR10.1): role tags, an editable tier dial with
 * per-tier attribute/skill sampling ranges, Professional Rating range,
 * metatype weights, and loadout slots pointing at the GM's own gear records.
 * Templates are DATA — never book stat blocks (§14).
 */
import { useMemo, useState } from 'react';
import type { GenTier, NpcTemplate } from '@safehouse/contracts';
import { ErrorNote, Field, inputClass, SectionTitle, Spinner } from '../ui.js';
import {
  useDeleteTemplate,
  useNpcTemplates,
  useSaveTemplate,
  type NpcTemplateDraft,
} from './api.js';
import { blankDraft, defaultTier, draftFor, duplicateDraft } from './drafts.js';
import GeneratorEmptyState from './EmptyState.js';
import { LoadoutEditor, RangeMapEditor, TagInput, WeightMapEditor } from './editors.js';

const DEFAULT_ROLE_TAGS = ['muscle', 'face', 'mage', 'adept', 'decker', 'rigger', 'sniper'];

function TierForm({ tier, onChange }: { tier: GenTier; onChange: (tier: GenTier) => void }) {
  return (
    <div className="space-y-3 rounded-md border border-edge bg-deck p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Field label="Tier id">
          <input
            className={`${inputClass} w-32`}
            value={tier.id}
            onChange={(e) => onChange({ ...tier, id: e.target.value.trim() })}
          />
        </Field>
        <Field label="Label (editable)">
          <input
            className={`${inputClass} w-40`}
            value={tier.label}
            onChange={(e) => onChange({ ...tier, label: e.target.value })}
          />
        </Field>
        <Field label="Professional Rating">
          <span className="flex items-center gap-2">
            <input
              type="number"
              className={`${inputClass} w-16`}
              aria-label="PR min"
              value={tier.professionalRating.min}
              onChange={(e) =>
                onChange({
                  ...tier,
                  professionalRating: {
                    ...tier.professionalRating,
                    min: Number(e.target.value) || 0,
                  },
                })
              }
            />
            <span className="text-faint">–</span>
            <input
              type="number"
              className={`${inputClass} w-16`}
              aria-label="PR max"
              value={tier.professionalRating.max}
              onChange={(e) =>
                onChange({
                  ...tier,
                  professionalRating: {
                    ...tier.professionalRating,
                    max: Number(e.target.value) || 0,
                  },
                })
              }
            />
          </span>
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div>
          <SectionTitle hint="sampled per NPC">Attribute ranges</SectionTitle>
          <div className="mt-2">
            <RangeMapEditor
              entries={tier.attributes}
              onChange={(attributes) => onChange({ ...tier, attributes })}
              keyLabel="attribute"
              addPlaceholder="bod"
            />
          </div>
        </div>
        <div>
          <SectionTitle hint="skill id → rating range">Skill ranges</SectionTitle>
          <div className="mt-2">
            <RangeMapEditor
              entries={tier.skills}
              onChange={(skills) => onChange({ ...tier, skills })}
              keyLabel="skill"
              addPlaceholder="automatics"
            />
          </div>
        </div>
        <div>
          <SectionTitle>Metatype weights</SectionTitle>
          <div className="mt-2">
            <WeightMapEditor
              entries={tier.metatypeWeights ?? {}}
              onChange={(metatypeWeights) => onChange({ ...tier, metatypeWeights })}
            />
          </div>
        </div>
        <div>
          <SectionTitle hint="your own gear records, by name">Loadout slots</SectionTitle>
          <div className="mt-2">
            <LoadoutEditor
              slots={tier.loadout}
              onChange={(loadout) => onChange({ ...tier, loadout })}
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Spell picks (names of your records)">
          <TagInput
            tags={tier.spells}
            onChange={(spells) => onChange({ ...tier, spells })}
            placeholder="add spell…"
          />
        </Field>
        <Field label="'Ware picks">
          <TagInput
            tags={tier.augments}
            onChange={(augments) => onChange({ ...tier, augments })}
            placeholder="add augment…"
          />
        </Field>
      </div>
    </div>
  );
}

export interface TemplateEditorProps {
  campaignId: string;
  /** Notifies the generate panel when the template list changes underneath it. */
  onSaved?: (template: NpcTemplate) => void;
  /**
   * Open on this draft instead of on the "pick something" pane — how
   * "duplicate & edit" arrives from the generate panel and the library. The
   * parent re-keys the editor when it pushes a new one, so the draft is
   * genuinely initial state and typing is never clobbered mid-edit.
   */
  initialDraft?: NpcTemplateDraft | undefined;
  /** Cold start: no archetypes here yet, offer the shipped library. */
  onBrowseLibrary?: (() => void) | undefined;
}

export default function TemplateEditor({
  campaignId,
  onSaved,
  initialDraft,
  onBrowseLibrary,
}: TemplateEditorProps) {
  const templates = useNpcTemplates(campaignId);
  const save = useSaveTemplate(campaignId);
  const del = useDeleteTemplate(campaignId);
  const [draft, setDraft] = useState<NpcTemplateDraft | null>(initialDraft ?? null);
  const [tierIdx, setTierIdx] = useState(0);
  const list = templates.data ?? [];

  const tiers = useMemo(() => draft?.gen?.tiers ?? [], [draft]);
  const tier = tiers[Math.min(tierIdx, Math.max(0, tiers.length - 1))];

  const setGen = (patch: Partial<NonNullable<NpcTemplateDraft['gen']>>) => {
    setDraft((d) =>
      d ? { ...d, gen: { roleTags: [], tiers: [], ...(d.gen ?? {}), ...patch } } : d,
    );
  };

  const setTier = (next: GenTier) => {
    setGen({ tiers: tiers.map((t, i) => (i === tierIdx ? next : t)) });
  };

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[18rem_minmax(0,1fr)]">
      <div className="panel p-4">
        <SectionTitle>Archetypes</SectionTitle>
        {templates.isLoading && <div className="mt-3"><Spinner label="loading" /></div>}
        <ErrorNote error={templates.error} />
        <ul className="mt-3 space-y-1">
          {list.map((t) => (
            <li key={t.id} className="flex items-center gap-2">
              <button
                className={`min-w-0 flex-1 truncate rounded-md px-2 py-1 text-left text-sm ${
                  draft?.id === t.id ? 'bg-raised text-cyan' : 'text-dim hover:text-ink'
                }`}
                onClick={() => {
                  setDraft(draftFor(t));
                  setTierIdx(0);
                }}
              >
                {t.name}
                {t.gen?.roleTags?.length ? (
                  <span className="mono-label ml-2 text-faint">{t.gen.roleTags.join(' · ')}</span>
                ) : null}
              </button>
              <button
                className="btn px-2 py-1"
                title={`Duplicate ${t.name} and edit the copy — the original is untouched`}
                aria-label={`Duplicate ${t.name}`}
                onClick={() => {
                  setDraft(duplicateDraft(t, list));
                  setTierIdx(0);
                }}
              >
                ⧉
              </button>
              <button
                className="btn px-2 py-1 text-danger"
                title="Delete template"
                aria-label={`Delete ${t.name}`}
                onClick={() => {
                  del.mutate(t.id);
                  if (draft?.id === t.id) setDraft(null);
                }}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
        {templates.data && list.length === 0 && (
          <p className="mt-3 text-sm text-dim">
            No archetypes yet — install the starter library, or start one below.
          </p>
        )}
        <button
          className="btn btn-accent mt-3 w-full"
          onClick={() => {
            setDraft(blankDraft());
            setTierIdx(0);
          }}
        >
          + new archetype
        </button>
        <ErrorNote error={del.error} />
      </div>

      {draft ? (
        <div className="panel space-y-4 p-4">
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Name">
              <input
                className={`${inputClass} w-56`}
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </Field>
            <div className="min-w-0 flex-1">
              <span className="mono-label block">Role tags</span>
              <div className="mt-1">
                <TagInput
                  tags={draft.gen?.roleTags ?? []}
                  onChange={(roleTags) => setGen({ roleTags })}
                  placeholder="muscle…"
                />
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {DEFAULT_ROLE_TAGS.filter((t) => !(draft.gen?.roleTags ?? []).includes(t)).map((t) => (
                  <button
                    key={t}
                    className="chip cursor-pointer text-faint hover:text-cyan"
                    onClick={() => setGen({ roleTags: [...(draft.gen?.roleTags ?? []), t] })}
                  >
                    + {t}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div>
            <SectionTitle hint="labels are yours — street / seasoned / pro / elite / prime">
              Tier dial
            </SectionTitle>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {tiers.map((t, i) => (
                <button
                  key={`${t.id}-${i}`}
                  className={`chip cursor-pointer ${
                    i === tierIdx ? 'border-cyan text-cyan' : 'text-dim hover:text-ink'
                  }`}
                  onClick={() => setTierIdx(i)}
                >
                  {t.label}
                </button>
              ))}
              <button
                className="btn px-2.5 py-1"
                onClick={() => {
                  const n = tiers.length + 1;
                  setGen({ tiers: [...tiers, defaultTier(`tier-${n}`, `Tier ${n}`)] });
                  setTierIdx(tiers.length);
                }}
              >
                + tier
              </button>
              {tiers.length > 1 && (
                <button
                  className="btn px-2.5 py-1 text-danger"
                  onClick={() => {
                    setGen({ tiers: tiers.filter((_, i) => i !== tierIdx) });
                    setTierIdx(0);
                  }}
                >
                  remove tier
                </button>
              )}
            </div>
          </div>

          {tier && <TierForm tier={tier} onChange={setTier} />}

          <div className="flex items-center gap-3">
            <button
              className="btn btn-accent px-3 py-1.5"
              disabled={save.isPending}
              onClick={() =>
                save.mutate(draft, {
                  onSuccess: (saved) => {
                    setDraft({ ...saved, gen: saved.gen ?? draft.gen });
                    onSaved?.(saved);
                  },
                })
              }
            >
              {save.isPending ? 'saving…' : draft.id ? 'save archetype' : 'create archetype'}
            </button>
            <button className="btn px-3 py-1.5" onClick={() => setDraft(null)}>
              close
            </button>
            {save.isSuccess && <span className="mono-label text-ok">saved</span>}
          </div>
          <ErrorNote error={save.error} />
        </div>
      ) : list.length === 0 && !templates.isLoading ? (
        <div className="panel p-6">
          <GeneratorEmptyState
            campaignId={campaignId}
            onBrowseLibrary={onBrowseLibrary}
            onCreateOwn={() => {
              setDraft(blankDraft());
              setTierIdx(0);
            }}
          />
        </div>
      ) : (
        <div className="panel p-6 text-sm text-dim">
          Pick an archetype to edit, duplicate one to fork it, or start a new one. Tiers hold the
          sampling ranges the generator rolls inside — your numbers, your gear records, no book
          content.
        </div>
      )}
    </div>
  );
}
