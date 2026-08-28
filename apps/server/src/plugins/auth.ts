/**
 * auth domain plugin — STUB registered by src/plugins/index.ts.
 *
 * TODO(auth feature agent): implement this domain's routes and hub command
 * handlers here per DESIGN.md §12 and docs/BUILD_CONVENTIONS.md. Available on
 * `app`: `app.db`, `app.hub` (emit/emitEphemeral/onCommand), `app.authService`;
 * guards via `import { requireAuth, requireRole, assertCampaign, httpError }
 * from '../services/auth.js'`; `req.auth` carries the device-token context.
 * Fill ONLY this file — src/plugins/index.ts already registers it.
 */
import type { FastifyInstance } from 'fastify';

export default async function authPlugin(app: FastifyInstance): Promise<void> {
  void app; // TODO(auth feature agent): routes + hub.onCommand registrations.
}
