/**
 * Token portraits (FR9.4): a player uploads their own, the GM uploads anyone's.
 *
 * The interesting half is not the upload, it is the three things around it that
 * each look fine on their own and are wrong together:
 *
 *  - WHO. `POST /api/attachments` is GM-only and stays that way. This route is
 *    character-scoped and guarded by `assertCanEdit` — owner or GM — so a
 *    player can dress their own runner and nobody else's.
 *  - WHO CAN SEE IT. An attachment defaults to GM visibility, and a portrait
 *    stored that way renders for the GM and 404s for every player and the TV,
 *    with the canvas swallowing the failure. A token portrait is by definition
 *    something the whole table looks at.
 *  - WHAT IS ALREADY ON THE MAP. Tokens snapshot `portraitId` into `artRef`
 *    when they are placed, so without a fan-out an upload mid-session changes
 *    nothing that is already standing there.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  bootstrapCampaign,
  joinAs,
  makeTestApp,
  type BootstrapResult,
  type JoinResult,
  type TestApp,
} from './core-helpers.js';

const BOUNDARY = '----safehousePortraitTest';

/** A real PNG signature — the store checks bytes against the declared mime. */
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const png = (body: string) => Buffer.concat([PNG_MAGIC, Buffer.from(body)]);

function multipart(bytes: Buffer, mime: string): Buffer {
  return Buffer.concat([
    Buffer.from(
      `--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="p.png"\r\n` +
        `Content-Type: ${mime}\r\n\r\n`,
    ),
    bytes,
    Buffer.from(`\r\n--${BOUNDARY}--\r\n`),
  ]);
}

describe('character portraits', () => {
  let t: TestApp;
  let boot: BootstrapResult;
  let player: JoinResult;
  let other: JoinResult;
  let characterId: string;
  let sceneId: string;
  let tokenId: string;

  const as = (token: string, extra: Record<string, string> = {}) => ({
    authorization: `Bearer ${token}`,
    ...extra,
  });
  const form = (token: string) =>
    as(token, { 'content-type': `multipart/form-data; boundary=${BOUNDARY}` });

  const upload = (token: string, id: string, bytes = png('face'), mime = 'image/png') =>
    t.app.inject({
      method: 'POST',
      url: `/api/characters/${id}/portrait`,
      headers: form(token),
      payload: multipart(bytes, mime),
    });

  beforeAll(async () => {
    t = await makeTestApp('portrait');
    boot = await bootstrapCampaign(t.app, 'Portrait table');
    player = await joinAs(t.app, boot.campaignId, boot.gmToken, 'player', 'Torque');
    other = await joinAs(t.app, boot.campaignId, boot.gmToken, 'player', 'Bolt');

    // Created THROUGH the API, by the player, so the stored sheet is a real
    // one and the ownership is the real thing rather than a fixture's guess.
    const made = await t.app.inject({
      method: 'POST',
      url: '/api/characters',
      headers: as(player.token, { 'content-type': 'application/json' }),
      payload: { campaignId: boot.campaignId, name: 'Torque' },
    });
    if (made.statusCode !== 201) throw new Error(`character create: ${made.body.slice(0, 300)}`);
    characterId = (made.json() as { character: { id: string } }).character.id;

    const scene = await t.app.inject({
      method: 'POST',
      url: `/api/campaigns/${boot.campaignId}/scenes`,
      headers: as(boot.gmToken, { 'content-type': 'application/json' }),
      payload: { name: 'Alley' },
    });
    sceneId = (scene.json() as { scene: { id: string } }).scene.id;

    const placed = await t.app.inject({
      method: 'POST',
      url: `/api/scenes/${sceneId}/tokens`,
      headers: as(boot.gmToken, { 'content-type': 'application/json' }),
      payload: { source: 'character', sourceId: characterId, x: 2.5, y: 2.5 },
    });
    tokenId = (placed.json() as { token: { id: string } }).token.id;
  }, 180_000);

  afterAll(async () => {
    await t.close();
  });

  const tokenArt = async (): Promise<string | null> => {
    const res = await t.app.inject({
      method: 'GET',
      url: `/api/scenes/${sceneId}`,
      headers: as(boot.gmToken),
    });
    const found = (res.json() as { tokens: { id: string; artRef: string | null }[] }).tokens.find(
      (x) => x.id === tokenId,
    );
    return found?.artRef ?? null;
  };

  it('lets the owning player dress their own runner', async () => {
    const res = await upload(player.token, characterId);
    expect(res.statusCode).toBe(201);
    const body = res.json() as { portraitId: string; tokens: number; attachment: { id: string } };
    expect(body.portraitId).toBe(body.attachment.id);
    // And it reached the token already standing on the map.
    expect(body.tokens).toBe(1);
    expect(await tokenArt()).toBe(body.portraitId);
  });

  it('serves that portrait to every player, not just the GM', async () => {
    // The failure this guards against is silent: a GM-visibility portrait 404s
    // for players and the canvas swallows it, so the token simply keeps its
    // silhouette and nothing anywhere says why.
    const id = await tokenArt();
    expect(id).not.toBeNull();
    for (const who of [boot.gmToken, player.token, other.token]) {
      const res = await t.app.inject({ method: 'GET', url: `/files/${id!}`, headers: as(who) });
      expect(res.statusCode).toBe(200);
      expect(res.headers['x-content-type-options']).toBe('nosniff');
    }
  });

  it('refuses a player dressing somebody else’s runner', async () => {
    const res = await upload(other.token, characterId);
    expect(res.statusCode).toBe(403);
  });

  it('lets the GM do it for them', async () => {
    const before = await tokenArt();
    const res = await upload(boot.gmToken, characterId);
    expect(res.statusCode).toBe(201);
    const after = await tokenArt();
    expect(after).not.toBe(before);
  });

  it('leaves a token the GM has deliberately re-dressed alone', async () => {
    // Per-token art is an override — a runner in a disguise keeps it when the
    // player changes the picture on their sheet.
    const disguise = await t.app.inject({
      method: 'POST',
      url: '/api/attachments',
      headers: form(boot.gmToken),
      payload: multipart(png('a-disguise'), 'image/png'),
    });
    expect(disguise.statusCode).toBe(201);
    const disguiseId = (disguise.json() as { attachment: { id: string } }).attachment.id;

    const dressed = await t.app.inject({
      method: 'PATCH',
      url: `/api/tokens/${tokenId}`,
      headers: as(boot.gmToken, { 'content-type': 'application/json' }),
      payload: { artRef: disguiseId },
    });
    expect(dressed.statusCode).toBe(200);

    const res = await upload(player.token, characterId);
    expect(res.statusCode).toBe(201);
    expect((res.json() as { tokens: number }).tokens).toBe(0);
    expect(await tokenArt()).toBe(disguiseId);
  });

  it('answers 400, not 500, for art that is not an attachment id', async () => {
    // `tokens.art_ref` is a uuid column, so a free-form string used to reach
    // the database and come back as an internal error.
    const res = await t.app.inject({
      method: 'PATCH',
      url: `/api/tokens/${tokenId}`,
      headers: as(boot.gmToken, { 'content-type': 'application/json' }),
      payload: { artRef: 'not-a-uuid' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects a file whose bytes are not the image it claims to be', async () => {
    // The client names the mime and the client can lie. This is what makes it
    // safe to let somebody other than the GM write into the file store.
    const res = await upload(player.token, characterId, Buffer.from('MZ this is not a png at all'));
    expect(res.statusCode).toBe(415);
  });

  it('rejects a type that is not an image at all', async () => {
    const res = await upload(player.token, characterId, Buffer.from('%PDF-1.4'), 'application/pdf');
    expect(res.statusCode).toBe(415);
  });

  it('clears the portrait, and the tokens wearing it, on delete', async () => {
    // Put the token back under the character's own art first.
    await t.app.inject({
      method: 'PATCH',
      url: `/api/tokens/${tokenId}`,
      headers: as(boot.gmToken, { 'content-type': 'application/json' }),
      payload: { artRef: null },
    });
    await upload(player.token, characterId);
    expect(await tokenArt()).not.toBeNull();

    const res = await t.app.inject({
      method: 'DELETE',
      url: `/api/characters/${characterId}/portrait`,
      headers: as(player.token),
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { portraitId: string | null }).portraitId).toBeNull();
    expect(await tokenArt()).toBeNull();
  });

  it('does not burn a sheet revision on a change of picture', async () => {
    // Revisions are FR3.8's rollback history for a character's BUILD. A new
    // photograph is not an edit to it, and filling that log with portraits
    // would bury the changes somebody might actually want to roll back.
    const revs = async () => {
      const res = await t.app.inject({
        method: 'GET',
        url: `/api/characters/${characterId}/revisions`,
        headers: as(boot.gmToken),
      });
      return (res.json() as { revisions: unknown[] }).revisions.length;
    };
    const before = await revs();
    await upload(player.token, characterId);
    expect(await revs()).toBe(before);
  });
});
