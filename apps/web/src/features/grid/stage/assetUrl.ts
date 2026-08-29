/**
 * Making pixi able to load the file store's URLs — for every stage, not just
 * the TV's.
 *
 * `Assets.load(url)` picks a parser by testing the URL's file EXTENSION, and
 * `/files/:id` serves attachments by uuid with the mime in the response
 * header: `/files/<uuid>?token=…` has no extension at all. Pixi matches no
 * parser, warns
 *
 *   "[Assets] …/files/<id>?token=… could not be loaded as we don't know how to
 *    parse it, ensure the correct parser has been added"
 *
 * …and every map image and token portrait silently fails to appear — a blank
 * map on `/c/:id/grid` for the GM and every player, and on the table TV.
 *
 * Registering the URL up front with an explicit `parser` skips the extension
 * test: `Assets.load` only auto-registers `{ alias, src }` for keys the
 * resolver does not already know, so a pre-registered key wins. This lives at
 * the one place every stage funnels through (`createStage`), which is why the
 * fix is not repeated per feature.
 *
 * The alternative — serving `/files/:id.png` — would change a route two other
 * domains build URLs for; this changes one loader.
 */

/** The slice of pixi's `Assets` this module needs — injectable for tests. */
export interface AssetRegistry {
  resolver: { hasKey(key: string): boolean };
  add(asset: { alias: string; src: string; parser: string }): void;
}

/** Pixi's texture parser, by its registered name. */
export const TEXTURE_PARSER = 'loadTextures';

/**
 * Wrap an attachment-id→URL builder so pixi can actually load what it returns.
 * Idempotent: a URL already in the resolver is handed back untouched, so this
 * is safe to apply more than once along a call chain.
 */
export function parserSafeUrlFor(
  urlFor: (attachmentId: string) => string,
  assets: AssetRegistry,
): (attachmentId: string) => string {
  return (attachmentId) => {
    const url = urlFor(attachmentId);
    if (!assets.resolver.hasKey(url)) {
      assets.add({ alias: url, src: url, parser: TEXTURE_PARSER });
    }
    return url;
  };
}
