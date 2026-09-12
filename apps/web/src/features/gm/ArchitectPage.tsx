/**
 * `/c/:campaignId/gm/architect` — the overarching AI.
 *
 * The Fixer answers one question at a time; the Architect roughs out a whole
 * stretch of play from one brief — the lore, the people, the places — and
 * then builds the items the GM ticks, each through the lane that already
 * exists for it: codex pages and NPCs land in the drafts inbox (Principle 8),
 * scenes are staged with a floor laid out by the floor builder. Nothing is
 * written until the GM presses build; every request is cancellable; a build
 * stopped half-way says what landed.
 */
import { useCallback, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useLiveStore } from '../../live/store.js';
import ArchitectView, { type ItemType } from './architect/ArchitectView.js';
import {
  aiDisabledFrom,
  isAiCancelled,
  useArchitectBuild,
  useArchitectOutline,
  useCancelAi,
  useFixerStatus,
  type ArchitectBuildResult,
  type ArchitectOutline,
  type ArchitectSelection,
} from './fixer/api.js';
import { GmGuard, SectionTitle } from './ui.js';

const allOf = (n: number): number[] => Array.from({ length: n }, (_, i) => i);

/** Everything ticked: the outline is the plan, the GM unticks what they do not want. */
export function selectAll(outline: ArchitectOutline): ArchitectSelection {
  return { lore: allOf(outline.lore.length), npcs: allOf(outline.npcs.length), scenes: allOf(outline.scenes.length) };
}

export function toggled(sel: ArchitectSelection, type: ItemType, index: number): ArchitectSelection {
  const list = sel[type];
  const next = list.includes(index) ? list.filter((i) => i !== index) : [...list, index].sort((a, b) => a - b);
  return { ...sel, [type]: next };
}

export default function ArchitectPage() {
  const { campaignId } = useParams<{ campaignId: string }>();
  if (!campaignId) return null;
  return (
    <GmGuard>
      <div className="p-6">
        <SectionTitle hint="one brief → pages, NPCs and mapped scenes, as drafts">Architect</SectionTitle>
        <h1 className="mt-1 text-lg font-semibold">Rough out a stretch of the campaign</h1>
        <p className="mt-1 max-w-2xl text-sm text-dim">
          Describe what you need — a run, an arc, a district — and the Architect answers with an
          outline: codex pages, NPCs with personas, scenes with floors. Tick what you want, build,
          and each item arrives the way the Fixer's drafts do: pages and NPCs in the inbox to accept
          or bin, scenes staged on the Scenes screen, never active until you say.
        </p>
        <ArchitectBody campaignId={campaignId} />
      </div>
    </GmGuard>
  );
}

function ArchitectBody({ campaignId }: { campaignId: string }) {
  const status = useFixerStatus();
  const outlineReq = useArchitectOutline();
  const buildReq = useArchitectBuild(campaignId);
  const cancel = useCancelAi(campaignId);
  const live = useLiveStore((s) => s.aiActivity);
  const [brief, setBrief] = useState('');
  const [outline, setOutline] = useState<ArchitectOutline | null>(null);
  const [ticked, setTicked] = useState<ArchitectSelection>({ lore: [], npcs: [], scenes: [] });
  const [result, setResult] = useState<ArchitectBuildResult | null>(null);

  const offline = aiDisabledFrom(status.data, status.error, outlineReq.error, buildReq.error);

  const onOutline = useCallback(() => {
    const text = brief.trim();
    if (text.length < 10 || outlineReq.isPending || buildReq.isPending) return;
    setResult(null);
    outlineReq.mutate(
      { campaignId, brief: text },
      {
        onSuccess: (r) => {
          setOutline(r.outline);
          setTicked(selectAll(r.outline));
        },
      },
    );
  }, [brief, campaignId, outlineReq, buildReq.isPending]);

  const onBuild = useCallback(() => {
    if (!outline || buildReq.isPending) return;
    setResult(null);
    buildReq.mutate({ outline, select: ticked }, { onSuccess: (r) => setResult(r) });
  }, [outline, ticked, buildReq]);

  return (
    <ArchitectView
      campaignId={campaignId}
      offline={offline}
      brief={brief}
      onBrief={setBrief}
      outline={outline}
      ticked={ticked}
      onToggle={(type, i) => setTicked((s) => toggled(s, type, i))}
      onToggleAll={(type, on) => setTicked((s) => ({ ...s, [type]: on && outline ? allOf(outline[type].length) : [] }))}
      outlining={outlineReq.isPending}
      building={buildReq.isPending}
      progress={live?.kind === 'architect' ? live.label : null}
      cancelling={cancel.isPending || live?.state === 'cancelling'}
      result={result}
      outlineError={isAiCancelled(outlineReq.error) ? null : outlineReq.error}
      buildError={isAiCancelled(buildReq.error) ? null : buildReq.error}
      outlineCancelled={isAiCancelled(outlineReq.error)}
      buildCancelled={isAiCancelled(buildReq.error)}
      onOutline={onOutline}
      onBuild={onBuild}
      onCancel={() => cancel.mutate()}
      onStartOver={() => {
        setOutline(null);
        setTicked({ lore: [], npcs: [], scenes: [] });
        setResult(null);
      }}
    />
  );
}
