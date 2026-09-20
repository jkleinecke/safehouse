/**
 * /c/:campaignId/gm/npcs — the NPC manager (UX proposal 4.3).
 *
 * NPCs used to be spread over the codex, the generator and the Fixer page.
 * This is the one screen for them: a roster table on the left, one NPC on the
 * right with the GM's private notes, the persona, the register they speak
 * in, and the same in-character voice the dock offers — so "what would
 * Ratchet say" is a click from the card, not a screen change.
 *
 * Notes and dialect live on the persona (`persona.notes`, `persona.dialect`),
 * which is GM-only data already; the converse prompt reads the dialect and
 * never the notes.
 */
import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { DIALECTS, type NpcTemplate, type Persona } from '@safehouse/contracts';
import { useCampaign } from '../../../api/campaigns.js';
import { usePlaceToken, useScene } from '../../grid/api.js';
import { useActiveSceneId } from '../../grid/useGridLive.js';
import NpcVoice from '../fixer/NpcVoice.js';
import { useNpcTemplates, useSaveTemplate } from '../generator/api.js';
import { GmGuard, SectionTitle } from '../ui.js';

const inputCls = 'w-full rounded-md border border-edge bg-panel px-2 py-1 text-sm text-ink';

function personaOf(t: NpcTemplate): Persona {
  return {
    traits: [],
    goals: [],
    secrets: [],
    knowledge: [],
    mannerisms: [],
    hooks: [],
    ...(t.persona ?? {}),
  };
}

/** The tier labels a template rolls — "Ganger · Lieutenant" — or the archetype's own name. */
export function roleLine(t: NpcTemplate): string {
  const tiers = (t.gen?.tiers ?? []).map((x) => x.label).filter((x): x is string => Boolean(x));
  return tiers.length > 0 ? tiers.join(' · ') : 'archetype';
}

export function dialectLabel(id: string | undefined): string | null {
  if (!id) return null;
  return DIALECTS.find((d) => d.id === id)?.label ?? id;
}

/** Case-insensitive match on name, role, voice, traits and hooks. */
export function matchesQuery(t: NpcTemplate, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  const p = personaOf(t);
  const hay = [t.name, roleLine(t), p.voice ?? '', ...p.traits, ...p.hooks, dialectLabel(p.dialect) ?? '']
    .join(' ')
    .toLowerCase();
  return hay.includes(needle);
}

function Counts({ p }: { p: Persona }) {
  const bits = [
    p.secrets.length > 0 ? `${p.secrets.length} secret${p.secrets.length === 1 ? '' : 's'}` : null,
    p.hooks.length > 0 ? `${p.hooks.length} hook${p.hooks.length === 1 ? '' : 's'}` : null,
    p.knowledge.length > 0 ? `knows ${p.knowledge.length}` : null,
    p.notes && p.notes.trim().length > 0 ? 'notes' : null,
  ].filter((x): x is string => x !== null);
  return <span className="mono-label text-faint">{bits.join(' · ') || 'no persona yet'}</span>;
}

function List({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <div className="mono-label text-faint">{title}</div>
      <ul className="mt-0.5 list-disc pl-5 text-sm text-ink">
        {items.map((s, i) => (
          <li key={i}>{s}</li>
        ))}
      </ul>
    </div>
  );
}

function NpcDetail({ campaignId, npc, sessionLive }: { campaignId: string; npc: NpcTemplate; sessionLive: boolean }) {
  const save = useSaveTemplate(campaignId);
  const persona = personaOf(npc);
  const [notes, setNotes] = useState(persona.notes ?? '');
  const [voice, setVoice] = useState(persona.voice ?? '');
  const [dialect, setDialect] = useState(persona.dialect ?? '');
  const [talking, setTalking] = useState(false);
  const liveSceneId = useActiveSceneId();
  const liveScene = useScene(liveSceneId);
  const place = usePlaceToken();

  const dirty = notes !== (persona.notes ?? '') || voice !== (persona.voice ?? '') || dialect !== (persona.dialect ?? '');
  const savePersona = () =>
    save.mutate({
      ...npc,
      persona: {
        ...persona,
        ...(voice.trim() ? { voice: voice.trim() } : {}),
        ...(dialect ? { dialect } : {}),
        ...(notes.trim() ? { notes } : {}),
      },
    });

  const placeOnMap = () => {
    const scene = liveScene.data;
    if (!liveSceneId || !scene) return;
    place.mutate({
      sceneId: liveSceneId,
      token: {
        source: 'npc_template',
        sourceId: npc.id,
        name: npc.name,
        x: scene.grid.cols / 2,
        y: scene.grid.rows / 2,
        size: 1,
        hidden: true,
        level: 0,
        barsVisibility: 'gm',
      },
    });
  };

  return (
    <div className="flex flex-col gap-4" data-testid="npc-detail">
      <div>
        <div className="flex flex-wrap items-baseline gap-2">
          <h2 className="text-xl text-ink">{npc.name}</h2>
          <span className="mono-label text-dim">{roleLine(npc)}</span>
        </div>
        {persona.backstory && <p className="mt-1 max-w-prose text-sm text-dim">{persona.backstory}</p>}
      </div>

      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn btn-accent px-3 py-1" onClick={() => setTalking((t) => !t)}>
          {talking ? 'stop talking' : 'talk to them'}
        </button>
        <button
          type="button"
          className="btn px-3 py-1"
          disabled={!liveSceneId || place.isPending}
          title={liveSceneId ? 'A hidden token at the centre of the live scene' : 'No scene is on the table'}
          onClick={placeOnMap}
        >
          {place.isSuccess ? 'placed (hidden)' : 'place on the map'}
        </button>
      </div>

      {talking && (
        <div className="panel p-3">
          <NpcVoice key={npc.id} campaignId={campaignId} sessionLive={sessionLive} npcId={npc.id} />
        </div>
      )}

      <section className="panel space-y-3 p-3">
        <div className="mono-label text-cyan">How they sound</div>
        <label className="block">
          <span className="mono-label text-faint">Dialect</span>
          <select className={inputCls} value={dialect} onChange={(e) => setDialect(e.target.value)} data-testid="npc-dialect">
            <option value="">— none set —</option>
            {DIALECTS.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label} — {d.register}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mono-label text-faint">Voice</span>
          <input className={inputCls} value={voice} placeholder="warm to customers, flat to everyone else" onChange={(e) => setVoice(e.target.value)} />
        </label>
      </section>

      <section className="panel space-y-2 p-3">
        <div className="mono-label text-cyan">Your notes</div>
        <p className="text-xs text-faint">Private. Never read by the AI, never sent to a player.</p>
        <textarea
          className={`${inputCls} min-h-[8rem] font-mono text-xs`}
          value={notes}
          data-testid="npc-notes"
          placeholder="What they did last session. What they want from the team. What you have decided and not said yet."
          onChange={(e) => setNotes(e.target.value)}
        />
        <div className="flex items-center gap-2">
          <button type="button" className="btn btn-accent px-3 py-1" disabled={!dirty || save.isPending} onClick={savePersona}>
            {save.isPending ? 'saving…' : 'save'}
          </button>
          {save.isSuccess && !dirty && <span className="mono-label text-ok">saved</span>}
        </div>
      </section>

      <section className="panel space-y-3 p-3">
        <div className="mono-label text-cyan">Persona</div>
        <List title="Traits" items={persona.traits} />
        <List title="Mannerisms" items={persona.mannerisms} />
        <List title="Goals" items={persona.goals} />
        <List title="Knows" items={persona.knowledge} />
        <List title="Secrets" items={persona.secrets} />
        <List title="Hooks" items={persona.hooks} />
        {persona.traits.length + persona.goals.length + persona.knowledge.length === 0 && (
          <p className="text-sm text-faint">No persona yet — the Architect or the generator writes one, or ask the Fixer to.</p>
        )}
      </section>
    </div>
  );
}

export default function NpcsPage() {
  const { campaignId } = useParams<{ campaignId: string }>();
  const { data: campaign } = useCampaign(campaignId);
  const templates = useNpcTemplates(campaignId ?? '');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const list = useMemo(
    () => (templates.data ?? []).filter((t) => matchesQuery(t, query)).sort((a, b) => a.name.localeCompare(b.name)),
    [templates.data, query],
  );
  const selected = list.find((t) => t.id === selectedId) ?? (templates.data ?? []).find((t) => t.id === selectedId) ?? null;

  if (!campaignId) return null;
  const sessionLive = Boolean(campaign?.activeSessionId);

  return (
    <GmGuard>
      <div className="p-6">
        <div className="flex flex-wrap items-center gap-2">
          <SectionTitle>NPCs</SectionTitle>
          <span className="mono-label text-faint">{templates.data?.length ?? 0}</span>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          <div>
            <input
              className={inputCls}
              value={query}
              placeholder="find by name, role, voice, hook…"
              onChange={(e) => setQuery(e.target.value)}
              data-testid="npc-search"
            />
            <div className="panel mt-3 overflow-x-auto px-4 py-2">
              <table className="w-full min-w-[34rem] text-left" data-testid="npc-table">
                <thead>
                  <tr className="mono-label text-faint">
                    <th className="py-2 pr-3 font-normal">name</th>
                    <th className="py-2 pr-3 font-normal">role</th>
                    <th className="py-2 pr-3 font-normal">dialect</th>
                    <th className="py-2 pr-3 font-normal">voice</th>
                    <th className="py-2 font-normal">persona</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((t) => {
                    const p = personaOf(t);
                    const on = t.id === selectedId;
                    return (
                      <tr
                        key={t.id}
                        className={`cursor-pointer border-t border-edge hover:bg-edge/40 ${on ? 'bg-edge/60' : ''}`}
                        aria-selected={on}
                        onClick={() => setSelectedId(t.id)}
                      >
                        <td className="py-2 pr-3">
                          <button type="button" className={`text-left ${on ? 'text-cyan' : 'text-ink'}`}>
                            {t.name}
                          </button>
                        </td>
                        <td className="mono-label py-2 pr-3 text-dim">{roleLine(t)}</td>
                        <td className="py-2 pr-3">
                          {dialectLabel(p.dialect) ? <span className="chip text-faint">{dialectLabel(p.dialect)}</span> : null}
                        </td>
                        <td className="max-w-[16rem] truncate py-2 pr-3 text-xs text-dim">{p.voice ?? ''}</td>
                        <td className="py-2">
                          <Counts p={p} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {templates.isSuccess && list.length === 0 && (
                <p className="py-2 text-sm text-faint">No NPC matches. The generator and the Architect both create them.</p>
              )}
            </div>
          </div>
          <div>
            {selected ? (
              <NpcDetail key={selected.id} campaignId={campaignId} npc={selected} sessionLive={sessionLive} />
            ) : (
              <div className="panel p-5 text-sm text-dim">Pick an NPC to read them, keep notes, and talk to them.</div>
            )}
          </div>
        </div>
      </div>
    </GmGuard>
  );
}
