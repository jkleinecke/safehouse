/**
 * Skills tab (FR3.2): attribute grid with provenance, the skill list with live
 * pool numbers, the knowledge skills and languages, and the personal macro
 * rack (FR2.8). Activating a skill row opens the roll dialog (G1: ≤2 taps).
 *
 * Knowledge and languages are here because every built character has them —
 * the creator's Step 5 makes (INT + LOG) × 2 points a mandatory pool and the
 * validator blocks submit until they are spent — and until now the sheet in
 * play rendered neither, so the one screen that never showed them was the one
 * the player uses at the table. The lines are the builder's own
 * (`knowledgeLines`), so its last screen and this tab agree.
 *
 * A skill that names a target (Exotic Ranged, Exotic Melee, Pilot Exotic
 * Vehicle) is one row per weapon or vehicle sharing one id, so the row's key,
 * its pool and its spoken name all carry the target — keyed by the id alone,
 * two such rows showed one pool and collided as React keys.
 *
 * Accessibility: the rows used to be click-handler `<div>`s with no accessible
 * name — a screen reader read a row of unlabelled buttons and a keyboard user
 * could not roll at all. Each row is now a real `<button>` carrying the pool in
 * its name, sitting BESIDE the provenance button rather than wrapping it
 * (nesting one button inside another is invalid and breaks tab order).
 */
import type { PoolBreakdown, SheetSkill } from '@safehouse/contracts';
import { skillPoolKey } from '@safehouse/rules';
import { skillRowLabel, skillRowName } from '../a11y.js';
import { knowledgeLines } from '../rows.js';
import { useMacroMutation, useMacros } from '../api.js';
import { skillRollConfig } from '../rollDialogState.js';
import { BreakdownButton } from '../components/Provenance.js';
import { Empty, RowButton, SectionLabel } from '../components/ui.js';
import MacroRack from '../components/MacroRack.js';
import VitalsStrip from '../components/VitalsStrip.js';
import type { TabProps } from './shared.js';

const ATTR_ORDER = ['bod', 'agi', 'rea', 'str', 'wil', 'log', 'int', 'cha'] as const;
const SPECIAL_ATTRS = ['ess', 'mag', 'res'] as const;

const ATTR_NAMES: Record<string, string> = {
  bod: 'Body',
  agi: 'Agility',
  rea: 'Reaction',
  str: 'Strength',
  wil: 'Willpower',
  log: 'Logic',
  int: 'Intuition',
  cha: 'Charisma',
  ess: 'Essence',
  mag: 'Magic',
  res: 'Resonance',
};

export default function SkillsTab({ character, derived, roll, overrideFor, campaignId }: TabProps) {
  const skills = [...character.sheet.skills].sort((a, b) => skillRowName(a).localeCompare(skillRowName(b)));
  const knowledge = knowledgeLines(character.sheet);
  const macroQuery = useMacros(campaignId);
  const macroMutation = useMacroMutation(campaignId);

  const openRoll = (skill: SheetSkill, pool: PoolBreakdown) => roll(skillRollConfig(skill, pool));

  return (
    <div className="p-4">
      <VitalsStrip derived={derived} overrideFor={overrideFor} />

      <SectionLabel>Attributes</SectionLabel>
      <div className="grid grid-cols-4 gap-1.5" role="group" aria-label="Attributes">
        {ATTR_ORDER.map((code) => {
          const attr = derived.attributes[code];
          if (!attr) return null;
          return (
            <BreakdownButton
              key={code}
              title={ATTR_NAMES[code] ?? code.toUpperCase()}
              value={attr.value}
              breakdown={attr.breakdown}
              override={overrideFor(`attr.${code}`)}
              className="panel flex flex-col items-center gap-0.5 py-2"
            >
              <span className="mono-label" aria-hidden>
                {code}
              </span>
              <span className="font-label text-lg text-ink" aria-hidden>
                {attr.value}
              </span>
            </BreakdownButton>
          );
        })}
      </div>
      <div className="mt-1.5 flex gap-1.5">
        {SPECIAL_ATTRS.map((code) => {
          const attr = derived.attributes[code];
          if (!attr || (code !== 'ess' && attr.value === 0)) return null;
          return (
            <BreakdownButton
              key={code}
              title={ATTR_NAMES[code] ?? code.toUpperCase()}
              value={attr.value}
              breakdown={attr.breakdown}
              className="chip text-dim hover:border-cyan"
            >
              <span aria-hidden>
                {code} <span className="text-ink">{attr.value}</span>
              </span>
            </BreakdownButton>
          );
        })}
        <span
          className="chip text-dim"
          aria-label={`Edge ${character.sheet.attributes.edg.current} of ${character.sheet.attributes.edg.max}`}
        >
          <span aria-hidden>
            edge {character.sheet.attributes.edg.current}/{character.sheet.attributes.edg.max}
          </span>
        </span>
      </div>

      <SectionLabel>Skills</SectionLabel>
      {skills.length === 0 && <Empty>No skills on this sheet yet.</Empty>}
      <ul className="divide-y divide-edge/60">
        {skills.map((skill) => {
          const key = skillPoolKey(skill.id, skill.target);
          const pool = derived.pools[key];
          if (!pool) return null;
          return (
            <li key={key} className="flex items-center gap-2">
              <RowButton
                label={skillRowLabel(skill, pool.total, pool.limit)}
                onActivate={() => openRoll(skill, pool)}
              >
                <div className="min-w-0 flex-1" aria-hidden>
                  <div className="truncate text-sm text-ink capitalize">{skillRowName(skill)}</div>
                  <div className="mono-label">
                    {skill.attr}
                    {skill.spec ? ` · spec: ${skill.spec}` : ''}
                    {` · rating ${skill.rating}`}
                  </div>
                </div>
              </RowButton>
              {pool.limit && (
                <span className="chip shrink-0 text-faint" aria-hidden>
                  L{pool.limit.value}
                </span>
              )}
              <BreakdownButton
                title={`${skillRowName(skill)} pool`}
                value={pool.total}
                breakdown={pool.breakdown}
                limit={pool.limit}
                override={overrideFor(`pool.${key}`)}
              />
            </li>
          );
        })}
      </ul>

      <SectionLabel>Knowledge and languages</SectionLabel>
      {knowledge.length === 0 && <Empty>No knowledge skills or languages on this sheet yet.</Empty>}
      {knowledge.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Knowledge skills and languages">
          {knowledge.map((k) => (
            <li key={k.key} className="chip text-dim">
              <span className="normal-case tracking-normal text-ink">{k.name}</span>
              <span>
                {' '}
                {k.kind} {k.rating}
                {k.spec ? ` · ${k.spec}` : ''}
              </span>
            </li>
          ))}
        </ul>
      )}

      <MacroRack
        macros={macroQuery.data?.macros ?? []}
        synced={macroQuery.data?.hasRemote ?? false}
        degraded={macroQuery.data?.degraded ?? false}
        busy={macroMutation.isPending}
        onSave={(next) => macroMutation.mutate(next)}
        onRoll={roll}
      />
    </div>
  );
}
