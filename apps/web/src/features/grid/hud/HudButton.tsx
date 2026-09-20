/**
 * The one button the map's chrome is made of — tools, view controls, undo and
 * redo. Icon-sized, pressed state in cyan, and its tooltip doubles as its
 * accessible name, because none of these buttons carry visible text
 * (docs/UX_MAP_BUILDER.md §3.7).
 */
export default function HudButton({
  active,
  title,
  onClick,
  children,
  testId,
  disabled,
  className = '',
}: {
  active?: boolean;
  title: string;
  onClick: () => void;
  children: React.ReactNode;
  testId?: string;
  disabled?: boolean;
  /** Extra classes — used to square off the edge a dropdown caret butts against. */
  className?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active ?? false}
      disabled={disabled}
      onClick={onClick}
      data-testid={testId}
      className={
        'btn px-2.5 py-1.5 text-[0.7rem] disabled:opacity-40 ' +
        (active ? 'border-cyan text-cyan shadow-glow-cyan' : 'text-dim') +
        (className ? ' ' + className : '')
      }
    >
      {children}
    </button>
  );
}

/** An icon inside a `HudButton`, boxed so every button lines up with its neighbours. */
export function HudIcon({ children }: { children: React.ReactNode }) {
  return (
    <span aria-hidden className="block w-5 text-center text-base leading-none">
      {children}
    </span>
  );
}
