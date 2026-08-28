/**
 * /c/:campaignId/gm/generator — the Opposition Kit (M10): archetype template
 * editor (FR10.1), seeded generation with locks (FR10.2) and
 * promote-to-template (FR10.3), and the encounter builder whose party-aware
 * THREAT READOUT recomputes as the levers move (FR10.4–10.6).
 */
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import EncounterBuilder from './generator/EncounterBuilder.js';
import GeneratePanel from './generator/GeneratePanel.js';
import TemplateEditor from './generator/TemplateEditor.js';
import { useNpcTemplates } from './generator/api.js';
import type { RosterEntry } from './generator/roster.js';
import { GmGuard, SectionTitle } from './ui.js';

const TABS = [
  { id: 'generate', label: 'Generate', hint: 'FR10.2' },
  { id: 'encounter', label: 'Encounter + readout', hint: 'FR10.4–10.6' },
  { id: 'archetypes', label: 'Archetypes', hint: 'FR10.1' },
] as const;

type TabId = (typeof TABS)[number]['id'];

export default function GeneratorPage() {
  const { campaignId } = useParams<{ campaignId: string }>();
  const [tab, setTab] = useState<TabId>('generate');
  const [entries, setEntries] = useState<RosterEntry[]>([]);
  const templates = useNpcTemplates(campaignId ?? '');

  if (!campaignId) return null;
  const list = templates.data ?? [];

  return (
    <GmGuard>
      <div className="p-6">
        <SectionTitle hint="build opposition in minutes, balance it against the real party">
          Opposition kit
        </SectionTitle>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={`chip cursor-pointer ${
                tab === t.id ? 'border-cyan text-cyan' : 'text-dim hover:text-ink'
              }`}
              onClick={() => setTab(t.id)}
              title={t.hint}
            >
              {t.label}
            </button>
          ))}
          {entries.length > 0 && (
            <span className="mono-label ml-2 text-faint">
              {entries.length} part(s) staged for the encounter
            </span>
          )}
        </div>

        <div className="mt-5">
          {tab === 'generate' && (
            <GeneratePanel
              campaignId={campaignId}
              templates={list}
              onAddEntry={(entry) => {
                setEntries((cur) => [...cur, entry]);
                setTab('encounter');
              }}
            />
          )}
          {tab === 'encounter' && (
            <EncounterBuilder
              campaignId={campaignId}
              templates={list}
              entries={entries}
              setEntries={setEntries}
            />
          )}
          {tab === 'archetypes' && <TemplateEditor campaignId={campaignId} />}
        </div>
      </div>
    </GmGuard>
  );
}
