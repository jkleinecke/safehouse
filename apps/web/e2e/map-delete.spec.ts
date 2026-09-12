/**
 * Delete removes what is selected on the map — one key, no "sure?", and
 * Ctrl+Z puts it back (docs/UX_MAP_BUILDER.md §3.3, §3.6).
 *
 * The GM's words: "To delete something on the map, I should be able to select
 * it and hit the delete key. Don't bother asking if I'm sure, it's easy to fix
 * and the undo stack is better." So the spec is exactly that sentence: pick a
 * wall from the Layout list, press Delete, and check the server's own
 * geometry — a row that vanished from a list is not a deletion until the
 * scene no longer holds the wall. Then Ctrl+Z, and the server holds it again.
 *
 * The inspector's own delete is one click for the same reason; the spec reads
 * its label to make sure the second "— sure?" click never came back.
 */
import { Api } from './fixtures/api';
import { expect, signInWithToken, test } from './fixtures/test';
import { readWorld } from './fixtures/world';

const WALL_ID = 'e2e-delete-wall';

interface Wall {
  id: string;
  a: { x: number; y: number };
  b: { x: number; y: number };
}
interface Geometry {
  walls: Wall[];
  [k: string]: unknown;
}

async function geometryOf(api: Api, sceneId: string, token: string): Promise<Geometry> {
  return (await api.get<{ scene: { geometry: Geometry } }>(`/api/scenes/${sceneId}`, token)).scene.geometry;
}

test.describe('Delete on the map', () => {
  test.afterAll(async () => {
    // The shared world: what this file adds it takes away again.
    const world = readWorld();
    const api = new Api(world.baseUrl);
    const geometry = await geometryOf(api, world.sceneId, world.gm.token);
    await api.request('PATCH', `/api/scenes/${world.sceneId}`, {
      token: world.gm.token,
      body: { geometry: { ...geometry, walls: geometry.walls.filter((w) => w.id !== WALL_ID) } },
    });
  });

  test('select a wall, press Delete, it is gone from the scene; Ctrl+Z brings it back', async ({ page, world, api }) => {
    const gm = world.gm.token;
    const before = await geometryOf(api, world.sceneId, gm);
    await api.request('PATCH', `/api/scenes/${world.sceneId}`, {
      token: gm,
      body: { geometry: { ...before, walls: [...before.walls, { id: WALL_ID, a: { x: 2, y: 2 }, b: { x: 6, y: 2 } }] } },
    });
    expect((await geometryOf(api, world.sceneId, gm)).walls.some((w) => w.id === WALL_ID), 'the wall was staged').toBe(true);

    await signInWithToken(page, world.gm);
    await page.goto(`/c/${world.campaignId}/grid`);
    await page.getByTestId('mode-switch').getByRole('button', { name: 'Build' }).click();
    await page.getByRole('tab', { name: 'Layout' }).click();

    const row = page.getByTestId('wall-list').locator(`[data-row="${WALL_ID}"]`);
    await expect(row).toBeVisible();
    await row.click();
    await expect(row).toHaveAttribute('aria-pressed', 'true');
    // The inspector opens on it, and its delete is one click — no "sure?".
    await expect(page.getByTestId('inspector')).toBeVisible();
    await expect(page.getByTestId('inspector-delete')).toHaveText('delete');

    await page.keyboard.press('Delete');
    await expect(row).toHaveCount(0);
    await expect
      .poll(async () => (await geometryOf(api, world.sceneId, gm)).walls.some((w) => w.id === WALL_ID), {
        message: 'the wall must leave the server, not just the list',
      })
      .toBe(false);

    // Undo is the safety net the confirmation used to be.
    await page.keyboard.press('Control+z');
    await expect(row).toBeVisible();
    await expect
      .poll(async () => (await geometryOf(api, world.sceneId, gm)).walls.some((w) => w.id === WALL_ID), {
        message: 'Ctrl+Z must put the wall back on the server',
      })
      .toBe(true);
  });
});
