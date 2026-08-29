/**
 * Beat eight — `docker compose restart`, and what is still there afterwards.
 *
 * Everything before this point ran in one process against one open database.
 * That is the state every harness constructs, and it is precisely the state in
 * which a per-process number is indistinguishable from a durable one. The Fixer
 * usage meter (FR12.15) was exactly that bug: `ai_generations.usage` only covers
 * turns that produced a draft, so the meter accumulated chat turns in a `Map`
 * and a GM who restarted the server after an afternoon of prep saw zero — which
 * is not a meter.
 *
 * So this beat stops the server, **closes PGlite** (single-process: reopening a
 * directory another handle still holds is how you end up serving a phantom
 * in-memory database), and boots the whole app again against the same
 * `DATA_DIR` — migrations, sequence guard and all. Then it asks the same
 * questions with the same GM device token.
 *
 * The meter is read in two halves on purpose:
 *
 *   `total`   — aggregated out of `ai_usage`, one row per completed turn. This
 *               is the number that must survive, and it is the assertion.
 *   `session` — the in-process live meter, deliberately scoped to "since this
 *               server started". It must read zero afterwards, because that is
 *               what it is *for*.
 *
 * The live meter is a module singleton, so an app restarted inside one Node
 * process would keep it; it is reset here explicitly, and labelled as the one
 * thing this beat simulates rather than performs.
 */
import { usageMeter } from '../../src/fixer/usage.js';
import { Api } from './harness.js';
import { restart, type World } from './setup.js';
import type { Ctx, Dict } from './types.js';

interface ModelUsage {
  calls: number;
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
}

interface UsageView {
  total: ModelUsage & { since: string | null; byKind: Record<string, number>; latencyMsAvg: number };
  session: ModelUsage;
  drafts: { pending: number };
  currency: string;
}

export interface AftermathInput {
  ctx: Ctx;
  world: World;
  sessionId: string;
  /** Aliases whose ledgers must read the same after the reboot. */
  aliases: readonly string[];
  characterIds: Record<string, string>;
}

export async function aftermath(input: AftermathInput): Promise<void> {
  const { ctx, world, sessionId } = input;
  const { checks, story } = ctx;
  const cid = world.campaignId;
  checks.beat('9 · Restart (FR12.15 and everything else on disk)');

  const before = new Api(world.baseUrl, world.gmToken, 'GM');
  const meterBefore = await before.get<UsageView>(`/api/campaigns/${cid}/fixer/usage`);
  checks.record(
    'the night’s Fixer turns are on the meter before the restart',
    'tokens counted, in both halves, reported as tokens+latency not money',
    `${meterBefore.total.calls} turn(s) / ${meterBefore.total.totalTokens} tokens durable · ` +
      `${meterBefore.session.calls} / ${meterBefore.session.totalTokens} this process · ${meterBefore.currency}`,
    meterBefore.total.calls > 0 &&
      meterBefore.total.totalTokens > 0 &&
      meterBefore.session.totalTokens > 0 &&
      meterBefore.currency === 'tokens+latency',
  );
  checks.record(
    '…split by what the tokens bought',
    'a `chat` bucket with a non-zero count',
    Object.entries(meterBefore.total.byKind).map(([k, v]) => `${k} ${v}`).join(', ') || 'none',
    (meterBefore.total.byKind['chat'] ?? 0) > 0,
  );

  const logBefore = await before.get<{ events: { id: number }[] }>(`/api/campaigns/${cid}/log?limit=1`);
  const lastEventId = logBefore.events[0]?.id ?? 0;
  const ledgerBefore: Record<string, number> = {};
  for (const alias of input.aliases) {
    const id = input.characterIds[alias]!;
    const view = await before.get<{ balances: { nuyen: number; karma: number } }>(
      `/api/characters/${id}/ledger`,
    );
    ledgerBefore[alias] = view.balances.nuyen;
  }
  const macrosBefore = await before.get<{ macros: { id: string }[] }>(`/api/campaigns/${cid}/macros`);
  const recapBefore = await before.get<{ session: { recapMd: string | null } }>(
    `/api/sessions/${sessionId}`,
  );

  // --- the restart ----------------------------------------------------------
  // The live half is a module singleton and would outlive an app rebuilt inside
  // one process; a real `docker compose restart` clears it, so we do.
  usageMeter.reset();
  await restart(world);
  const gm = new Api(world.baseUrl, world.gmToken, 'GM (after restart)');

  const reopened = await gm.raw('GET', `/api/campaigns/${cid}`);
  checks.record(
    'the server comes back on the same DATA_DIR and the old device token still works',
    '200, and the campaign it was seeded with',
    `${reopened.status} · ${(JSON.parse(reopened.body || '{}') as { name?: string }).name ?? '(none)'}`,
    reopened.status === 200 &&
      (JSON.parse(reopened.body || '{}') as { name?: string }).name === 'Static on the Line',
  );

  const meterAfter = await gm.get<UsageView>(`/api/campaigns/${cid}/fixer/usage`);
  checks.record(
    'the durable usage meter survived the restart (FR12.15)',
    `${meterBefore.total.calls} turns / ${meterBefore.total.totalTokens} tokens, unchanged`,
    `${meterAfter.total.calls} turns / ${meterAfter.total.totalTokens} tokens`,
    meterAfter.total.totalTokens === meterBefore.total.totalTokens &&
      meterAfter.total.calls === meterBefore.total.calls &&
      meterAfter.total.promptTokens === meterBefore.total.promptTokens &&
      meterAfter.total.completionTokens === meterBefore.total.completionTokens,
  );
  checks.record(
    '…and it can still say since when, so the number reads honestly',
    'the same first-counted timestamp',
    String(meterAfter.total.since),
    meterAfter.total.since !== null && meterAfter.total.since === meterBefore.total.since,
  );
  checks.record(
    '…while the per-process half reads zero, which is what it is for',
    '0 calls since this server started',
    `${meterAfter.session.calls} call(s) / ${meterAfter.session.totalTokens} tokens`,
    meterAfter.session.calls === 0 && meterAfter.session.totalTokens === 0,
  );
  // Same field name, two units — see the gap this beat files.
  checks.record(
    'the two halves agree about tokens, which is the number that matters',
    'identical token totals across the durable and live meters before the reboot',
    `${meterBefore.total.totalTokens} durable vs ${meterBefore.session.totalTokens} live ` +
      `(${meterBefore.total.calls} turns vs ${meterBefore.session.calls} model calls)`,
    meterBefore.total.totalTokens === meterBefore.session.totalTokens,
  );
  if (meterBefore.total.calls !== meterBefore.session.calls) {
    ctx.gaps.push(
      '**`fixer/usage.ts` reports two different things as `calls`.** In one payload ' +
        '`GET /api/campaigns/:id/fixer/usage` returns `total.calls` = completed Fixer *turns* ' +
        '(one `ai_usage` row per turn) and `session.calls` = individual *model requests* ' +
        `(one \`usageMeter.record\` per round of the agent loop) — this run: ${meterBefore.total.calls} ` +
        `vs ${meterBefore.session.calls} for the same ${meterBefore.total.totalTokens} tokens. The token ` +
        'counts agree, so nothing is lost, but a GM panel that renders both as "calls" beside each ' +
        'other is showing two units under one label.',
    );
  }

  // --- everything else that was supposed to be on disk ---------------------
  for (const alias of input.aliases) {
    const id = input.characterIds[alias]!;
    const view = await gm.get<{ balances: { nuyen: number } }>(`/api/characters/${id}/ledger`);
    checks.eq(`${alias}'s nuyen balance came back`, ledgerBefore[alias], view.balances.nuyen);
  }
  const macrosAfter = await gm.get<{ macros: { id: string }[] }>(`/api/campaigns/${cid}/macros`);
  checks.record(
    'the GM’s macro rack came back with it (FR2.8)',
    `${macrosBefore.macros.length} macro(s), same ids`,
    `${macrosAfter.macros.length} macro(s)`,
    macrosAfter.macros.length === macrosBefore.macros.length &&
      macrosBefore.macros.every((m) => macrosAfter.macros.some((n) => n.id === m.id)),
  );
  const recapAfter = await gm.get<{ session: { recapMd: string | null; state: string } }>(
    `/api/sessions/${sessionId}`,
  );
  checks.record(
    'the published recap is still on the session',
    'the same markdown, and the session still closed',
    `${(recapAfter.session.recapMd ?? '').length} chars · state ${recapAfter.session.state}`,
    recapAfter.session.recapMd === recapBefore.session.recapMd &&
      (recapAfter.session.recapMd ?? '').length > 0,
  );
  const magicAfter = await gm.get<{ spirits: { name: string; services: number }[]; reagents: Dict }>(
    `/api/campaigns/${cid}/magic`,
  );
  const ash = magicAfter.spirits.find((s) => s.name === 'Ash-of-Kettles');
  checks.record(
    'the spirit’s spent services and the reagent tin came back too (FR8.3/8.4)',
    'Ash-of-Kettles at 0 services, 4 drams on the shelf',
    `${ash?.services ?? '?'} service(s) · ${JSON.stringify(magicAfter.reagents)}`,
    ash?.services === 0 && Object.values(magicAfter.reagents).includes(4),
  );

  // The sequence guard runs on every open; the proof it worked is that the log
  // can still be appended to, with an id past everything already on disk.
  const posted = await gm.post<{ event: { id: number } }>(`/api/campaigns/${cid}/log`, {
    kind: 'gm-note',
    visibility: 'gm',
    text: 'Post-restart check: the log still takes new lines.',
  });
  checks.record(
    'and the event log takes the next id, not one already used',
    `an id above ${lastEventId}`,
    `event ${posted.event.id}`,
    posted.event.id > lastEventId,
  );

  story.beat('The morning after — the GM restarts the box');
  story.say(
    'The last thing the harness does is the thing every real deployment does: it stops the server, lets go of the ' +
      'database, and starts the whole stack again on the same directory.',
  );
  story.say(
    `Everything the table earned is still there — balances, the macro rack, the published recap, Ash-of-Kettles ` +
      `with nothing left to give — and the Fixer's meter still reads ${meterAfter.total.totalTokens.toLocaleString(
        'en-US',
      )} tokens across ${meterAfter.total.calls} turns, because it counts rows on disk rather than a number in a ` +
      'process. The "since this server started" half reads zero, which is the only honest thing it could say.',
  );
}
