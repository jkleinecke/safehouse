/**
 * Line of sight, as a GM tool (FR9.16).
 *
 * The scene's two hiding switches come first, the fog and the SIGHTLINES
 * (P6): Play shows no Fog tab, and a GM mid-session must be able to fog the
 * table, open it, or hand what it sees to the runners' eyes without leaving
 * the fight.
 *
 * Then two separate switches, because they answer different needs and
 * conflating them would break one of them:
 *
 *  - **"Show me what X sees"** is a lens the GM picks up while planning. It
 *    defaults to off and to nobody, because a GM permanently limited to one
 *    token's view cannot run the rest of the map. Their scrim is deliberately
 *    lighter than a player's — it informs, it does not restrict. One of the
 *    lenses is the whole table's, "the party": exactly what the phones and
 *    the TV show, the squares they see live left clear and only the tokens
 *    they are shown left on the map.
 *  - **"Dim outside own sight"** changes the feel of a scene, so it is the
 *    GM's call per session: illuminating for a careful infiltration, unwanted
 *    noise in a brawl in one room. It DARKENS and never hides: the map under
 *    the scrim stays readable. It used to be worded "players see their own
 *    sightline", and a GM who turned it on to keep a map from the table saw
 *    the table go on reading all of it. Hiding is the fog's job.
 *
 * The cover row is the other half of the promise. The map is good at geometry
 * and bad at everything else — it does not know the target is prone, that the
 * crate was blown apart last pass, or that the ganger is shooting through his
 * own mate. So the system SUGGESTS and the GM DECIDES, and an override is
 * flagged in the roll's provenance rather than quietly folded into the maths.
 */
import type { Scene, Token } from '@safehouse/contracts';
import { coverCall, lineOfSightBetween, type CoverLevel } from '@safehouse/rules';
import { usePatchScene } from '../api.js';
import type { GridCommands } from '../commands.js';
import { useGridStore } from '../store.js';
import { cameraLensId, PARTY_LENS } from '../useShroud.js';
import { FogSwitch, SightlinesSwitch } from './FogTab.js';

export interface LosTabProps {
  scene: Scene;
  tokens: readonly Token[];
  commands: GridCommands;
}

const COVER_CHOICES: readonly { value: CoverLevel | 'auto'; label: string }[] = [
  { value: 'auto', label: 'From the map' },
  { value: 'none', label: 'No cover' },
  { value: 'partial', label: 'Partial' },
  { value: 'full', label: 'Full — no shot' },
];

export default function LosTab({ scene, tokens, commands }: LosTabProps) {
  const losTokenId = useGridStore((s) => s.losTokenId);
  // The floor in view: the one the party lens reads, and the one "Forget
  // this floor" forgets.
  const level = useGridStore((s) => s.activeLevel);
  const setLosTokenId = useGridStore((s) => s.setLosTokenId);
  // The players' switch is a fact about the SCENE, saved and broadcast, so
  // their devices hear it; it used to live in this browser's store and never
  // reached anyone. The console shows the server's answer, not a local echo.
  const patchScene = usePatchScene();
  const losForPlayers = scene.vision?.playersSeeOwnSight ?? false;
  const setLosForPlayers = (on: boolean) =>
    patchScene.mutate({ sceneId: scene.id, patch: { vision: { playersSeeOwnSight: on } } });
  const selectedTokenId = useGridStore((s) => s.selectedTokenId);
  const coverOverride = useGridStore((s) => s.coverOverride);
  const setCoverOverride = useGridStore((s) => s.setCoverOverride);

  const viewer = tokens.find((t) => t.id === losTokenId);
  const target = tokens.find((t) => t.id === selectedTokenId);

  // The ruling for the pair the GM currently has in hand: the viewpoint they
  // picked, shooting at the token they selected. Both are needed — a cover
  // number with no target is a number about nothing.
  //
  // Read on the floor the pair stands on (`lineOfSightBetween`). It used to
  // be read against the ground floor's walls whatever floor they were on, so
  // two runners on a catwalk were ruled behind the warehouse walls beneath
  // them. A pair on two different floors gets no reading at all: the map
  // reads one floor at a time, so that shot is the GM's call.
  const pair = viewer && target && viewer.id !== target.id ? { viewer, target } : null;
  const los = pair === null ? null : lineOfSightBetween(scene, pair.viewer, pair.target);
  const ruling = los === null ? null : { los, call: coverCall(los.cover, coverOverride ?? undefined) };
  const floorsApart = pair !== null && los === null;

  return (
    <div className="flex flex-col gap-3 p-3" data-testid="los-tab">
      {/*
        The fog switch, here as well as on Prep's mode row: Play shows no Fog
        tab, and a GM mid-session must be able to fog the table or open it
        without leaving the fight (2026-09-27).
      */}
      <FogSwitch scene={scene} commands={commands} />
      <SightlinesSwitch scene={scene} commands={commands} level={level} />
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
          <option value={PARTY_LENS}>The party — what the phones and the TV show</option>
          {tokens.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
          {(scene.geometry.cameras ?? []).length > 0 && (
            <optgroup label="Cameras">
              {(scene.geometry.cameras ?? []).map((c) => (
                <option key={c.id} value={cameraLensId(c.id)}>
                  {c.label ?? c.id}
                  {c.active ? '' : ' (off)'}
                </option>
              ))}
            </optgroup>
          )}
        </select>
        <p className="mt-1 text-xs text-faint">
          A lens, not a limit — your scrim stays light so you can still run the rest of the map.
          The party lens shows exactly what the table sees: what it sees live is clear, and only
          the tokens it is shown stay on the map.
        </p>
      </div>

      <div className="border-t border-edge pt-2">
        <button
          type="button"
          aria-pressed={losForPlayers}
          data-testid="los-for-players"
          disabled={patchScene.isPending}
          onClick={() => setLosForPlayers(!losForPlayers)}
          title="Darkens only; use Fog to hide"
          className={
            'mono-label w-full rounded border px-2 py-1 ' +
            (losForPlayers ? 'border-cyan text-cyan' : 'border-edge text-dim')
          }
        >
          {losForPlayers ? 'dim outside own sight: on' : 'dim outside own sight: off'}
        </button>
        <p className="mt-1 text-xs text-faint">
          Each player device darkens what their own character cannot see and draws no token
          outside it — walls, closed doors, columns and full-height props all cut the sightline.
          It only darkens: the floor plan is still sent and still readable under it, and a player
          with no token of their own on the scene is not dimmed at all. To hide ground from the
          table, use Fog.
        </p>
        {patchScene.isError && (
          <p className="mono-label mt-1 text-danger">that did not save — try again</p>
        )}
      </div>

      <div className="border-t border-edge pt-2">
        <div className="mono-label text-dim">Cover</div>
        {ruling === null ? (
          floorsApart ? (
            <p className="mt-1 text-xs text-faint" data-testid="cover-floors">
              {viewer?.name} and {target?.name} are on different floors. The map reads one floor at a
              time, so cover for this shot is your call.
            </p>
          ) : (
            <p className="mt-1 text-xs text-faint" data-testid="cover-idle">
              Pick a viewpoint above and select a target token to get a cover reading.
            </p>
          )
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
