/** /c/:campaignId index — quick links into the table views. */
import { Link, useParams } from 'react-router-dom';
import { useMyCharacterId } from '../../api/campaigns.js';
import { getSession } from '../../api/session.js';

function Card({ to, title, blurb }: { to: string; title: string; blurb: string }) {
  return (
    <Link to={to} className="panel block p-4 transition-colors hover:border-cyan">
      <div className="font-label text-sm uppercase tracking-widest text-cyan">{title}</div>
      <p className="mt-1 text-sm text-dim">{blurb}</p>
    </Link>
  );
}

export default function CampaignHome() {
  const { campaignId } = useParams<{ campaignId: string }>();
  const session = getSession();
  const myCharacterId = useMyCharacterId(campaignId);
  const c = `/c/${campaignId}`;

  return (
    <div className="mx-auto max-w-lg space-y-3 p-4">
      <div className="mono-label">Where to, runner?</div>
      {myCharacterId && (
        <Card
          to={`${c}/sheet/${myCharacterId}`}
          title="Sheet"
          blurb="Your character — pools, monitors, gear, one tap to roll."
        />
      )}
      <Card to={`${c}/table`} title="Table" blurb="Shared roll log and the initiative tracker." />
      <Card to={`${c}/grid`} title="Grid" blurb="The tactical map — tokens, fog, pings." />
      <Card
        to={`${c}/codex`}
        title="Codex"
        blurb="NPCs, factions, locations, lore — what the team actually knows."
      />
      <Card
        to={`${c}/calendar`}
        title="Calendar"
        blurb="The Sixth World clock: runs, sessions, rent coming due."
      />
      {session?.role === 'gm' && (
        <Card
          to={`${c}/gm`}
          title="GM console"
          blurb="Runs, scenes, generator, Fixer, books, sessions."
        />
      )}
    </div>
  );
}
