/**
 * Quick-roll rack on generator-backed NPC rows (FR10.7): one-tap attack /
 * defense / soak / composure rolls into the log, plus the resolve-chain
 * launcher (FR10.8). GM only — the parent gates rendering.
 *
 * The rack is computed SERVER-side (`GET /api/combatants/:id/quick-rolls`) and
 * rolled server-side (`POST .../quick-roll`), so the pools already carry live
 * wound state and the active scene's environment modifiers. The client never
 * proposes a pool for a combatant: it names a rack key and the server decides
 * what that is worth right now.
 */
import { useMutation, useQuery } from '@tanstack/react-query';
import type { Combatant, LimitRef, ProvenanceEntry } from '@safehouse/contracts';
import { apiGet, apiPost } from '../../api/client.js';

export interface CopilotRackProps {
  campaignId: string;
  combatant: Combatant;
  /** Rack rolls default behind the screen; the tracker header can flip this. */
  visibility: 'gm' | 'public';
  onOpenChain: () => void;
}

/** One rollable row as the server offers it. */
export interface RackEntry {
  /** Stable id the quick-roll endpoint takes (`attack:Beretta`, `defense`, …). */
  key: string;
  kind: string;
  label: string;
  pool: number;
  breakdown: ProvenanceEntry[];
  limit?: LimitRef;
  weapon?: { name: string; dv: string | null; ap: number };
}

export interface QuickRolls {
  combatantId: string;
  woundModifier: number;
  entries: RackEntry[];
  sceneModifiers: ProvenanceEntry[];
}

/** Short chip label: the first word of the row, upper-cased ("ATK", "DEF"). */
function chipLabel(entry: RackEntry): string {
  const head = entry.kind || entry.label;
  return head.slice(0, 4).toUpperCase();
}

export default function CopilotRack({
  campaignId,
  combatant,
  visibility,
  onOpenChain,
}: CopilotRackProps) {
  void campaignId; // the roll is scoped by the combatant, not the campaign

  const rack = useQuery({
    queryKey: ['combatant', combatant.id, 'quick-rolls'],
    queryFn: () => apiGet<QuickRolls>(`/api/combatants/${combatant.id}/quick-rolls`),
    // A hand-added combatant has no copilot config and answers 404/empty;
    // that is a normal state, not something to retry at.
    retry: false,
    staleTime: 10_000,
  });

  const roll = useMutation({
    mutationFn: (key: string) =>
      apiPost<unknown>(`/api/combatants/${combatant.id}/quick-roll`, { key, visibility }),
  });

  const entries = rack.data?.entries ?? [];
  if (entries.length === 0) return null;

  const wounds = rack.data?.woundModifier ?? 0;

  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1">
      {entries.map((entry) => (
        <button
          key={entry.key}
          type="button"
          className="chip border-edge-bright hover:border-cyan hover:text-cyan disabled:opacity-30"
          disabled={roll.isPending}
          title={`${entry.label} — pool ${entry.pool}${
            entry.limit ? ` (limit ${entry.limit.kind} ${entry.limit.value})` : ''
          }`}
          onClick={() => roll.mutate(entry.key)}
        >
          {chipLabel(entry)} {entry.pool}
        </button>
      ))}
      {wounds !== 0 && (
        <span className="mono-label text-warn" title="Already folded into every pool above">
          wounds {wounds}
        </span>
      )}
      <button
        type="button"
        className="chip border-magenta-dim text-magenta hover:border-magenta"
        title="Resolve a full attack exchange (FR10.8)"
        onClick={onOpenChain}
      >
        CHAIN ▸
      </button>
    </div>
  );
}
