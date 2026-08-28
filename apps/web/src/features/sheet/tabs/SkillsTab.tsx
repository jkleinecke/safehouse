/**
 * Skills tab (FR3.2): attribute grid with provenance, then the skill list
 * with live pool numbers — tap a row to open the roll dialog (G1: ≤2 taps).
 */
import type { PoolBreakdown, SheetSkill } from '@safehouse/contracts';
import type { RollChip } from '../lib.js';
import { BreakdownButton } from '../components/Provenance.js';
import { Empty, SectionLabel } from '../components/ui.js';
import VitalsStrip from '../components/VitalsStrip.js';
import type { TabProps } from './shared.js';

const ATTR_ORDER = ['bod', 'agi', 'rea', 'str', 'wil', 'log', 'int', 'cha'] as const;
const SPECIAL_ATTRS = ['ess', 'mag', 'res'] as const;

/** +2 for a specialization — offered as an off-by-default chip (SR5 p.130). */
const SPEC_BONUS = 2;

export default function SkillsTab({ character, derived, roll, overrideFor }: TabProps) {
  const skills = [...character.sheet.skills].sort((a, b) => a.id.localeCompare(b.id));

  const openRoll = (skill: SheetSkill, pool: PoolBreakdown) => {
    const chips: RollChip[] = skill.spec
      ? [
          {
            id: `spec.${skill.id}`,
            label: `spec: ${skill.spec}`,
            value: SPEC_BONUS,
            active: false,
            source: 'situational',
          },
        ]
      : [];
    roll({
      title: skill.id,
      baseTotal: pool.total,
      baseBreakdown: pool.breakdown,
      ...(pool.limit ? { limit: pool.limit } : {}),
      ...(chips.length > 0 ? { extraChips: chips } : {}),
      meta: { poolKey: `skill.${skill.id}` },
    });
  };

  return (
    <div className="p-4">
      <VitalsStrip derived={derived} overrideFor={overrideFor} />

      <SectionLabel>Attributes</SectionLabel>
      <div className="grid grid-cols-4 gap-1.5">
        {ATTR_ORDER.map((code) => {
          const attr = derived.attributes[code];
          if (!attr) return null;
          return (
            <BreakdownButton
              key={code}
              title={code.toUpperCase()}
              value={attr.value}
              breakdown={attr.breakdown}
              override={overrideFor(`attr.${code}`)}
              className="panel flex flex-col items-center gap-0.5 py-2"
            >
              <span className="mono-label">{code}</span>
              <span className="font-label text-lg text-ink">{attr.value}</span>
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
              title={code.toUpperCase()}
              value={attr.value}
              breakdown={attr.breakdown}
              className="chip text-dim hover:border-cyan"
            >
              <span>
                {code} <span className="text-ink">{attr.value}</span>
              </span>
            </BreakdownButton>
          );
        })}
        <span className="chip text-dim">
          edge {character.sheet.attributes.edg.current}/{character.sheet.attributes.edg.max}
        </span>
      </div>

      <SectionLabel>Skills</SectionLabel>
      {skills.length === 0 && <Empty>No skills on this sheet yet.</Empty>}
      <ul className="divide-y divide-edge/60">
        {skills.map((skill) => {
          const pool = derived.pools[`skill.${skill.id}`];
          if (!pool) return null;
          return (
            <li key={skill.id}>
              <div
                className="flex w-full cursor-pointer items-center gap-2 py-2.5 text-left active:bg-raised/60"
                onClick={() => openRoll(skill, pool)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') openRoll(skill, pool);
                }}
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-ink capitalize">{skill.id}</div>
                  <div className="mono-label">
                    {skill.attr}
                    {skill.spec ? ` · spec: ${skill.spec}` : ''}
                    {` · rating ${skill.rating}`}
                  </div>
                </div>
                {pool.limit && (
                  <span className="chip shrink-0 text-faint">
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
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
