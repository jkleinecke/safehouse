/**
 * Beat one, second half — who is allowed to become what (FR1.1–1.4).
 *
 * Two things are proved here, and both were broken when this campaign was
 * driven through a real browser:
 *
 *  - **LIVE-3.** `/join/:code` used to be an API route *and* the SPA route, and
 *    the API won: scanning the QR handed a player raw JSON instead of the join
 *    screen. One path, one owner now — the QR encodes `/join/:code` (the web
 *    app's), the token comes from `/api/join/:code` (the server's), and a hit
 *    on the SPA path must not carry a token or burn the code.
 *  - **The GM had no way in.** `join-qr` and the invite route both exclude the
 *    `gm` role by construction, so a GM whose laptop was not the one that ran
 *    the bootstrap had to hand-write `localStorage`. `gm-pair` closes that with
 *    a short-lived, single-use code that binds the SAME GM identity — and an
 *    ordinary invite still cannot be talked into minting one.
 */
import type { Api } from './harness.js';
import type { World } from './setup.js';
import type { Ctx, Phone } from './types.js';

interface JoinInfo {
  code: string;
  role: string;
  url: string;
  dataUrl: string;
  expiresAt: string | null;
}

interface Joined {
  token: string;
  role: string;
  campaignId: string;
  user: { id: string; displayName: string };
}

export async function pairing(
  ctx: Ctx,
  world: World,
  gm: Api,
  anon: Api,
  phones: Record<string, Phone>,
): Promise<void> {
  const { checks, story } = ctx;
  const cid = world.campaignId;
  checks.beat('1b · Join paths and GM sign-in');

  // --- LIVE-3: the QR encodes the screen, not the endpoint ------------------
  const qr = await gm.get<JoinInfo>(`/api/campaigns/${cid}/join-qr?role=observer`);
  checks.record(
    'the QR encodes the SPA join screen, never the API endpoint (LIVE-3)',
    'a URL ending /join/<code>, with no /api/join/ in it',
    qr.url,
    qr.url.endsWith(`/join/${qr.code}`) && !qr.url.includes('/api/join/'),
  );
  checks.record(
    '…and it is a real scannable image',
    'a base64 PNG data URL',
    `${qr.dataUrl.slice(0, 22)}… (${qr.dataUrl.length} chars)`,
    qr.dataUrl.startsWith('data:image/png;base64,') && qr.dataUrl.length > 512,
  );

  // Scanning it hits the SPA path. With no web build in this process that is a
  // 404 — the point is what it is NOT: an API response with a token in it.
  const scanned = await anon.raw('GET', `/join/${qr.code}`);
  checks.record(
    'GET /join/:code is not an API route any more — no token in the response',
    'no "token" anywhere in the body',
    `${scanned.status} · ${scanned.body.slice(0, 60) || '(empty)'}`,
    !scanned.body.includes('token'),
  );
  const redeemed = await anon.get<Joined>(`/api/join/${qr.code}?name=Kiosk%20observer`);
  checks.record(
    '…and the scan did not burn the code: /api/join/:code still mints the device',
    'role observer, a long-lived token',
    `${redeemed.role} · ${redeemed.token.length}-char token`,
    redeemed.role === 'observer' && redeemed.token.length >= 32,
  );

  // --- an ordinary invite can never mint a GM (FR1.3) -----------------------
  const refused = await gm.raw('POST', `/api/campaigns/${cid}/invites`, { role: 'gm' });
  checks.record(
    'a player invite refuses to mint a GM device',
    '400 bad_request — `gm` is not in the invite role enum',
    `${refused.status} · ${refused.body.slice(0, 80)}`,
    refused.status === 400,
  );
  const playerTriedToPair = await phones['Torque']!.api.status('POST', `/api/campaigns/${cid}/gm-pair`, {});
  checks.eq('…and a player device cannot mint a pairing code either', 403, playerTriedToPair);

  // --- the GM pairing code (FR1.1/1.2) -------------------------------------
  const pair = await gm.post<JoinInfo>(`/api/campaigns/${cid}/gm-pair`, {});
  checks.eq('the GM mints a pairing code for a second laptop', 'gm', pair.role);
  const ttlMinutes = pair.expiresAt
    ? Math.round((new Date(pair.expiresAt).getTime() - Date.now()) / 60_000)
    : -1;
  checks.record(
    '…short-lived by construction',
    'expires inside the hour',
    `${ttlMinutes} minutes`,
    ttlMinutes > 0 && ttlMinutes <= 60,
  );
  checks.record(
    '…and it too points at the join screen',
    'a URL ending /join/<code>',
    pair.url,
    pair.url.endsWith(`/join/${pair.code}`) && !pair.url.includes('/api/join/'),
  );

  const paired = await anon.get<Joined>(`/api/join/${pair.code}?label=borrowed%20laptop`);
  checks.eq('redeeming it mints a gm device', 'gm', paired.role);
  checks.record(
    '…bound to the SAME GM identity, not a new user',
    world.gmUserId,
    paired.user.id,
    paired.user.id === world.gmUserId,
  );
  const secondLaptop = gm.as(paired.token, 'GM (2nd laptop)');
  const worksAsGm = await secondLaptop.status('POST', `/api/campaigns/${cid}/invites`, {
    role: 'observer',
  });
  checks.eq('…and the borrowed laptop really is the GM', 201, worksAsGm);
  const reused = await anon.raw('GET', `/api/join/${pair.code}`);
  checks.record(
    'a pairing code is single-use',
    '410 invite_exhausted on the second scan',
    `${reused.status} · ${reused.body.slice(0, 60)}`,
    reused.status === 410,
  );

  story.say(
    'The GM shows the code on her own screen. A borrowed laptop scans it and is *her* — same user, same ' +
      'campaign, a second device token — and the code dies on the way in, so the photo somebody took of it ' +
      'is worth nothing. The player codes cannot be talked into doing that: the invite route has no `gm` in ' +
      'its vocabulary at all.',
  );
  story.say(
    'And what the phones scan is the join *screen*. The endpoint that mints the token lives under `/api/`, ' +
      'where nobody points a camera — which is the whole of the fix for the night a player scanned the QR and ' +
      'got a wall of JSON.',
  );
}
