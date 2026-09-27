/**
 * The fog as it crosses the wire, shared by the server's tests and the web's
 * (FR9.13, Principle 4).
 *
 * The bug this exists to pin down lived in the gap between two suites. The
 * server sent a player a fogged scene with nothing revealed as
 * `regions: []`, and its test asserted exactly that, an empty list. The map
 * drew nothing for `regions: []`, and its test fed `drawFog` the GM's copy,
 * which still had the region in it. Both suites were green. Every phone and
 * the TV showed the whole map, and only the GM saw fog. Each side was tested
 * against its own idea of the other.
 *
 * So the copy lives here, once, and both sides import it by relative path:
 *
 *   - the server's tests (apps/server/test/scenes.test.ts) assert that a
 *     player's and a display device's `scene.fog` EQUALS it;
 *   - the web's tests (stage/layers.test.ts, stage3d/masks.test.ts, the TV's
 *     tv/sceneState.test.ts) hand exactly it to `drawFog`, the client cover
 *     and the TV fold, and assert that the map is covered.
 *
 * If one side changes what it sends or reads, the other side's tests break.
 * That is what sharing the fixture is for. This is the opposite of
 * `apps/server/test/builds-fixtures.ts`, which copies its fixtures so the
 * two suites can change on their own.
 *
 * It is in contracts, beside the `FogState` it is an instance of, because
 * the wire is the contract. It is a test file, not part of the package's
 * published surface (`dist`), and nothing outside the tests may import it.
 */
import type { FogState } from '../src/scene.js';

/**
 * A scene the GM has fogged with nothing revealed, as every viewer who is
 * not the GM receives it (`sceneForViewer`): players, the TV (`display`) and
 * observers.
 *
 * - No regions: the copy carries only the revealed ones, and none is. An
 *   unrevealed region's id, name and outline never leave the server.
 * - No reveals and no painted shapes.
 * - `active: true`: the one bit that says the scene is fogged at all. It is
 *   `fogOn` of the stored state, worked out on the server from what this
 *   copy does not carry: the GM's switch (`enabled`) and the unrevealed
 *   regions. Without it this copy reads as an open scene.
 *
 * Treat it as read-only. Tests that need a variant (one region revealed, the
 * switch turned off) spread it into a new object rather than change it,
 * because every suite that imports it reads the same object.
 */
export const FOG_WIRE_UNREVEALED: FogState = {
  regions: [],
  revealed: [],
  revealedShapes: [],
  active: true,
};
