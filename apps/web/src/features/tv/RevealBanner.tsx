/**
 * A staged fog reveal landing on the table (FR9.14 → FR9.20 "staged reveals
 * animate in"). The map itself has already changed — the server revealed the
 * region and the stage redrew — so this is the *announcement*: a light sweep
 * across the scene and the region's name, big enough to read from the couch,
 * then gone.
 *
 * Purely cosmetic and self-clearing: the kiosk latches it for a few seconds
 * and unmounts it. Nothing here holds state that could outlive the moment.
 */
import type { TvReveal } from './sceneState.js';

export default function RevealBanner({ reveal }: { reveal: TvReveal }) {
  return (
    <div
      key={reveal.id}
      className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center"
      aria-label={`Revealed ${reveal.name}`}
    >
      <div className="tv-reveal-sweep absolute inset-0 bg-gradient-to-r from-transparent via-cyan/15 to-transparent" />
      <div className="tv-reveal-name rounded-2xl border border-cyan-dim bg-ground/85 px-14 py-7 text-center backdrop-blur-sm">
        <span className="font-label text-xl tracking-[0.5em] text-cyan">REVEALED</span>
        <div className="mt-3 max-w-[22ch] text-6xl font-bold leading-tight">{reveal.name}</div>
      </div>
    </div>
  );
}
