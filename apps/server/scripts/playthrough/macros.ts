/**
 * Beat one, third half — personal macros that follow the *person* (FR2.8).
 *
 * The rack used to live in the browser's `localStorage`, which made it a
 * property of the handset rather than of the runner holding it: a borrowed
 * phone opened empty, and clearing site data between sessions wiped the buttons
 * a player had built over a campaign. The fix is that a device token resolves
 * to a **user**, so the rack is keyed on that.
 *
 * Which is only worth anything if it is true across devices, so that is what
 * this beat proves, on the one identity in the campaign that can genuinely hold
 * two device tokens: the GM, whose laptop mints a second device for the phone
 * in her pocket (`POST /api/campaigns/:id/gm-device`, FR1.1). Same user, a
 * different token, a different socket — and the same rack.
 *
 * The other half is the negative: a macro is *personal* data, not campaign
 * data. Torque's rack is invisible to Sparrow and to the GM alike, and the GM's
 * privilege buys her nothing here (Principle 4 applied to the least important
 * table in the app, which is exactly where it is easiest to get wrong).
 */
import type { Api } from './harness.js';
import type { World } from './setup.js';
import type { Ctx, Phone, RollRecord } from './types.js';

interface Macro {
  id: string;
  name: string;
  label: string;
  pool: number;
  limitKind?: string;
  limitValue?: number;
  visibility: string;
  sortOrder: number;
}

interface Rack {
  campaignId: string;
  macros: Macro[];
}

interface GmDevice {
  token: string;
  deviceId: string;
  user: { id: string };
}

export async function macros(
  ctx: Ctx,
  world: World,
  gm: Api,
  phones: Record<string, Phone>,
): Promise<void> {
  const { checks, story } = ctx;
  const cid = world.campaignId;
  checks.beat('1c · Personal macros (FR2.8)');

  const torque = phones['Torque']!;
  const sparrow = phones['Sparrow']!;

  // --- the rack a player builds on her own phone ---------------------------
  const empty = await torque.api.get<Rack>(`/api/campaigns/${cid}/macros`);
  checks.eq('a runner opens the session with an empty rack', 0, empty.macros.length);

  const suppressive = await torque.api.post<{ macro: Macro }>(`/api/campaigns/${cid}/macros`, {
    name: 'Suppressive fire — Hammer',
    pool: 11,
    limitKind: 'accuracy',
    limitValue: 5,
    visibility: 'public',
  });
  await torque.api.post(`/api/campaigns/${cid}/macros`, {
    name: 'Cracking a maglock',
    pool: 9,
    visibility: 'gm_owner',
  });
  const torqueRack = await torque.api.get<Rack>(`/api/campaigns/${cid}/macros`);
  checks.eq('two buttons on it a moment later', 2, torqueRack.macros.length);
  checks.record(
    '…each one carrying its own pool, limit and visibility',
    'Suppressive fire at 11 dice, accuracy 5, public',
    `${suppressive.macro.name}: ${suppressive.macro.pool} dice, ${String(suppressive.macro.limitKind)} ${String(
      suppressive.macro.limitValue,
    )}, ${suppressive.macro.visibility}`,
    suppressive.macro.pool === 11 &&
      suppressive.macro.limitKind === 'accuracy' &&
      suppressive.macro.limitValue === 5 &&
      suppressive.macro.visibility === 'public',
  );

  // Pushing the same label again is the client's localStorage migration
  // replaying, not a second button (the unique index decides, not a read).
  const replayed = await torque.api.post<{ macro: Macro }>(`/api/campaigns/${cid}/macros`, {
    name: 'Suppressive fire — Hammer',
    pool: 11,
    limitKind: 'accuracy',
    limitValue: 5,
    visibility: 'public',
  });
  const afterReplay = await torque.api.get<Rack>(`/api/campaigns/${cid}/macros`);
  checks.record(
    'pushing the same rack twice converges instead of duplicating',
    'still two macros, same id',
    `${afterReplay.macros.length} macro(s), id ${replayed.macro.id === suppressive.macro.id ? 'unchanged' : 'CHANGED'}`,
    afterReplay.macros.length === 2 && replayed.macro.id === suppressive.macro.id,
  );

  // --- the same person, a second device token ------------------------------
  const gmMacro = await gm.post<{ macro: Macro }>(`/api/campaigns/${cid}/macros`, {
    name: 'Ganger perception — the whole shed',
    pool: 7,
    visibility: 'gm',
  });
  const pocket = await gm.post<GmDevice>(`/api/campaigns/${cid}/gm-device`, {
    label: "GM's phone (in a pocket)",
  });
  checks.record(
    'the GM pairs a second device to the same identity (FR1.1)',
    'a new device token bound to the same user',
    `device ${pocket.deviceId.slice(0, 8)}… user ${pocket.user.id === world.gmUserId ? 'unchanged' : 'DIFFERENT'}`,
    pocket.user.id === world.gmUserId && pocket.token.length >= 32 && pocket.token !== world.gmToken,
  );
  const secondDevice = gm.as(pocket.token, 'GM (phone)');
  const carried = await secondDevice.get<Rack>(`/api/campaigns/${cid}/macros`);
  checks.record(
    'the macro made on one device is there on the second one (FR2.8)',
    'the same macro, same id, same pool — a different token entirely',
    carried.macros.map((m) => `${m.name} @${m.pool}`).join(' · ') || 'empty rack',
    carried.macros.some((m) => m.id === gmMacro.macro.id && m.pool === 7),
  );

  // …and it is a working button on the borrowed device, not just a row.
  const fired = await secondDevice.post<{ roll: RollRecord }>('/api/rolls', {
    kind: 'simple',
    pool: carried.macros.find((m) => m.id === gmMacro.macro.id)?.pool ?? 0,
    breakdown: [{ label: 'macro — Ganger perception', value: 7, source: 'situational' }],
    visibility: 'gm',
    actor: { gm: true },
    meta: { macroId: gmMacro.macro.id },
  });
  checks.record(
    '…and firing it from there puts the macro’s own pool on the record',
    'the rolled dice equal the stored pool, the macro named in the receipt',
    `${fired.roll.request.pool} dice → ${fired.roll.faces.length} faces · ${fired.roll.request.breakdown
      .map((e) => e.label)
      .join(', ')}`,
    fired.roll.faces.length === fired.roll.request.pool &&
      fired.roll.request.breakdown.some((e) => e.label.includes('Ganger perception')),
  );

  // --- a rack is personal, and the GM is not an exception ------------------
  const gmSeesOwn = await gm.get<Rack>(`/api/campaigns/${cid}/macros`);
  checks.record(
    "the GM's own rack holds only the GM's macro",
    'one macro, and none of Torque’s',
    gmSeesOwn.macros.map((m) => m.name).join(', ') || 'empty',
    gmSeesOwn.macros.length === 1 && gmSeesOwn.macros[0]?.id === gmMacro.macro.id,
  );
  const sparrowRack = await sparrow.api.get<Rack>(`/api/campaigns/${cid}/macros`);
  checks.record(
    "…and another runner's phone cannot see Torque's either",
    'an empty rack for Sparrow',
    `${sparrowRack.macros.length} macro(s)`,
    sparrowRack.macros.length === 0,
  );
  const stolenId = await sparrow.api.status('PATCH', `/api/campaigns/${cid}/macros/${suppressive.macro.id}`, {
    pool: 99,
  });
  checks.eq("…and a guessed id from someone else's rack is a 404, not a read", 404, stolenId);

  story.say(
    'While the crate is still theoretical, Torque builds two buttons on her phone — *suppressive fire* at eleven ' +
      'dice under the pistol’s Accuracy, and a nine-dice maglock roll she only wants the GM to see. They are hers, ' +
      'not the handset’s: Sparrow, sitting next to her, has an empty rack, and a guessed id gets a flat 404.',
  );
  story.say(
    'The GM proves the other half by pairing the phone in her pocket as a second device on the same account. ' +
      'She never rebuilds the rack — it is simply there, and firing it from the phone rolls the same seven dice ' +
      'the laptop would have.',
  );
}
