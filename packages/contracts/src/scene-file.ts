/**
 * A scene as a file: everything needed to rebuild it in any campaign.
 *
 * The map itself (grid, floors, painted tiles, walls, arcs, doors, fog
 * regions, cameras, notes, pins, vision, token layers), the tokens standing
 * on it, and the files it draws on — background map images, token art, pin
 * handouts, the scene's audio — carried inside as base64, so a scene
 * exported on one GM's laptop opens on another's with nothing missing.
 *
 * What cannot travel is left behind on import: a token's link to a runner
 * or an NPC, and a pin's link to a wiki page, only mean something in the
 * campaign they came from. Imported into another campaign the token keeps
 * its name, look and art, and the pin its label.
 */
import { z } from 'zod';
import { SceneSchema } from './scene.js';
import { TokenSchema } from './token.js';

export const SCENE_FILE_FORMAT = 'safehouse.scene';
export const SCENE_FILE_VERSION = 1;

/** One embedded file, under the attachment id the scene refers to it by. */
export const SceneFileAttachmentSchema = z.object({
  kind: z.enum(['map', 'token', 'handout', 'portrait', 'asset', 'audio']),
  visibility: z.enum(['public', 'gm', 'gm_owner']),
  mime: z.string().min(1).max(100),
  /** The bytes, base64. */
  data: z.string(),
});
export type SceneFileAttachment = z.infer<typeof SceneFileAttachmentSchema>;

export const SceneFileSchema = z.object({
  format: z.literal(SCENE_FILE_FORMAT),
  version: z.literal(SCENE_FILE_VERSION),
  exportedAt: z.string(),
  /** The campaign it came from: links into it survive only an import back into it. */
  sourceCampaignId: z.string(),
  scene: SceneSchema.omit({ id: true, campaignId: true, state: true }),
  /** Tokens with their original ids, which the token layers refer to; new ids on import. */
  tokens: z.array(TokenSchema.omit({ sceneId: true })),
  files: z.record(z.string(), SceneFileAttachmentSchema).default({}),
});
export type SceneFile = z.infer<typeof SceneFileSchema>;
