/**
 * Between scenes (FR9.20): campaign name, the active scene, and the in-game
 * date, in type you can read from the far end of the table.
 */
export interface IdleCardProps {
  campaignName: string;
  sceneName: string | null;
  ingameDate: string | null;
  /** Real-world wall clock, refreshed by the kiosk once a minute. */
  clock: string;
  online: boolean;
}

export default function IdleCard({
  campaignName,
  sceneName,
  ingameDate,
  clock,
  online,
}: IdleCardProps) {
  return (
    <div className="flex h-full flex-col items-center justify-center text-center">
      <span className="font-label text-2xl tracking-[0.5em] text-cyan">{campaignName}</span>

      <h1 className="mt-10 max-w-[20ch] text-[7rem] font-bold leading-[0.95]">
        {sceneName ?? 'Standing by'}
      </h1>

      <div className="mt-12 flex items-baseline gap-10">
        {ingameDate && (
          <span className="font-label text-4xl tracking-[0.3em] text-dim">{ingameDate}</span>
        )}
        <span className="font-label text-4xl tracking-[0.3em] text-faint">{clock}</span>
      </div>

      {!online && (
        <span className="font-label tv-breathe mt-14 text-xl tracking-[0.4em] text-warn">
          RECONNECTING
        </span>
      )}
    </div>
  );
}
