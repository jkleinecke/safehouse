/** A palette swatch: the tile as the map draws it, or its two colours until then (`swatches.ts`). */
import type { TileSetLike } from '../types.js';
import { fallbackSwatch, useSwatch, type SwatchTile } from './swatches.js';

export default function Swatch({ set, tile, className = '' }: { set: TileSetLike; tile: SwatchTile; className?: string }) {
  const rendered = useSwatch(set, tile);
  return (
    <span
      aria-hidden
      data-swatch={rendered ? 'render' : 'colours'}
      className={'inline-block h-10 w-10 shrink-0 rounded-sm border border-edge ' + className}
      style={rendered ?? fallbackSwatch(tile.colors)}
    />
  );
}
