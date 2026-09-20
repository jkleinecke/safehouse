/** A palette swatch: the tile as the map draws it, or its two colours until then (`swatches.ts`). */
import type { TileSetLike } from '../types.js';
import { fallbackSwatch, useSwatch, type SwatchTile } from './swatches.js';

export default function Swatch({
  set,
  tile,
  size = 'h-10 w-10',
  className = '',
}: {
  set: TileSetLike;
  tile: SwatchTile;
  /** Size classes — the palette's square, or something toolbar-sized. */
  size?: string;
  className?: string;
}) {
  const rendered = useSwatch(set, tile);
  return (
    <span
      aria-hidden
      data-swatch={rendered ? 'render' : 'colours'}
      className={`inline-block shrink-0 rounded-sm border border-edge ${size} ${className}`}
      style={rendered ?? fallbackSwatch(tile.colors)}
    />
  );
}
