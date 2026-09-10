/**
 * Encounter builder (FR10.4) + balance levers (FR10.6): compose generated NPCs
 * and grunt groups into a named encounter linked to a scene, with the THREAT
 * READOUT recomputing live as the tier dial, squad size, PR, or roster change.
 * Levers that only change bodies re-math locally; a tier or seed change asks
 * the server for a fresh roll (generation stays server-authoritative).
 */
import { useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { Link } from 'react-router-dom';
import type { NpcTemplate } from '@safehouse/contracts';
import { useScenes } from '../../grid/api.js';
import { randomSeed } from '../common.js';
import { ErrorNote, Field, inputClass, SectionTitle, Spinner } from '../ui.js';
import {
  useCreateEncounter,
  useGenerateGroup,
  useGenerateNpc,
  usePartySheets,
  useStageEncounter,
} from './api.js';
import { oppositionProfiles, partyProfiles, patchEntry, removeEntry, toParts, totalBodies, type RosterEntry } from './roster.js';
import ThreatReadout from './ThreatReadout.js';

export interface EncounterBuilderProps {
  campaignId: string;
  templates: readonly NpcTemplate[];
  entries: RosterEntry[];
  setEntries: Dispatch<SetStateAction<RosterEntry[]>>;
}

export default function EncounterBuilder({
  campaignId,
  templates,
  entries,
  setEntries,
}: EncounterBuilderProps) {
  const party = usePartySheets(campaignId);
  const scenes = useScenes(campaignId);
  const create = useCreateEncounter(campaignId);
  const stage = useStageEncounter();
  const genNpc = useGenerateNpc();
  const genGroup = useGenerateGroup();

  const [name, setName] = useState('New encounter');
  const [sceneId, setSceneId] = useState<string>('');
  const [savedId, setSavedId] = useState<string | null>(null);

  const partyProfilesMemo = useMemo(() => partyProfiles(party.data ?? []), [party.data]);
  const oppProfiles = useMemo(() => oppositionProfiles(entries), [entries]);
  const pending = entries.filter((e) => e.pending || !e.sheet).length;

  /** Re-roll one row after a tier/seed/size lever moved (FR10.6). */
  const reroll = (entry: RosterEntry, patch: Partial<RosterEntry>) => {
    const next: RosterEntry = { ...entry, ...patch, pending: true };
    setEntries((cur) => patchEntry(cur, entry.id, { ...patch, pending: true }));
    const done = (upd: Partial<RosterEntry>) =>
      setEntries((cur) => patchEntry(cur, entry.id, { ...upd, pending: false }));

    if (next.kind === 'gruntGroup') {
      genGroup.mutate(
        { templateId: next.templateId, tierId: next.tierId, size: next.count, seed: next.seed },
        {
          onSuccess: (res) =>
            done({
              sheet: res.group.statblock,
              professionalRating: res.group.professionalRating,
              name: `${next.templateName} ×${next.count}`,
            }),
          onError: () => done({}),
        },
      );
      return;
    }
    genNpc.mutate(
      { templateId: next.templateId, tierId: next.tierId, seed: next.seed },
      {
        onSuccess: (res) =>
          done({
            sheet: res.npc.sheet,
            professionalRating: res.npc.professionalRating,
            name: res.npc.name,
            corrections: res.npc.corrections,
          }),
        onError: () => done({}),
      },
    );
  };

  const save = () => {
    create.mutate(
      {
        campaignId,
        name,
        sceneId: sceneId || null,
        parts: toParts(entries),
      },
      { onSuccess: (res) => setSavedId(res.encounter.id) },
    );
  };

  return (
    <div className="space-y-4">
      <div className="panel p-4">
        <SectionTitle hint="parts, not snapshots: the server re-rolls from template+tier+seed">
          Encounter
        </SectionTitle>

        <div className="mt-3 flex flex-wrap items-end gap-3">
          <Field label="Name">
            <input
              className={`${inputClass} w-56`}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Field label="Linked scene">
            <select
              className={`${inputClass} w-56`}
              value={sceneId}
              onChange={(e) => setSceneId(e.target.value)}
            >
              <option value="">— none —</option>
              {(scenes.data ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
          <button
            className="btn btn-accent px-3 py-1.5"
            disabled={entries.length === 0 || create.isPending}
            onClick={save}
          >
            {create.isPending ? 'saving…' : 'save encounter'}
          </button>
          {savedId && (
            <button
              className="btn px-3 py-1.5"
              disabled={stage.isPending || !sceneId}
              onClick={() => {
                if (sceneId) stage.mutate({ sceneId, encounterId: savedId });
              }}
              title="Re-place its combatants as tokens on the linked scene"
            >
              {stage.isPending ? 'staging…' : 'stage on map'}
            </button>
          )}
          {savedId && <span className="mono-label text-ok">saved</span>}
          {savedId && (
            <Link className="btn btn-accent px-3 py-1.5" to={`/c/${campaignId}/table`}>
              open the tracker
            </Link>
          )}
        </div>
        <ErrorNote error={create.error ?? stage.error} />

        <div className="mt-4">
          <div className="flex items-center gap-2">
            <SectionTitle hint={`${totalBodies(entries)} bodies`}>Opposition roster</SectionTitle>
            {(genNpc.isPending || genGroup.isPending) && <Spinner label="re-rolling" />}
          </div>

          {entries.length === 0 && (
            <p className="mt-2 text-sm text-dim">
              Nothing here yet — generate an NPC or a grunt group and add it.
            </p>
          )}

          <ul className="mt-2 space-y-2">
            {entries.map((entry) => {
              const template = templates.find((t) => t.id === entry.templateId);
              const tiers = template?.gen?.tiers ?? [];
              return (
                <li key={entry.id} className="rounded-md border border-edge bg-deck p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="chip text-dim">
                      {entry.kind === 'gruntGroup' ? 'squad' : 'npc'}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                      {entry.name}
                      <span className="mono-label ml-2 text-faint">{entry.templateName}</span>
                    </span>
                    {entry.pending && <Spinner />}
                    <button
                      className="btn px-2 py-1 text-danger"
                      onClick={() => setEntries((cur) => removeEntry(cur, entry.id))}
                    >
                      remove
                    </button>
                  </div>

                  <div className="mt-2 flex flex-wrap items-end gap-3">
                    <Field label="Tier">
                      <select
                        className={`${inputClass} w-40`}
                        value={entry.tierId}
                        onChange={(e) => reroll(entry, { tierId: e.target.value })}
                      >
                        {tiers.length === 0 && <option value={entry.tierId}>{entry.tierId}</option>}
                        {tiers.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.label}
                          </option>
                        ))}
                      </select>
                    </Field>

                    <Field label={entry.kind === 'gruntGroup' ? 'Squad size' : 'Bodies'}>
                      <input
                        type="number"
                        min={1}
                        max={24}
                        className={`${inputClass} w-20`}
                        value={entry.count}
                        onChange={(e) => {
                          const count = Math.max(1, Math.min(24, Number(e.target.value) || 1));
                          // Grunt groups re-roll their member list; independent
                          // NPCs just multiply bodies in the estimate.
                          if (entry.kind === 'gruntGroup') reroll(entry, { count });
                          else setEntries((cur) => patchEntry(cur, entry.id, { count }));
                        }}
                      />
                    </Field>

                    <Field label="Professional Rating">
                      <input
                        type="number"
                        min={0}
                        max={6}
                        className={`${inputClass} w-20`}
                        value={entry.professionalRating ?? 0}
                        onChange={(e) =>
                          setEntries((cur) =>
                            patchEntry(cur, entry.id, {
                              professionalRating: Math.max(0, Math.min(6, Number(e.target.value) || 0)),
                            }),
                          )
                        }
                      />
                    </Field>

                    <Field label="Seed">
                      <span className="flex items-center gap-2">
                        <input
                          type="number"
                          className={`${inputClass} w-32`}
                          value={entry.seed}
                          onChange={(e) => reroll(entry, { seed: Math.max(0, Number(e.target.value) || 0) })}
                        />
                        <button
                          className="btn shrink-0 px-2.5 py-1.5"
                          onClick={() => reroll(entry, { seed: randomSeed() })}
                        >
                          reroll
                        </button>
                      </span>
                    </Field>
                  </div>

                  {entry.corrections && entry.corrections.length > 0 && (
                    <p className="mono-label mt-2 text-warn">
                      validity pass: {entry.corrections.join(' · ')}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
          <ErrorNote error={genNpc.error ?? genGroup.error} />
        </div>
      </div>

      {party.isLoading && (
        <div className="panel p-4">
          <Spinner label="loading the party's live sheets" />
        </div>
      )}
      <ErrorNote error={party.error} />

      <ThreatReadout
        party={partyProfilesMemo}
        opposition={oppProfiles}
        pendingCount={pending}
      />

      <p className="text-xs text-faint">
        Independent NPC rows estimate one rolled statblock × bodies; the saved encounter rolls each
        NPC separately, so the real squad varies around this. Gear tweaks live in the archetype
        editor — change a loadout slot there and re-roll here.
      </p>
    </div>
  );
}
