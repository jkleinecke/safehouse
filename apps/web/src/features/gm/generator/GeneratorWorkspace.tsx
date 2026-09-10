/**
 * The Opposition Kit workspace (M10) — tabs, and the wiring that makes the
 * cold start a path instead of a wall.
 *
 * The four surfaces are one loop: install or author an archetype (library /
 * archetypes), roll bodies out of it (generate), compose them into an
 * encounter and read the threat math (encounter). Every one of them can hand
 * the GM to the next, which is the difference between a tool and four screens.
 *
 * The template list is hydrated here once (TanStack Query, on mount — never
 * assembled from live events) and passed down, so the panels agree about what
 * exists and an install shows up everywhere at once.
 */
import { useState } from 'react';
import type { NpcTemplate } from '@safehouse/contracts';
import { SectionTitle } from '../ui.js';
import EncounterBuilder from './EncounterBuilder.js';
import GeneratePanel from './GeneratePanel.js';
import StarterLibrary from './StarterLibrary.js';
import TemplateEditor from './TemplateEditor.js';
import { useNpcTemplates, type NpcTemplateDraft } from './api.js';
import { blankDraft, draftFor, duplicateDraft } from './drafts.js';
import type { RosterEntry } from './roster.js';

const TABS = [
  { id: 'generate', label: 'Generate', hint: 'Roll an NPC or a whole squad from an archetype' },
  { id: 'encounter', label: 'Fight + readout', hint: 'Compose the fight and read the threat math against the party' },
  { id: 'archetypes', label: 'Archetypes', hint: 'Your archetypes: the ranges, loadouts and tiers bodies are rolled from' },
  { id: 'library', label: 'Starter library', hint: 'Original starter archetypes to install — none of them a book stat block' },
] as const;

export type TabId = (typeof TABS)[number]['id'];

export function isTabId(v: string | null | undefined): v is TabId {
  return TABS.some((t) => t.id === v);
}

export interface GeneratorWorkspaceProps {
  campaignId: string;
  /** From `?template=` — a codex page handing its archetype over (FR5.6). */
  linkedTemplateId?: string | undefined;
  /**
   * From `?tab=` — a deep link that opens on one surface.
   *
   * The GM console's setup checklist uses it: a campaign with no archetypes
   * gets an "Opposition — nothing to throw at them yet" row pointing at
   * `/c/:campaignId/gm/generator?tab=library`, so the cold start is one click
   * from the console rather than a tab the GM has to find.
   */
  initialTab?: TabId | undefined;
}

export default function GeneratorWorkspace({
  campaignId,
  linkedTemplateId,
  initialTab,
}: GeneratorWorkspaceProps) {
  const templates = useNpcTemplates(campaignId);
  const list = templates.data ?? [];
  const empty = list.length === 0 && !templates.isLoading;

  const [tab, setTab] = useState<TabId>(initialTab ?? 'generate');
  const [entries, setEntries] = useState<RosterEntry[]>([]);
  /**
   * The draft the editor opens on, plus a nonce that re-keys it. Pushing a
   * second "duplicate & edit" while the first is still open has to replace the
   * form; without the nonce React keeps the old state and the GM edits the
   * wrong archetype.
   */
  const [editor, setEditor] = useState<{ draft: NpcTemplateDraft; n: number } | null>(null);

  const openEditor = (draft: NpcTemplateDraft) => {
    setEditor((cur) => ({ draft, n: (cur?.n ?? 0) + 1 }));
    setTab('archetypes');
  };

  const onInstalled = (installed: NpcTemplate[]) => {
    // First archetypes in the campaign: land the GM on the thing they came for.
    if (empty && installed.length > 0) setTab('generate');
  };

  return (
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
            {t.id === 'library' && empty && <span className="ml-1.5 text-warn">start here</span>}
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
            isLoading={templates.isLoading}
            initialTemplateId={linkedTemplateId}
            onBrowseLibrary={() => setTab('library')}
            onCreateOwn={() => openEditor(blankDraft())}
            onEditTemplate={(tpl) => openEditor(draftFor(tpl))}
            onDuplicateTemplate={(tpl) => openEditor(duplicateDraft(tpl, list))}
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
        {tab === 'archetypes' && (
          <TemplateEditor
            key={editor?.n ?? 0}
            campaignId={campaignId}
            initialDraft={editor?.draft}
            onBrowseLibrary={() => setTab('library')}
          />
        )}
        {tab === 'library' && (
          <StarterLibrary
            campaignId={campaignId}
            templates={list}
            onInstalled={onInstalled}
            onEditTemplate={(tpl) => openEditor(draftFor(tpl))}
            onCreateOwn={() => openEditor(blankDraft())}
          />
        )}
      </div>
    </div>
  );
}
