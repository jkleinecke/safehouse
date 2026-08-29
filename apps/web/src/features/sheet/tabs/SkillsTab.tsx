/**
 * Skills tab (FR3.2): attribute grid with provenance, the skill list with live
 * pool numbers, and the personal macro rack (FR2.8). Activating a skill row
 * opens the roll dialog (G1: ≤2 taps).
 *
 * Accessibility: the rows used to be click-handler `<div>`s with no accessible
 * name — a screen reader read a row of unlabelled buttons and a keyboard user
 * could not roll at all. Each row is now a real `<button>` carrying the pool in
 * its name, sitting BESIDE the provenance button rather than wrapping it
 * (nesting one button inside another is invalid and breaks tab order).
 */
import type { PoolBreakdown, SheetSkill } from '@safehouse/contracts';
import { skillRowLabel } from '../a11y.js';
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
  const skills = [...character.sheet.skills].sort((a, b) => a.id.localeCompare(b.id));
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
          const pool = derived.pools[`skill.${skill.id}`];
          if (!pool) return null;
          return (
            <li key={skill.id} className="flex items-center gap-2">
              <RowButton
                label={skillRowLabel(skill, pool.total, pool.limit)}
                onActivate={() => openRoll(skill, pool)}
              >
                <div className="min-w-0 flex-1" aria-hidden>
                  <div className="truncate text-sm text-ink capitalize">{skill.id}</div>
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
                title={`${skill.id} pool`}
                value={pool.total}
                breakdown={pool.breakdown}
                limit={pool.limit}
                override={overrideFor(`pool.skill.${skill.id}`)}
              />
            </li>
          );
        })}
      </ul>

      <MacroRack
        macros={macroQuery.data?.macros ?? []}
        synced={macroQuery.data?.hasRemote ?? false}
        busy={macroMutation.isPending}
        onSave={(next) => macroMutation.mutate(next)}
        onRoll={roll}
      />
    </div>
  );
}
