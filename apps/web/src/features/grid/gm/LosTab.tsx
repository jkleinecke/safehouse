/**
 * Line of sight, as a GM tool (FR9.16).
 *
 * Two separate switches, because they answer different needs and conflating
 * them would break one of them:
 *
 *  - **"Show me what X sees"** is a lens the GM picks up while planning. It
 *    defaults to off and to nobody, because a GM permanently limited to one
 *    token's view cannot run the rest of the map. Their scrim is deliberately
 *    lighter than a player's — it informs, it does not restrict.
 *  - **"Players see their own sightline"** changes the feel of a scene, so it
 *    is the GM's call per session: illuminating for a careful infiltration,
 *    unwanted noise in a brawl in one room.
 *
 * The cover row is the other half of the promise. The map is good at geometry
 * and bad at everything else — it does not know the target is prone, that the
 * crate was blown apart last pass, or that the ganger is shooting through his
 * own mate. So the system SUGGESTS and the GM DECIDES, and an override is
 * flagged in the roll's provenance rather than quietly folded into the maths.
 */
import type { Scene, Token } from '@safehouse/contracts';
import { coverCall, lineOfSight, sightModelFor, type CoverLevel } from '@safehouse/rules';
import { useGridStore } from '../store.js';

export interface LosTabProps {
  scene: Scene;
  tokens: readonly Token[];
}

const COVER_CHOICES: readonly { value: CoverLevel | 'auto'; label: string }[] = [
  { value: 'auto', label: 'From the map' },
  { value: 'none', label: 'No cover' },
  { value: 'partial', label: 'Partial' },
  { value: 'full', label: 'Full — no shot' },
];

/** The square a token stands in. Positions are cell centres (x.5). */
function cellOf(token: Token): { col: number; row: number } {
  return { col: Math.floor(token.x), row: Math.floor(token.y) };
}

export default function LosTab({ scene, tokens }: LosTabProps) {
  const losTokenId = useGridStore((s) => s.losTokenId);
  const setLosTokenId = useGridStore((s) => s.setLosTokenId);
  const losForPlayers = useGridStore((s) => s.losForPlayers);
  const setLosForPlayers = useGridStore((s) => s.setLosForPlayers);
  const selectedTokenId = useGridStore((s) => s.selectedTokenId);
  const coverOverride = useGridStore((s) => s.coverOverride);
  const setCoverOverride = useGridStore((s) => s.setCoverOverride);

  const viewer = tokens.find((t) => t.id === losTokenId);
  const target = tokens.find((t) => t.id === selectedTokenId);

  // The ruling for the pair the GM currently has in hand: the viewpoint they
  // picked, shooting at the token they selected. Both are needed — a cover
  // number with no target is a number about nothing.
  const ruling =
    viewer && target && viewer.id !== target.id
      ? (() => {
          const los = lineOfSight(cellOf(viewer), cellOf(target), sightModelFor(scene));
          return { los, call: coverCall(los.cover, coverOverride ?? undefined) };
        })()
      : null;

  return (
    <div className="flex flex-col gap-3 p-3" data-testid="los-tab">
      <div>
        <div className="mono-label text-dim">Show me what this token sees</div>
        <select
          aria-label="Sightline viewpoint"
          data-testid="los-viewpoint"
          value={losTokenId ?? ''}
          onChange={(e) => setLosTokenId(e.target.value === '' ? null : e.target.value)}
          className="mt-1 w-full rounded border border-edge bg-deck px-2 py-1 text-sm"
        >
          <option value="">Nobody — show the whole map</option>
          {tokens.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-faint">
          A lens, not a limit — your scrim stays light so you can still run the rest of the map.
        </p>
      </div>

      <div className="border-t border-edge pt-2">
        <button
          type="button"
          aria-pressed={losForPlayers}
          data-testid="los-for-players"
          onClick={() => setLosForPlayers(!losForPlayers)}
          className={
            'mono-label w-full rounded border px-2 py-1 ' +
            (losForPlayers ? 'border-cyan text-cyan' : 'border-edge text-dim')
          }
        >
          {losForPlayers ? 'players see their own sightline' : 'players see the whole map'}
        </button>
        <p className="mt-1 text-xs text-faint">
          Each player device darkens what their own character cannot see. The map itself is still
          sent — this tells them what they can act on, it does not hide the floor plan.
        </p>
      </div>

      <div className="border-t border-edge pt-2">
        <div className="mono-label text-dim">Cover</div>
        {ruling === null ? (
          <p className="mt-1 text-xs text-faint" data-testid="cover-idle">
            Pick a viewpoint above and select a target token to get a cover reading.
          </p>
        ) : (
          <>
            <p className="mt-1 text-xs text-dim" data-testid="cover-reading">
              {viewer?.name} → {target?.name}:{' '}
              <span className={ruling.los.clear ? 'text-ink' : 'text-magenta'}>
                {ruling.call.why}
              </span>
              {ruling.los.blockedBy !== null && (
                <span className="text-faint"> (behind {ruling.los.blockedBy})</span>
              )}
            </p>
            <select
              aria-label="Cover override"
              data-testid="cover-override"
              value={coverOverride ?? 'auto'}
              onChange={(e) =>
                setCoverOverride(e.target.value === 'auto' ? null : (e.target.value as CoverLevel))
              }
              className="mt-1 w-full rounded border border-edge bg-deck px-2 py-1 text-sm"
            >
              {COVER_CHOICES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
            {ruling.call.overridden && (
              <p className="mt-1 text-xs text-magenta" data-testid="cover-overridden">
                Your call overrides the map. The roll will say so.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
