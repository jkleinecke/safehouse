/**
 * Delete removes what is selected on the map — one key, no "sure?", and
 * Ctrl+Z puts it back (docs/UX_MAP_BUILDER.md §3.3, §3.6).
 *
 * The GM's words: "To delete something on the map, I should be able to select
 * it and hit the delete key. Don't bother asking if I'm sure, it's easy to fix
 * and the undo stack is better." So the spec is exactly that sentence: pick a
 * wall, press Delete, and check the server's own geometry — a wall that
 * vanished from the canvas is not a deletion until the scene no longer holds
 * it. Then Ctrl+Z, and the server holds it again.
 *
 * The wall is picked by clicking it on the canvas. It used to be picked from
 * the Layout tab's list, which went when that tab did (2026-09-19) — the list
 * only opened the same inspector a click on the thing opens. So the wall this
 * spec stages is laid across the MIDDLE of the scene, and the spec fits the
 * scene before clicking its centre: after a fit the scene's centre is the
 * canvas's centre, whatever the viewport.
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
interface Grid {
  cols: number;
  rows: number;
}

async function sceneOf(
  api: Api,
  sceneId: string,
  token: string,
): Promise<{ geometry: Geometry; grid: Grid }> {
  return (await api.get<{ scene: { geometry: Geometry; grid: Grid } }>(`/api/scenes/${sceneId}`, token))
    .scene;
}

async function geometryOf(api: Api, sceneId: string, token: string): Promise<Geometry> {
  return (await sceneOf(api, sceneId, token)).geometry;
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
    const { geometry: before, grid } = await sceneOf(api, world.sceneId, gm);
    // Across the middle, so the fitted scene's centre lands on it.
    const midY = Math.round(grid.rows / 2);
    const quarter = Math.round(grid.cols / 4);
    await api.request('PATCH', `/api/scenes/${world.sceneId}`, {
      token: gm,
      body: {
        geometry: {
          ...before,
          walls: [
            ...before.walls,
            { id: WALL_ID, a: { x: quarter, y: midY }, b: { x: grid.cols - quarter, y: midY } },
          ],
        },
      },
    });
    expect((await geometryOf(api, world.sceneId, gm)).walls.some((w) => w.id === WALL_ID), 'the wall was staged').toBe(true);

    await signInWithToken(page, world.gm);
    await page.goto(`/c/${world.campaignId}/grid`);
    await page.getByTestId('mode-switch').getByRole('button', { name: 'Build' }).click();

    const canvas = page.locator('canvas').first();
    await expect(canvas).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: 'Fit', exact: true }).click();
    // Select, not a tile tool: a click with the brush in hand paints.
    await page.getByTestId('tool-select').click();

    const box = await canvas.boundingBox();
    if (!box) throw new Error('the Grid canvas has no box — the stage did not mount');
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

    // The inspector opens on it, and its delete is one click — no "sure?".
    const inspector = page.getByTestId('inspector');
    await expect(inspector).toBeVisible();
    await expect(inspector).toContainText('wall', { ignoreCase: true });
    await expect(page.getByTestId('inspector-delete')).toHaveAttribute('aria-label', 'Delete');

    await page.keyboard.press('Delete');
    await expect
      .poll(async () => (await geometryOf(api, world.sceneId, gm)).walls.some((w) => w.id === WALL_ID), {
        message: 'the wall must leave the server, not just the canvas',
      })
      .toBe(false);

    // Undo is the safety net the confirmation used to be.
    await page.keyboard.press('Control+z');
    await expect
      .poll(async () => (await geometryOf(api, world.sceneId, gm)).walls.some((w) => w.id === WALL_ID), {
        message: 'Ctrl+Z must put the wall back on the server',
      })
      .toBe(true);
  });
});
