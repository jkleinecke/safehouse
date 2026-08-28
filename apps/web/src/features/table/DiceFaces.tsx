/**
 * Dice faces row: each d6 as a small tile. Hits (5–6) glow cyan, ones burn
 * red, exploded Rule-of-Six dice get a magenta ring (FR2.1/2.3).
 * `size` lets the TV reuse this at billboard scale.
 */
export interface DiceFacesProps {
  faces: number[];
  exploded?: number[];
  /** Tailwind-free pixel size of one die tile (default 26). */
  size?: number;
  className?: string;
}

function dieClasses(face: number): string {
  if (face >= 5) return 'border-cyan-dim text-cyan bg-[#0a2530]';
  if (face === 1) return 'border-danger/60 text-danger bg-[#2a0d12]';
  return 'border-edge text-dim bg-raised';
}

function DieTile({ face, size, ring }: { face: number; size: number; ring?: boolean }) {
  return (
    <span
      className={`inline-flex items-center justify-center rounded-md border font-label font-semibold ${dieClasses(face)} ${
        ring ? 'ring-2 ring-magenta/70' : ''
      }`}
      style={{ width: size, height: size, fontSize: Math.max(10, Math.round(size * 0.5)) }}
      aria-label={`d6: ${face}`}
    >
      {face}
    </span>
  );
}

export default function DiceFaces({ faces, exploded = [], size = 26, className = '' }: DiceFacesProps) {
  if (faces.length === 0 && exploded.length === 0) return null;
  return (
    <div className={`flex flex-wrap items-center gap-1 ${className}`}>
      {faces.map((f, i) => (
        <DieTile key={`f${i}`} face={f} size={size} />
      ))}
      {exploded.length > 0 && (
        <>
          <span className="mono-label mx-1 text-magenta">6!</span>
          {exploded.map((f, i) => (
            <DieTile key={`x${i}`} face={f} size={size} ring />
          ))}
        </>
      )}
    </div>
  );
}
