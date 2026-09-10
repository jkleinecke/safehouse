/**
 * Generated-NPC result card (FR10.2/10.3): the rolled statblock with every
 * derived number from the rules engine (playable immediately), the flavor and
 * persona stub the Fixer can later expand (FR12.5), and one-click
 * promote-to-template / add-to-encounter.
 */
import { useMemo } from 'react';
import { ATTRIBUTE_CODES, type NpcTemplate } from '@safehouse/contracts';
import { deriveCharacter, type GeneratedNpc } from '@safehouse/rules';
import { ErrorNote, SectionTitle } from '../ui.js';
import { usePromoteToTemplate } from './api.js';

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md border border-edge bg-deck px-2 py-1.5 text-center">
      <div className="mono-label text-faint">{label}</div>
      <div className="text-sm font-semibold text-ink">{value}</div>
    </div>
  );
}

function List({ label, items }: { label: string; items: readonly string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <div className="mono-label text-faint">{label}</div>
      <ul className="mt-1 space-y-0.5 text-sm text-dim">
        {items.map((item, i) => (
          <li key={i}>— {item}</li>
        ))}
      </ul>
    </div>
  );
}

export interface ResultCardProps {
  npc: GeneratedNpc;
  campaignId: string;
  templateId: string;
  templateName: string;
  /** Carried into the promoted copy so it can re-roll (FR10.3 round-trip). */
  gen?: NpcTemplate['gen'];
  onAddToEncounter?: () => void;
  /** Label for the add button (grunt groups say "add squad"). */
  addLabel?: string;
}

export default function ResultCard({
  npc,
  campaignId,
  templateId,
  templateName,
  gen,
  onAddToEncounter,
  addLabel,
}: ResultCardProps) {
  const promote = usePromoteToTemplate(campaignId);

  const derived = useMemo(() => {
    try {
      return deriveCharacter(npc.sheet);
    } catch {
      return null;
    }
  }, [npc.sheet]);

  const sheet = npc.sheet;
  const persona = npc.persona;

  return (
    <div className="panel p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-base font-semibold text-ink">{npc.name}</span>
        <span className="chip text-dim">{npc.metatype}</span>
        <span className="chip border-warn/40 text-warn">PR {npc.professionalRating}</span>
        <span className="chip text-faint" title="Reproduce this exact NPC with this seed">
          seed {npc.seed}
        </span>
        <span className="chip text-faint">{npc.tierId}</span>
        <span className="ml-auto flex gap-2">
          {onAddToEncounter && (
            <button className="btn px-3 py-1.5" onClick={onAddToEncounter}>
              {addLabel ?? 'add to encounter'}
            </button>
          )}
          <button
            className="btn btn-accent px-3 py-1.5"
            disabled={promote.isPending}
            onClick={() =>
              promote.mutate({
                kind: 'npc',
                templateId,
                tierId: npc.tierId,
                seed: npc.seed,
                name: `${npc.name} (${templateName})`,
                // The GM may have hand-tuned this sheet; sending it makes the
                // edit win over the re-rolled statblock (FR10.3).
                statblock: sheet,
                persona,
              })
            }
            title="Promote to a reusable archetype template"
          >
            {promote.isPending ? 'promoting…' : promote.isSuccess ? 'promoted ✓' : 'promote to template'}
          </button>
        </span>
      </div>
      <ErrorNote error={promote.error} />

      <div className="mt-3 grid grid-cols-4 gap-2 sm:grid-cols-8">
        {ATTRIBUTE_CODES.map((code) => (
          <Stat key={code} label={code} value={sheet.attributes[code]} />
        ))}
      </div>

      {derived && (
        <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-6">
          <Stat
            label="init"
            value={`${derived.initiative.physical.base.value} + ${derived.initiative.physical.dice.value}d6`}
          />
          <Stat label="phys" value={derived.monitors.physical.value} />
          <Stat label="stun" value={derived.monitors.stun.value} />
          <Stat label="defense" value={derived.pools['defense']?.total ?? 0} />
          <Stat label="soak" value={derived.pools['soak']?.total ?? 0} />
          <Stat
            label="limits p/m/s"
            value={`${derived.limits.physical.value}/${derived.limits.mental.value}/${derived.limits.social.value}`}
          />
        </div>
      )}

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="space-y-3">
          <div>
            <SectionTitle>Skills</SectionTitle>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {sheet.skills.map((s) => (
                <span key={s.id} className="chip text-dim">
                  {s.id} {s.rating}
                </span>
              ))}
              {sheet.skills.length === 0 && <span className="text-sm text-faint">none</span>}
            </div>
          </div>

          <div>
            <SectionTitle>Weapons & armor</SectionTitle>
            <ul className="mt-1.5 space-y-1 text-sm">
              {sheet.weapons.map((w) => (
                <li key={w.name} className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate">{w.name}</span>
                  <span className="mono-label text-faint">
                    {w.dv ?? '—'} / AP {w.ap} {w.acc !== undefined ? `/ ACC ${w.acc}` : ''}
                  </span>
                  <span className="chip text-cyan">
                    {derived?.pools[`weapon.${w.name}`]?.total ?? '?'}
                  </span>
                </li>
              ))}
              {sheet.armor.map((a) => (
                <li key={a.name} className="flex items-center gap-2 text-dim">
                  <span className="min-w-0 flex-1 truncate">{a.name}</span>
                  <span className="mono-label text-faint">armor {a.rating}</span>
                </li>
              ))}
              {sheet.weapons.length === 0 && sheet.armor.length === 0 && (
                <li className="text-sm text-faint">unarmed, unarmored</li>
              )}
            </ul>
          </div>

          {Object.keys(npc.loadout).length > 0 && (
            <div>
              <SectionTitle hint="picked from the tier's slots">Loadout</SectionTitle>
              <ul className="mt-1.5 space-y-0.5 text-sm text-dim">
                {Object.entries(npc.loadout).map(([slot, picks]) => (
                  <li key={slot}>
                    <span className="mono-label mr-2 text-faint">{slot}</span>
                    {picks.join(', ') || '—'}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="space-y-3">
          <div>
            <SectionTitle hint="original flavor tables">Face</SectionTitle>
            <dl className="mt-1.5 space-y-1 text-sm">
              <div className="flex gap-2">
                <dt className="mono-label w-24 shrink-0 text-faint">quirk</dt>
                <dd className="text-dim">{npc.flavor.quirk}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="mono-label w-24 shrink-0 text-faint">look</dt>
                <dd className="text-dim">{npc.flavor.appearance}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="mono-label w-24 shrink-0 text-faint">wants</dt>
                <dd className="text-dim">{npc.flavor.motivation}</dd>
              </div>
            </dl>
          </div>

          <div className="rounded-md border border-edge bg-deck p-3">
            <SectionTitle hint="the Fixer expands this">Persona stub</SectionTitle>
            <div className="mt-2 space-y-2">
              <List label="traits" items={persona.traits ?? []} />
              <List label="goals" items={persona.goals ?? []} />
              <List label="secrets" items={persona.secrets ?? []} />
              <List label="knows" items={persona.knowledge ?? []} />
              {persona.voice && (
                <div>
                  <div className="mono-label text-faint">voice</div>
                  <p className="text-sm text-dim">{persona.voice}</p>
                </div>
              )}
              {!persona.traits?.length &&
                !persona.goals?.length &&
                !persona.secrets?.length &&
                !persona.knowledge?.length &&
                !persona.voice && (
                  <p className="text-sm text-faint">
                    Stub only — the engine rolls numbers, the Fixer writes the person.
                  </p>
                )}
            </div>
          </div>

          {npc.corrections.length > 0 && (
            <div className="rounded-md border border-warn/40 bg-warn/10 p-3">
              <div className="mono-label text-warn">validity pass</div>
              <ul className="mt-1 space-y-0.5 text-xs text-warn">
                {npc.corrections.map((c, i) => (
                  <li key={i}>— {c}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
