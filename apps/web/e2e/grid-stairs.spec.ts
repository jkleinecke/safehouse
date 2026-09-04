/**
 * FR9.22 — a runner takes the stairs.
 *
 * The unit tests know when the offer should appear; this is the part they
 * cannot see. Taking the stairs is THREE things that have to agree: the button
 * knows the token is on a flight, the server writes the new floor, and the view
 * follows so the runner is still on screen afterwards. Any one of them working
 * alone looks like success and is not:
 *
 *   - The route accepted `level` while the write dropped it from its column
 *     whitelist, so the request came back 200 with the OLD floor in it. Nothing
 *     on screen said no; the token simply stayed put.
 *   - The canvas draws one storey at a time, so a token whose level changes
 *     without the view changing VANISHES. "It worked" and "I deleted the
 *     runner" look identical from the GM's chair.
 *
 * So the assertions are the server's own record of the floor, and the button
 * flipping to point back down — which can only happen if the offer is now being
 * computed on the catwalk.
 */
import { Api } from './fixtures/api';
import { expect, signInWithToken, test } from './fixtures/test';
import { readWorld } from './fixtures/world';

interface TokenDto {
  id: string;
  name: string;
  level: number;
}

/**
 * Every spec here shares one live campaign, so what this file adds it takes
 * away again — a stairwell left painted on the demo scene is a surprise for
 * whichever spec runs next, not a finding.
 */
const props: string[] = [];

test.describe('FR9.22 · stairs', () => {
  test.afterAll(async () => {
    // Fixtures are test-scoped, so the teardown reads the world itself.
    const world = readWorld();
    const api = new Api(world.baseUrl);
    for (const id of props) {
      await api.request('DELETE', `/api/tokens/${id}`, {
        token: world.gm.token,
        allowStatus: [404],
      });
    }
    // Wiping the levels takes the catwalk's tiles with it; the ground floor
    // has to be cleared on its own.
    await api.post(
      `/api/scenes/${world.sceneId}/tiles`,
      { tilesetId: 'docklands', level: 0, paint: {}, clear: true },
      world.gm.token,
    );
    await api.request('PUT', `/api/scenes/${world.sceneId}/levels`, {
      token: world.gm.token,
      body: { levels: [] },
    });
  });

  test('walks a token up to the catwalk and back down', async ({ page, world, api }) => {
    const gm = world.gm.token;
    const scene = world.sceneId;

    // A two-storey scene with one stairwell: up on the ground floor, down on
    // the catwalk, both in the same square — that shared footprint is what
    // makes it a stairwell rather than two unrelated flights.
    await api.request('PUT', `/api/scenes/${scene}/levels`, {
      token: gm,
      body: { levels: [{ id: 'catwalk', name: 'Catwalk' }] },
    });
    await api.post(
      `/api/scenes/${scene}/tiles`,
      { tilesetId: 'docklands', level: 0, paint: { '6,4': 'stairup' } },
      gm,
    );
    await api.post(
      `/api/scenes/${scene}/tiles`,
      { tilesetId: 'docklands', level: 1, paint: { '6,4': 'stairdown' } },
      gm,
    );

    // Tokens sit on cell centres, so 6.5/4.5 is the square 6,4.
    const placed = await api.post<{ token: TokenDto }>(
      `/api/scenes/${scene}/tokens`,
      { source: 'prop', name: 'Stairwalker', x: 6.5, y: 4.5, level: 0, hidden: false },
      gm,
    );
    const tokenId = placed.token.id;
    props.push(tokenId);
    expect(placed.token.level).toBe(0);

    const floorOf = async (): Promise<number> => {
      const body = await api.get<{ tokens: TokenDto[] }>(`/api/scenes/${scene}`, gm);
      const found = body.tokens.find((t) => t.id === tokenId);
      if (!found) throw new Error('the token left the scene entirely');
      return found.level;
    };

    await signInWithToken(page, world.gm);
    await page.goto(`/c/${world.campaignId}/grid`);

    // Selecting from the roster rather than the canvas: the offer is about
    // which token is selected, not about how the GM selected it.
    await page.getByRole('tab', { name: 'Tokens' }).click();
    await page.getByRole('button', { name: 'Stairwalker', exact: true }).click();

    const stairs = page.getByTestId('take-stairs');
    await expect(stairs).toHaveText(/takes the stairs up to Catwalk/);

    await stairs.click();

    // The server's own record, not the button's optimism.
    await expect.poll(floorOf, { timeout: 10_000 }).toBe(1);

    // And the offer has turned around, which it can only do if the app is now
    // reading the catwalk's tiles — i.e. the view came upstairs too.
    await expect(stairs).toHaveText(/takes the stairs down to Ground/);

    await stairs.click();
    await expect.poll(floorOf, { timeout: 10_000 }).toBe(0);
    await expect(stairs).toHaveText(/takes the stairs up to Catwalk/);
  });

  test('offers nothing for a flight that leads nowhere', async ({ page, world, api }) => {
    // A GM sketching a stairwell before building the storey above is ordinary.
    // A button that walks a runner off the top of the building is not.
    const gm = world.gm.token;
    const scene = world.sceneId;

    await api.request('PUT', `/api/scenes/${scene}/levels`, { token: gm, body: { levels: [] } });
    await api.post(
      `/api/scenes/${scene}/tiles`,
      { tilesetId: 'docklands', level: 0, paint: { '7,4': 'stairup' } },
      gm,
    );
    const stranded = await api.post<{ token: TokenDto }>(
      `/api/scenes/${scene}/tokens`,
      { source: 'prop', name: 'Nowhereman', x: 7.5, y: 4.5, level: 0, hidden: false },
      gm,
    );
    props.push(stranded.token.id);

    await signInWithToken(page, world.gm);
    await page.goto(`/c/${world.campaignId}/grid`);
    await page.getByRole('tab', { name: 'Tokens' }).click();
    await page.getByRole('button', { name: 'Nowhereman', exact: true }).click();

    await expect(page.getByTestId('take-stairs')).toHaveCount(0);
  });
});
