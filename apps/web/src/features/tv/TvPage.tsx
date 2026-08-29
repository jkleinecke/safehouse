/**
 * /tv/:campaignId — the table display (FR9.19–9.21).
 *
 * A kiosk: zero controls, huge type, player-visible data only. The server
 * filters a `display` socket exactly like a player's (Principle 4), so this
 * page renders precisely what arrives and never asks a GM endpoint anything.
 *
 * Three properties it has to hold, because nobody will walk over and fix it:
 *
 * 1. **It hydrates.** The active scene, its tokens, the revealed fog and the
 *    live encounter all come from REST on mount and after every reconnect; the
 *    WebSocket is the delta on that read, never the only source. A TV rebooted
 *    mid-firefight comes back to the current scene by itself.
 * 2. **It reconnects forever.** `LiveSocket` retries with capped backoff and
 *    replays from `last_event_id`; `useTvRehydrate` re-reads on every
 *    reconnection and slowly on a timer, in case the gap outran the buffer.
 * 3. **It does not leak.** One stage (one ticker), capped event and moment
 *    buffers, every timer single and cleared, and nothing allocated per frame —
 *    the per-frame work all lives inside the pixi stage.
 */
import { useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { getSession } from '../../api/session.js';
import { useLiveStore } from '../../live/store.js';
import { useLiveConnection } from '../../live/useLiveConnection.js';
import BigMoment from './BigMoment.js';
import { isTvEncounterLive, tvRibbonRows, tvTokenDecor } from './encounterState.js';
import { latestMoment, tvControls, tvIngameDate, tvTakeover } from './feed.js';
import { useTvWorld } from './hydrate.js';
import IdleCard from './IdleCard.js';
import RevealBanner from './RevealBanner.js';
import Ribbon from './Ribbon.js';
import { tvReveal } from './sceneState.js';
import Takeover from './Takeover.js';
import TvStageView from './TvStageView.js';
import { useFocusMark, useLatched, useWakeLock, useWallClock } from './useKiosk.js';
import './tv.css';

/** How long a big moment owns the screen before the map comes back. */
const MOMENT_TTL_MS = 14_000;
/** A roll the GM flagged for the table holds longer, and holds centre stage. */
const FLAGGED_TTL_MS = 26_000;
/** A handout takeover holds longest — people are reading it. */
const TAKEOVER_TTL_MS = 60_000;
/** A staged reveal is an announcement, not a screen state. */
const REVEAL_TTL_MS = 5_000;

function Kiosk({ children }: { children: React.ReactNode }) {
  return (
    <main className="tv-kiosk relative flex h-dvh w-dvw flex-col overflow-hidden bg-ground text-ink">
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
  // Only a device actually bound to this campaign issues reads; an unjoined TV
  // must show the QR prompt, not a wall of 401s.
  const bound =
    session && campaignId && session.campaignId === campaignId ? campaignId : undefined;

  const status = useLiveConnection(bound);
  useWakeLock();
  const clock = useWallClock();

  const events = useLiveStore((s) => s.events);
  const world = useTvWorld(bound);

  const controls = useMemo(() => tvControls(events), [events]);
  const clockDate = useMemo(() => tvIngameDate(events), [events]);
  const moment = useMemo(() => latestMoment(events), [events]);
  const takeoverSource = useMemo(() => tvTakeover(events), [events]);
  const revealSource = useMemo(() => tvReveal(events), [events]);

  const scene = world.scene;
  const tokens = scene?.tokens;
  const decor = useMemo(
    () => tvTokenDecor(world.encounter, tokens ?? []),
    [world.encounter, tokens],
  );
  const ribbon = useMemo(() => tvRibbonRows(world.encounter), [world.encounter]);
  const focus = useFocusMark(world.sceneId);

  const shownMoment = useLatched(moment, moment?.flagged ? FLAGGED_TTL_MS : MOMENT_TTL_MS);
  const shownTakeover = useLatched(takeoverSource, TAKEOVER_TTL_MS);
  const shownReveal = useLatched(revealSource, REVEAL_TTL_MS);

  if (!campaignId) return <NotJoined campaignId="—" />;
  if (!bound) return <NotJoined campaignId={campaignId} />;

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

  const fighting = isTvEncounterLive(world.encounter) && ribbon.length > 0 && controls.ribbon;
  const ingameDate = clockDate ?? world.ingameDate;
  const sceneName = scene?.scene.name ?? null;
  const turn = world.encounter?.turn ?? 1;
  const pass = world.encounter?.pass ?? 1;

  const header = (
    <header className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-baseline gap-8 bg-gradient-to-b from-ground/95 to-transparent px-12 pb-10 pt-8">
      <span className="font-label text-xl tracking-[0.45em] text-cyan">{world.campaignName}</span>
      {sceneName && <span className="truncate text-3xl text-dim">{sceneName}</span>}
      <span className="font-label ml-auto text-xl tracking-[0.3em] text-faint">
        {ingameDate ?? ''}
      </span>
      <span
        className={`h-3 w-3 rounded-full ${
          status === 'online'
            ? 'bg-ok'
            : status === 'connecting'
              ? 'bg-warn tv-breathe'
              : 'bg-danger tv-breathe'
        }`}
        aria-label={`Connection ${status}`}
      />
    </header>
  );

  // ---- the scene on the big screen (the P2 exit criterion) -----------------
  if (scene) {
    return (
      <Kiosk>
        <TvStageView
          scene={scene.scene}
          tokens={scene.tokens}
          bars={decor.bars}
          actingTokenId={decor.actingTokenId}
          focus={focus}
        />

        {header}
        {shownReveal && <RevealBanner reveal={shownReveal} />}

        {shownMoment &&
          (shownMoment.flagged ? (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-ground/70 px-16">
              <div className="w-full max-w-[72rem]">
                <BigMoment moment={shownMoment} />
              </div>
            </div>
          ) : (
            <div className="absolute bottom-32 right-10 z-10 w-[46rem] max-w-[48vw]">
              <BigMoment moment={shownMoment} />
            </div>
          ))}

        {fighting && (
          <div className="absolute inset-x-0 bottom-0 z-10 px-8 pb-7">
            <Ribbon rows={ribbon} turn={turn} pass={pass} compact />
          </div>
        )}

        {shownTakeover && <Takeover takeover={shownTakeover} />}
      </Kiosk>
    );
  }

  // ---- no map yet: the P1 tracker + roll feed, and the idle card -----------
  return (
    <Kiosk>
      <header className="flex shrink-0 items-baseline gap-8 px-12 pt-8">
        <span className="font-label text-xl tracking-[0.45em] text-cyan">{world.campaignName}</span>
        <span className="font-label ml-auto text-xl tracking-[0.3em] text-faint">
          {ingameDate ?? ''}
        </span>
        <span
          className={`h-3 w-3 rounded-full ${
            status === 'online'
              ? 'bg-ok'
              : status === 'connecting'
                ? 'bg-warn tv-breathe'
                : 'bg-danger tv-breathe'
          }`}
          aria-label={`Connection ${status}`}
        />
      </header>

      <div className="relative min-h-0 flex-1 px-12 pb-10 pt-6">
        {fighting ? (
          <div className="flex h-full flex-col justify-between gap-8">
            <Ribbon rows={ribbon} turn={turn} pass={pass} />
            <div className="min-h-0">{shownMoment && <BigMoment moment={shownMoment} />}</div>
          </div>
        ) : shownMoment ? (
          <div className="flex h-full items-center justify-center">
            <BigMoment moment={shownMoment} />
          </div>
        ) : world.hydrated ? (
          <IdleCard
            campaignName={world.campaignName}
            sceneName={null}
            ingameDate={ingameDate}
            clock={clock}
            online={status === 'online'}
          />
        ) : (
          // Before the first REST answer, "Standing by" would be a guess. The
          // difference between "the GM has no scene up" and "we have not asked
          // yet" is exactly what LIVE-1 was about.
          <div className="flex h-full items-center justify-center">
            <span className="font-label tv-breathe text-2xl tracking-[0.5em] text-faint">
              CONNECTING
            </span>
          </div>
        )}

        {shownTakeover && <Takeover takeover={shownTakeover} />}
      </div>
    </Kiosk>
  );
}
