/**
 * `pnpm seed:demo` on a data directory that already holds the demo (FR1.1).
 *
 * The seed's header promises idempotency — every run deletes the campaign
 * named "Static on the Line" and reseeds — and until now nothing checked it:
 * the script ran on import, so no test could call it twice. It is importable
 * now, and this suite seeds one database twice, the way a GM re-runs the demo
 * after a session, and reads back one campaign, not two, with its own scene,
 * runners and opposition intact.
 *
 * It also pins the failure report: a database error surfaces with its cause,
 * and a missing relation file is named for what it is — a damaged directory —
 * rather than left as "Failed query".
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { campaigns, characters, scenes, tokens } from '@safehouse/db';
import { CAMPAIGN_NAME, describeFailure, seed, wipe } from '../seed/demo.js';
import { makeTestApp, type TestApp } from './core-helpers.js';

let t: TestApp;
let firstId: string;
let secondId: string;

async function demoCampaigns(): Promise<string[]> {
  const rows = await t.db.select({ id: campaigns.id }).from(campaigns).where(eq(campaigns.name, CAMPAIGN_NAME));
  return rows.map((r) => r.id);
}

beforeAll(async () => {
  t = await makeTestApp('seed-demo-twice');
  await seed(t.app);
  firstId = (await demoCampaigns())[0]!;
  await seed(t.app);
  secondId = (await demoCampaigns())[0]!;
}, 300_000);

afterAll(async () => {
  await t.close();
});

describe('seeding twice into one data directory', () => {
  it('leaves exactly one demo campaign, and it is the new one', async () => {
    expect(await demoCampaigns()).toHaveLength(1);
    expect(firstId).toBeDefined();
    expect(secondId).toBeDefined();
    expect(secondId).not.toBe(firstId);
  });

  it('the old campaign and everything hanging off it are gone', async () => {
    expect(await t.db.select().from(scenes).where(eq(scenes.campaignId, firstId))).toHaveLength(0);
    expect(await t.db.select().from(characters).where(eq(characters.campaignId, firstId))).toHaveLength(0);
  });

  it('the new campaign is whole: its scene, its runners, its tokens', async () => {
    const sceneRows = await t.db.select().from(scenes).where(eq(scenes.campaignId, secondId));
    expect(sceneRows.length).toBeGreaterThan(0);
    const runners = await t.db.select().from(characters).where(eq(characters.campaignId, secondId));
    expect(runners.length).toBeGreaterThanOrEqual(3);
    const placed = await t.db.select().from(tokens).where(eq(tokens.sceneId, sceneRows[0]!.id));
    expect(placed.length).toBeGreaterThan(0);
  });

  it('a third wipe removes the one campaign; a fourth finds nothing to do', async () => {
    expect(await wipe(t.db)).toBe(1);
    expect(await demoCampaigns()).toHaveLength(0);
    expect(await wipe(t.db)).toBe(0);
  });
});

describe('describeFailure', () => {
  it('prints the cause chain under the message', () => {
    const err = new Error('wiping the previous campaign failed', {
      cause: new Error('Failed query: delete from "campaigns"', { cause: new Error('update or delete violates foreign key') }),
    });
    expect(describeFailure(err)).toBe(
      'wiping the previous campaign failed\n  because: Failed query: delete from "campaigns"\n  because: update or delete violates foreign key',
    );
  });

  it('names a missing relation file as a damaged data directory', () => {
    const err = new Error('Failed query: delete from "campaigns"', {
      cause: new Error('could not open file "base/5/6104": No such file or directory'),
    });
    const text = describeFailure(err);
    expect(text).toContain('could not open file');
    expect(text).toMatch(/damaged/);
    expect(text).toMatch(/fresh directory/);
    expect(describeFailure(new Error('plain'))).toBe('plain');
  });
});
