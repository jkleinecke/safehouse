/**
 * The Discord webhook — the ONLY outbound traffic in the whole system (§13):
 * recaps the GM explicitly publishes (FR6.3) and, when a campaign opts in,
 * public roll summaries (FR2.10). Nothing hidden ever goes out, and every post
 * is fire-and-forget so the table never waits on the network (NG7).
 */
import { eq } from 'drizzle-orm';
import { campaigns, type Db } from '@safehouse/db';

export interface OutboundLogger {
  warn: (obj: unknown, msg?: string) => void;
}

const SETTINGS_TTL_MS = 15_000;
const settingsCache = new Map<string, { at: number; settings: Record<string, unknown> }>();

/**
 * `campaigns.settings` with a short TTL — it is read on the roll path (FR1.5).
 * INTEGRATION: any plugin that WRITES campaign settings should call
 * `forgetCampaignSettings(campaignId)` afterwards; otherwise a flag change
 * takes up to 15s to take effect here.
 */
export async function campaignSettings(
  db: Db,
  campaignId: string,
): Promise<Record<string, unknown>> {
  const hit = settingsCache.get(campaignId);
  if (hit && Date.now() - hit.at < SETTINGS_TTL_MS) return hit.settings;
  const row = (
    await db
      .select({ settings: campaigns.settings })
      .from(campaigns)
      .where(eq(campaigns.id, campaignId))
      .limit(1)
  )[0];
  const settings = (row?.settings ?? {}) as Record<string, unknown>;
  settingsCache.set(campaignId, { at: Date.now(), settings });
  return settings;
}

/** Drop the cached settings for a campaign (call after writing them). */
export function forgetCampaignSettings(campaignId: string): void {
  settingsCache.delete(campaignId);
}

/** The campaign's webhook (FR1.5), falling back to `DISCORD_WEBHOOK_URL`. */
export async function discordWebhookUrl(db: Db, campaignId: string): Promise<string | null> {
  const settings = await campaignSettings(db, campaignId);
  const own = settings['discordWebhookUrl'];
  if (typeof own === 'string' && own.length > 0) return own;
  const env = process.env.DISCORD_WEBHOOK_URL;
  return env && env.length > 0 ? env : null;
}

/**
 * Fire-and-forget webhook post: never awaited, never throws into a request.
 * With no network (or no webhook configured) the table plays on regardless
 * (Principle 5).
 */
export function postDiscord(url: string, content: string, log?: OutboundLogger): void {
  void fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content: content.slice(0, 1900) }),
    signal: AbortSignal.timeout(8000),
  }).catch((err: unknown) => {
    log?.warn(err, 'discord webhook failed (the in-app log is unaffected)');
  });
}
