/** The GM's card, opened from the panel, a row, a rack chip, a banner or the menu: one at a time. */
import { useMemo } from 'react';
import type { Scene, Token } from '@safehouse/contracts';
import { lineOfSightBetween, type CoverLevel } from '@safehouse/rules';
import { useTrackerEncounter } from '../table/commands.js';
import CardFlow, { type CardFlowMode } from './CardFlow.js';
import DeclareAttack from './DeclareAttack.js';
import { closeGmCard, useGmCard, type GmCardRequest } from './gmCard.js';
import { GmActorBlock } from './TokenCombat.js';

export interface GmCardHostProps {
  campaignId: string;
  sceneId?: string | null;
  /** On the map: cover hints from line of sight, and "tap a token". */
  scene?: Scene;
  tokens?: readonly Token[];
}

function modeOf(req: Exclude<GmCardRequest, { kind: 'declare' }>): CardFlowMode {
  if (req.kind === 'act') return { kind: 'act', ...(req.start ? { start: req.start } : {}) };
  if (req.kind === 'defend') {
    return { kind: 'defend', exchangeId: req.exchangeId, against: req.against, ...(req.start ? { start: req.start } : {}) };
  }
  return { kind: 'card', action: { id: 'soak' }, exchangeId: req.exchangeId };
}

export default function GmCardHost({ campaignId, sceneId = null, scene, tokens }: GmCardHostProps) {
  const req = useGmCard((s) => s.req);
  const seq = useGmCard((s) => s.seq);
  const { encounter } = useTrackerEncounter(campaignId, null, sceneId);

  const coverOf = useMemo(() => {
    if (!scene || !tokens) return undefined;
    const rows = encounter?.combatants ?? [];
    const tokenOf = (id: string) => {
      const tokenId = rows.find((c) => c.id === id)?.tokenId;
      return tokenId ? tokens.find((t) => t.id === tokenId) : undefined;
    };
    return (attackerId: string, targetId: string): CoverLevel | null => {
      const from = tokenOf(attackerId);
      const to = tokenOf(targetId);
      return from && to ? (lineOfSightBetween(scene, from, to)?.cover ?? null) : null;
    };
  }, [scene, tokens, encounter]);

  if (!req) return null;
  if (req.kind === 'declare') {
    return (
      <DeclareAttack
        key={seq}
        campaignId={campaignId}
        sceneId={sceneId}
        target={req.target}
        targetName={req.targetName}
        onClose={closeGmCard}
      />
    );
  }
  return (
    <CardFlow
      key={seq}
      campaignId={campaignId}
      sceneId={sceneId}
      actor={req.actor}
      title={req.title}
      mode={modeOf(req)}
      gm
      // A runner's roll made at the table, entered by the GM.
      {...(req.runner ? { forActorBy: { role: 'player' as const, name: req.title } } : {})}
      {...(tokens ? { tokens } : {})}
      {...(coverOf ? { coverOf } : {})}
      {...(req.kind === 'act' && req.visibility ? { initialVisibility: req.visibility } : {})}
      {...(req.kind === 'act'
        ? { header: <GmActorBlock campaignId={campaignId} sceneId={sceneId} actor={req.actor} name={req.title} /> }
        : {})}
      onClose={closeGmCard}
    />
  );
}
