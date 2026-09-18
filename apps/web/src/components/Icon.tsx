/**
 * Google Material Symbols (Outlined), self-hosted from
 * `@material-symbols/font-400` so the table works offline on the LAN.
 * `name` is typed against the font's own list, so a typo fails the typecheck
 * instead of rendering the word.
 */
import type { MaterialSymbol } from '@material-symbols/font-400';

export interface IconProps {
  name: MaterialSymbol;
  /** Pixel size; the glyph is square. */
  size?: number;
  className?: string;
}

export default function Icon({ name, size = 20, className }: IconProps) {
  return (
    <span
      className={`material-symbols-outlined select-none ${className ?? ''}`}
      style={{ fontSize: size }}
      aria-hidden
    >
      {name}
    </span>
  );
}
