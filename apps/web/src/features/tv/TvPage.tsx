/**
 * /tv/:campaignId — the table display (FR9.19–9.21, P1 scope).
 *
 * A kiosk: zero controls, huge type, player-visible data only (the server
 * filters a `display` socket exactly like a player's — Principle 4). It runs
 * unattended for a whole session, so it reconnects forever and every buffer
 * it touches has a lid.
 *
 * P1 shows the tracker and the roll feed; P2 replaces the ribbon backdrop
 * with the live scene once the Grid exists (FR9.21).
 */
import { useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { useCampaign } from '../../api/campaigns.js';
import { getSession } from '../../api/session.js';
import { useLiveStore } from '../../live/store.js';
import { useLiveConnection } from '../../live/useLiveConnection.js';
import { useEncounterList } from '../table/commands.js';
import BigMoment from './BigMoment.js';
import {
  isEncounterLive,
  latestMoment,
  tvControls,
  tvIngameDate,
  tvRibbon,
  tvScene,
  tvTakeover,
} from './feed.js';
import IdleCard from './IdleCard.js';
import Ribbon from './Ribbon.js';
import Takeover from './Takeover.js';
import { useLatched, useWakeLock, useWallClock } from './useKiosk.js';
import './tv.css';

/** How long a big moment owns the screen before the ribbon comes back. */
const MOMENT_TTL_MS = 14_000;
/** A handout takeover holds longer — people are reading it. */
const TAKEOVER_TTL_MS = 60_000;

function Kiosk({ children }: { children: React.ReactNode }) {
  return (
    <main className="tv-kiosk relative flex h-dvh w-dvw flex-col bg-ground text-ink">
      {children}
    </main>
  );
}

function NotJoined({ campaignId }: { campaignId: string }) {
  return (
    <Kiosk>
      <div className="flex h-full flex-col items-center justify-center text-center">
        <span className="font-label text-2xl tracking-[0.5em] text-cyan">SAFEHOUSE</span>
        <h1 className="mt-10 text-6xl font-bold">Display not joined</h1>
        <p className="mt-6 max-w-[30ch] text-3xl text-dim">
          Scan the GM&apos;s display QR on this screen to bind it to the campaign.
        </p>
        <span className="font-label mt-12 text-xl tracking-[0.3em] text-faint">{campaignId}</span>
      </div>
    </Kiosk>
  );
}

export default function TvPage() {
  const { campaignId } = useParams<{ campaignId: string }>();
  const session = getSession();
  const status = useLiveConnection(campaignId);
  useWakeLock();
  const clock = useWallClock();

  const events = useLiveStore((s) => s.events);
  const liveEncounter = useLiveStore((s) => s.encounter);
  const { data: campaign } = useCampaign(campaignId);
  const { data: encounterList } = useEncounterList(campaignId);

  const encounter = useMemo(
    () => liveEncounter ?? encounterList?.find((e) => e.state === 'live') ?? null,
    [liveEncounter, encounterList],
  );

  const controls = useMemo(() => tvControls(events), [events]);
  const scene = useMemo(() => tvScene(events), [events]);
  const ingameDate = useMemo(() => tvIngameDate(events), [events]);
  const moment = useMemo(() => latestMoment(events), [events]);
  const takeoverSource = useMemo(() => tvTakeover(events), [events]);
  const ribbon = useMemo(() => tvRibbon(encounter), [encounter]);

  const shownMoment = useLatched(moment, MOMENT_TTL_MS);
  const shownTakeover = useLatched(takeoverSource, TAKEOVER_TTL_MS);

  if (!campaignId) return <NotJoined campaignId="—" />;
  if (!session || session.campaignId !== campaignId) return <NotJoined campaignId={campaignId} />;

  // FR9.21: one-tap "blank the table" from the GM console.
  if (controls.blank) {
    return (
      <Kiosk>
        <div className="flex h-full items-center justify-center">
          <span className="font-label tv-breathe text-xl tracking-[0.6em] text-faint">◆</span>
        </div>
      </Kiosk>
    );
  }

  const fighting = isEncounterLive(encounter) && ribbon.length > 0 && controls.ribbon;
  const campaignName = campaign?.name ?? 'Safehouse';
  const sceneName = scene?.name ?? null;

  return (
    <Kiosk>
      {/* Standing header — the table always knows where it is. */}
      <header className="flex shrink-0 items-baseline gap-8 px-12 pt-8">
        <span className="font-label text-xl tracking-[0.45em] text-cyan">{campaignName}</span>
        {sceneName && <span className="truncate text-3xl text-dim">{sceneName}</span>}
        <span className="font-label ml-auto text-xl tracking-[0.3em] text-faint">
          {ingameDate ?? campaign?.ingameDate ?? ''}
        </span>
        <span
          className={`h-3 w-3 rounded-full ${
            status === 'online' ? 'bg-ok' : status === 'connecting' ? 'bg-warn tv-breathe' : 'bg-danger tv-breathe'
          }`}
          aria-label={`Connection ${status}`}
        />
      </header>

      <div className="relative min-h-0 flex-1 px-12 pb-10 pt-6">
        {fighting ? (
          <div className="flex h-full flex-col justify-between gap-8">
            <Ribbon rows={ribbon} turn={encounter?.turn ?? 1} pass={encounter?.pass ?? 1} />
            <div className="min-h-0">{shownMoment && <BigMoment moment={shownMoment} />}</div>
          </div>
        ) : shownMoment ? (
          <div className="flex h-full items-center justify-center">
            <BigMoment moment={shownMoment} />
          </div>
        ) : (
          <IdleCard
            campaignName={campaignName}
            sceneName={sceneName}
            ingameDate={ingameDate ?? campaign?.ingameDate ?? null}
            clock={clock}
            online={status === 'online'}
          />
        )}

        {/* Handout takeover region — listens for `handout.revealed` (FR9.20). */}
        {shownTakeover && <Takeover takeover={shownTakeover} />}
      </div>
    </Kiosk>
  );
}
