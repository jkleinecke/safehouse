/**
 * The Architect — one brief becomes an outline; the ticked items become
 * drafts and a staged scene — and every AI request can be stopped from the
 * screen it was asked from.
 *
 * Three claims, in the order the GM meets them:
 *
 *  1. **An outline writes nothing.** Rough it out, and the drafts inbox and the
 *     scene list are exactly what they were. Checked against the server, because
 *     "the screen shows a checklist" and "nothing was written" are different
 *     facts and only the second is Principle 8.
 *  2. **Build lands each item where the app already keeps that kind of thing:**
 *     pages and NPCs as drafts the GM accepts or bins, the scene staged (never
 *     active) with its floor painted. The screen names each one and links to
 *     where it went.
 *  3. **Cancel is real.** With the box stalling, the activity bar says what is
 *     running, its cancel stops it, and the screen says so — nothing half-built
 *     is claimed.
 *
 * This spec runs against its own stack (`fixtures/ai-stack.ts`) for the reason
 * `recap.spec.ts` does: the shared world keeps the Fixer off (NG7), and the
 * model here is scripted — it decides nothing; the floor squares come from the
 * server's own compiler, the NPC's numbers from the generator.
 */
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures/test';
import { bootAiStack, type AiStack } from './fixtures/ai-stack';

/** Its own server; the shared world owns SAFEHOUSE_E2E_PORT, the recap spec +1. */
const PORT = Number(process.env.SAFEHOUSE_E2E_PORT ?? 8791) + 2;

const BRIEF =
  'A dockside smuggling ring is moving something the corps want back. Three sessions: the hire, the tail, the exchange that goes wrong.';

const OUTLINE = {
  title: 'Rust on the Water',
  premise: 'A dockside smuggling ring is moving something the corps want back, and the runners are hired from both sides.',
  lore: [
    { title: 'Pier 23', kind: 'location', summary: 'A container pier run by a crew that answers to nobody on paper.' },
    { title: 'The Rusted Halo', kind: 'faction', summary: 'The smugglers: six boats, one warehouse, a lot of debt.' },
  ],
  npcs: [
    {
      name: 'Marisol Kane',
      role: 'dock foreman and fixer',
      persona: { traits: ['unhurried'], voice: 'low, dry, never raises it', goals: ['keep the pier hers'], secrets: ['owes the Halo'] },
    },
  ],
  scenes: [
    {
      name: 'Warehouse 9',
      purpose: 'The exchange goes wrong here.',
      floor: 'One big warehouse floor with crates, a small office in the corner, a loading door on the south wall.',
      cols: 24,
      rows: 16,
      tileset: 'docklands',
    },
  ],
};

const PLAN = {
  title: 'Warehouse 9',
  rooms: [
    { name: 'warehouse floor', kind: 'room', x: 1, y: 1, w: 16, h: 12, props: [{ tile: 'crates', x: 4, y: 4 }] },
    { name: 'office', kind: 'room', x: 16, y: 1, w: 6, h: 5 },
  ],
  openings: [
    { room: 'warehouse floor', wall: 's', offset: 6, width: 3, kind: 'door' },
    { room: 'office', wall: 'w', offset: 2, kind: 'door' },
  ],
  stairs: [],
  notes: '',
};

let stack: AiStack;
/** How long the box stalls before answering — 0 for the build, long for the cancel. */
let stallMs = 0;

interface DraftDto {
  id: string;
  kind: string;
  status: string;
  output?: Record<string, unknown>;
}
interface SceneDto {
  id: string;
  name: string;
  state: string;
  tiles?: { tilesetId: string; ground: Record<string, string>; structure: Record<string, string> };
}

async function drafts(): Promise<DraftDto[]> {
  const res = await stack.api.get<{ generations: DraftDto[] }>(`/api/campaigns/${stack.campaignId}/generations?status=draft`, stack.gmToken);
  return res.generations ?? [];
}
async function scenes(): Promise<SceneDto[]> {
  const res = await stack.api.get<{ scenes: SceneDto[] }>(`/api/campaigns/${stack.campaignId}/scenes`, stack.gmToken);
  return res.scenes ?? [];
}

/** Sign this browser in against the AI stack, which the fixture does not know. */
async function signIn(page: Page): Promise<void> {
  await page.goto(`${stack.baseUrl}/`);
  await page.getByRole('tab', { name: 'Paste a token' }).click();
  await page.locator('#signin-panel-token textarea').fill(JSON.stringify({ token: stack.gmToken, role: 'gm', campaignId: stack.campaignId }));
  await page.getByRole('button', { name: 'use this token' }).click();
  await page.waitForURL(`**/c/${stack.campaignId}/gm`);
}

async function roughItOut(page: Page): Promise<void> {
  await page.goto(`${stack.baseUrl}/c/${stack.campaignId}/gm/architect`);
  await expect(page.getByTestId('architect-offline'), 'the AI stack booted without a model').toHaveCount(0);
  await page.getByLabel('The brief').fill(BRIEF);
  await page.getByTestId('architect-outline').click();
  await expect(page.getByTestId('architect-plan')).toBeVisible({ timeout: 30_000 });
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  test.setTimeout(180_000);
  stack = await bootAiStack(PORT);
  stack.llm.respondWith((req) => {
    const text = req.messages.map((m) => (typeof m.content === 'string' ? m.content : '')).join('\n');
    const turn = (content: string) => (stallMs > 0 ? { content, delayMs: stallMs } : { content });
    if (text.includes('campaign architect')) return turn(`<think>plan</think>\n${JSON.stringify(OUTLINE)}`);
    if (text.includes('lay out one floor')) return turn(JSON.stringify(PLAN));
    if (text.includes('codex pages')) return turn('# Pier 23\n\nA container pier that answers to nobody on paper.\n\n- Six cranes\n- One office');
    return turn('The mock box has nothing to say to that.');
  });
});

test.afterAll(async () => {
  await stack?.stop();
});

test.describe('the Architect', () => {
  test('an outline writes nothing; a build lands drafts and a staged, painted scene', async ({ page }) => {
    test.setTimeout(120_000);
    const draftsBefore = (await drafts()).length;
    const scenesBefore = (await scenes()).map((s) => s.id);

    await signIn(page);
    await roughItOut(page);

    // --- 1. the outline, and nothing written --------------------------------
    await expect(page.getByTestId('architect-plan')).toContainText('Rust on the Water');
    await expect(page.getByTestId('architect-lore')).toContainText('2 of 2');
    await expect(page.getByTestId('architect-npcs')).toContainText('Marisol Kane');
    await expect(page.getByTestId('architect-scenes')).toContainText('24×16');
    await expect(page.getByTestId('architect-build')).toHaveText('build 4 items');
    expect((await drafts()).length, 'an outline must not write a draft').toBe(draftsBefore);
    expect((await scenes()).length, 'an outline must not stage a scene').toBe(scenesBefore.length);

    // Untick one page: the tally follows, and only the ticked items are built.
    await page.getByTestId('architect-tick-lore-1').uncheck();
    await expect(page.getByTestId('architect-build')).toHaveText('build 3 items');

    // --- 2. the build, item by item -----------------------------------------
    await page.getByTestId('architect-build').click();
    await expect(page.getByTestId('architect-result')).toBeVisible({ timeout: 60_000 });
    const result = page.getByTestId('architect-result');
    await expect(result).toContainText('3 of 3 ok');
    await expect(page.getByTestId('architect-landed-lore-0')).toContainText('in the drafts inbox');
    await expect(page.getByTestId('architect-landed-npc-0')).toContainText('rolled from');
    await expect(page.getByTestId('architect-landed-scene-0')).toContainText('staged as a scene');
    await expect(page.getByTestId('architect-to-drafts')).toHaveAttribute('href', `/c/${stack.campaignId}/gm/fixer`);
    await expect(page.getByTestId('architect-to-scenes')).toHaveAttribute('href', `/c/${stack.campaignId}/gm/scenes`);

    // --- what the server actually holds ------------------------------------
    const after = await drafts();
    expect(after.length).toBe(draftsBefore + 2);
    const page23 = after.find((d) => d.kind === 'wiki_page' && d.output?.['title'] === 'Pier 23');
    expect(page23?.status).toBe('draft');
    expect(String(page23?.output?.['contentMd'])).toContain('# Pier 23');
    const kane = after.find((d) => d.kind === 'npc' && d.output?.['name'] === 'Marisol Kane');
    expect(kane?.status).toBe('draft');
    expect(kane?.output?.['statblock'], 'the NPC draft carries a rolled statblock').toBeTruthy();
    expect((kane?.output?.['persona'] as { voice?: string }).voice).toBe('low, dry, never raises it');

    const staged = (await scenes()).find((s) => !scenesBefore.includes(s.id));
    expect(staged?.name).toBe('Warehouse 9');
    expect(staged?.state, 'the Architect never activates a scene').not.toBe('active');
    const full = await stack.api.get<{ scene: SceneDto }>(`/api/scenes/${staged!.id}`, stack.gmToken);
    expect(full.scene.tiles?.tilesetId).toBe('docklands');
    expect(Object.keys(full.scene.tiles?.ground ?? {}).length, 'the floor was painted').toBeGreaterThan(50);

    // The drafts inbox shows both, as the drafts the Fixer's own tools make.
    await page.getByTestId('architect-to-drafts').click();
    await expect(page.getByText('Pier 23').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Marisol Kane').first()).toBeVisible();
  });

  test('cancel stops a build from the activity bar, and the screen says what did not happen', async ({ page }) => {
    test.setTimeout(120_000);
    const draftsBefore = (await drafts()).length;
    await signIn(page);
    await roughItOut(page);

    stallMs = 20_000;
    try {
      await page.getByTestId('architect-build').click();
      // The bar on every GM screen: what is running, whose work, a cancel.
      const bar = page.getByTestId('ai-activity');
      await expect(bar).toBeVisible({ timeout: 10_000 });
      await expect(bar).toHaveAttribute('data-kind', 'architect');
      await expect(bar).toContainText('working');
      await expect(page.getByTestId('architect-progress')).toContainText('writing', { timeout: 10_000 });

      await page.getByTestId('ai-cancel').click();
      await expect(page.getByTestId('architect-result')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId('architect-result')).toContainText('stopped');
      await expect(page.getByTestId('architect-result')).toContainText('Nothing');
      await expect(bar).toHaveCount(0, { timeout: 10_000 });
      expect((await drafts()).length, 'a cancelled build claims nothing it did not finish').toBe(draftsBefore);
    } finally {
      stallMs = 0;
    }
  });
});
