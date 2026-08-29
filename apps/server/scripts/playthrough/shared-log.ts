/**
 * The shared log itself (FR2.9 / §11) — the beat that was missing.
 *
 * Every other beat proves a roll HAPPENED: it reads the dice back off
 * `GET /api/rolls/:id` and `GET /api/campaigns/:id/rolls`, which is the
 * immutable record (G5). None of them ever asked the question the table asks,
 * which is "did it show up on the log?".
 *
 * Those are two different writes. `rolls` is a row; the log is an append to
 * `ws_events`, and it is the append that the sockets replay and that
 * `GET /api/campaigns/:id/log` reads. When the second one fails the first one
 * still succeeds, so a playthrough that only checks the record scores a clean
 * run while the table's log has been frozen since the seed — which is exactly
 * what happened. So this beat walks all three surfaces for one roll:
 *
 *   the record   GET /api/campaigns/:id/rolls   (already covered elsewhere)
 *   the log      GET /api/campaigns/:id/log     (was never checked)
 *   the wire     the GM's live socket           (was only checked for combat)
 *
 * …and then does the same for the two non-dice writes that share the path:
 * table talk from a phone, and the GM advancing the in-game clock.
 */
import type { Api, Live } from './harness.js';
import { settle } from './harness.js';
import type { World } from './setup.js';
import type { Ctx, Dict, Phone } from './types.js';

/** Distinctive enough that nothing else in the campaign can satisfy the check. */
const TALK_LINE = 'Sparrow, on the table channel: the skiff is still tied up at the north cleat.';
const ROLL_LABEL = 'listening to the water';

interface LogEvent {
  id: number;
  type: string;
  payload: Dict;
  visibility: string;
  ts: string;
}

interface LogPage {
  events: LogEvent[];
}

const rollIdOf = (e: LogEvent): string | undefined =>
  typeof e.payload['id'] === 'string' ? e.payload['id'] : undefined;

/**
 * One roll, one line of table talk and one clock tick, each checked on the
 * record, on the log and on the wire.
 */
export async function sharedLog(
  ctx: Ctx,
  world: World,
  gm: Api,
  phones: Record<string, Phone>,
  gmLive: Live,
): Promise<void> {
  const { checks, story } = ctx;
  checks.beat('5b · The shared log');
  story.beat('Between the fight and the paperwork — what the log actually says');

  const cid = world.campaignId;
  const log = (as: Api): Promise<LogPage> => as.get<LogPage>(`/api/campaigns/${cid}/log?limit=200`);

  const phone = phones['Sparrow'] ?? Object.values(phones)[0];
  if (!phone) throw new Error('shared-log beat: no phone to roll from');

  const before = await log(gm);
  const highWater = before.events.reduce((n, e) => Math.max(n, e.id), 0);
  checks.record(
    'the log is not empty before the beat starts',
    'events already on the record',
    `${before.events.length} events, newest id ${highWater}`,
    before.events.length > 0,
  );

  // --- a roll made during the session --------------------------------------
  const { roll } = await phone.api.post<{ roll: { id: string; hits: number; faces: number[]; request: { pool: number } } }>(
    '/api/rolls',
    {
      kind: 'simple',
      pool: 5,
      breakdown: [{ label: ROLL_LABEL, value: 5 }],
      visibility: 'public',
      actor: { characterId: phone.characterId },
      meta: { label: ROLL_LABEL, title: ROLL_LABEL },
    },
  );
  await settle();

  // 1 — the record (the leg the playthrough already had)
  const page = await gm.get<{ rolls: { id: string }[] }>(`/api/campaigns/${cid}/rolls?limit=200`);
  checks.record(
    'the roll is on the immutable record',
    'present in GET /api/campaigns/:id/rolls',
    page.rolls.some((r) => r.id === roll.id) ? 'present' : 'missing',
    page.rolls.some((r) => r.id === roll.id),
  );

  // 2 — the log (the leg that was missing)
  const afterGm = await log(gm);
  const loggedForGm = afterGm.events.find((e) => e.type === 'roll.created' && rollIdOf(e) === roll.id);
  checks.record(
    '…and on the shared log the GM reads back',
    "a roll.created event carrying the roll's id",
    loggedForGm ? `event ${loggedForGm.id}` : `absent — ${afterGm.events.length} events, newest ${afterGm.events[0]?.id ?? 0}`,
    loggedForGm !== undefined,
  );
  checks.record(
    '…so the log has actually grown since the beat began',
    `an event id above ${highWater}`,
    String(loggedForGm?.id ?? 0),
    (loggedForGm?.id ?? 0) > highWater,
  );

  // 3 — the same log, read from the phone that rolled (public visibility)
  const afterPhone = await log(phone.api);
  checks.record(
    "…and on the player's own log, because a public roll is the table's",
    "roll.created present on the phone's read",
    afterPhone.events.some((e) => e.type === 'roll.created' && rollIdOf(e) === roll.id) ? 'present' : 'missing',
    afterPhone.events.some((e) => e.type === 'roll.created' && rollIdOf(e) === roll.id),
  );

  // 4 — the wire: live and persisted must be the same event, not two stories
  const liveFrame = gmLive.frames.find(
    (f) => f.type === 'roll.created' && (f.payload as Dict | undefined)?.['id'] === roll.id,
  );
  checks.record(
    '…and it reached the live socket as the same event id',
    `frame id ${loggedForGm?.id ?? '?'}`,
    liveFrame ? String(liveFrame.id) : 'no frame',
    liveFrame !== undefined && liveFrame.id === loggedForGm?.id,
  );

  // --- table talk ----------------------------------------------------------
  const talk = await phone.api.post<{ event: { id: number } }>(`/api/campaigns/${cid}/log`, {
    kind: 'talk',
    text: TALK_LINE,
    visibility: 'public',
  });
  await settle();
  const withTalk = await log(gm);
  const talkEvent = withTalk.events.find((e) => e.id === talk.event.id);
  checks.record(
    'table talk from a phone appends to the same log',
    `event ${talk.event.id} readable back`,
    talkEvent ? 'present' : 'missing',
    talkEvent !== undefined && JSON.stringify(talkEvent.payload).includes('north cleat'),
  );

  // --- the clock -----------------------------------------------------------
  const campaign = await gm.get<{ ingameDate: string | null }>(`/api/campaigns/${cid}`);
  const nextDay = advance(campaign.ingameDate ?? '2076-06-12');
  const patched = await gm.patch<{ ingameDate: string }>(`/api/campaigns/${cid}`, {
    ingameDate: nextDay,
  });
  await settle();
  const withClock = await log(gm);
  const clockEvent = withClock.events.find(
    (e) => e.type === 'clock.advanced' && e.payload['to'] === nextDay,
  );
  checks.eq('the GM advances the in-game clock', nextDay, patched.ingameDate);
  checks.record(
    '…and the log carries the clock tick as table-visible history (§11)',
    'a clock.advanced event naming the new date',
    clockEvent ? `event ${clockEvent.id}` : 'missing',
    clockEvent !== undefined,
  );

  story.say(
    `${phone.api.who} rolls ${roll.request.pool} dice against the noise off the water and the card lands on ` +
      `every screen at once — ${roll.hits} hits, the same event id on the socket and in the log the GM reloads. ` +
      'The line about the north cleat lands under it, and the date on the header rolls over to ' +
      `${nextDay}. Nothing here is a live-only flourish: close the page, open it again, and the whole beat ` +
      'is still there, because the log IS the record.',
  );
}

/** `YYYY-MM-DD` + one day, without pulling in a date library. */
function advance(date: string): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return '2076-06-13';
  parsed.setUTCDate(parsed.getUTCDate() + 1);
  return parsed.toISOString().slice(0, 10);
}
