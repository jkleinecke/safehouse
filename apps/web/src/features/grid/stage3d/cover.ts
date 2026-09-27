/// <reference types="vite/client" />
/**
 * The cover: what hides the 3D map from a viewer who may not see it (P2 of
 * the move to 3D) — the players' fog and the sightline shroud — as ONE
 * shader patch that every material drawing the scene wears.
 *
 * ## Why a patch and not a sheet
 *
 * The 2D map hides with sheets laid over the screen: an opaque cover with the
 * revealed regions cut out (`drawFog`), and a scrim over every square outside
 * the sightline (`drawShroud`), each swept upward by a wall's height so the
 * walls standing on a hidden square go under it too. A sheet cannot do that
 * in 3D: the camera turns, and a wall on a hidden square is then seen from
 * the side, over the sheet, at any height. So the cover is applied where a
 * thing IS rather than where it lands on screen: every fragment of every
 * material looks up the square it stands over — its world x and z, whatever
 * its height — in the masks (`masks.ts`), and is hidden as that square is. A
 * wall's cap, a figure's head, a lamp's glow: each is hidden by the square
 * under it, from every angle the camera can take.
 *
 * ## What the patch does
 *
 * A varying carries the fragment's world (x, z) out of the vertex shader. At
 * the very end of the fragment shader — after tone mapping and the output
 * colour space, so the cover colour comes out exactly as the background —
 * two one-channel textures are read there:
 *   - the FOG mask: 1 under the players' opaque cover, 0 where a region is
 *     revealed — `drawFog`'s own shape, rasterised;
 *   - the SHROUD mask: 1 on each square the viewer can see, 0 elsewhere, one
 *     texel a square, filtered so its edge is soft.
 * The cover is max(fog × fog amount, (1 − seen) × shroud amount). Where it is
 * total the fragment is DISCARDED rather than painted over: a hidden wall
 * between the camera and a revealed room neither shows its silhouette nor
 * hides the room behind it, and where nothing visible stands the background
 * — which is the cover colour — shows. Short of total (the shroud's scrim,
 * the soft rim of a revealed region), the colour is mixed toward the cover
 * colour by that much. Outside a mask's rectangle (the map, and a margin
 * round it) that mask covers nothing, as on the 2D map.
 *
 * Only the fog is ever total (the shroud's scrim tops out at 0.62), so the
 * discard is compiled in only while a fog mask is shown (`discardOn`): a
 * shader with a `discard` in it gives up early depth testing, and on the
 * tile-based GPUs of phones and TV sticks its hidden-surface removal too,
 * whether or not the discard ever fires. The GM, the lab and a player on an
 * unfogged scene draw with programs that have none; a player's stage pays
 * one recompile of every covered program when its first fog arrives (none
 * at all when the fog is there from the first frame, which is the usual
 * case). Every material that wears the patch is known (`track`), so a flip
 * reaches the ones not in the scene at that moment too.
 *
 * ## What the discard would open
 *
 * A discarded fragment is a hole. Where the fog covers a square of the floor
 * in view, its slab is gone, and in iso a ray through it goes on down to the
 * storey below — about a storey × √2 squares further north-west, which may
 * be revealed. The FOG LID (`createFogLidMaterial`) closes that: a sheet just
 * under the floor in view, in the cover colour, depth-writing, that exists
 * exactly where the fog is total. It hides nothing standing on the floor in
 * view (that is all above it) and everything below it there.
 *
 * ## Shadows
 *
 * three draws the shadow maps with depth materials of its own, which never
 * run a material's compile hook: a wall under the fog would still cast its
 * shadow onto a revealed floor at Medium and High. Every shadow caster the
 * builders make is given depth materials that wear a discard-only patch
 * (`coverShadows`), and the stage draws the shadow maps again when the fog
 * changes.
 *
 * ## Who wears which masks
 *
 * The 2D map's layer order decides, so both renderers hide the same things
 * from the same people (`CoverMode`):
 *   - `full`, under the shroud and the fog: the map images, the painted world
 *     and its lamps' glow, the floors below and their shade, the light-map
 *     wash;
 *   - `fog`, over the shroud and under the fog: the grid, the doors, the
 *     tokens with their rings, auras and shadows — and their plates, which
 *     `masks.ts` `coveredAt` hides from the same answer;
 *   - neither (`exemptFromCover`), over both: the templates, the ruler, the
 *     drafts, the pings and the pointer trail, which the 2D map draws in its
 *     fx layer above the fog.
 *
 * ## Uniforms
 *
 * One set, shared by every patched material, so a new mask is a texture swap
 * and a few numbers — a recompile only when the fog comes or goes, which
 * turns the discard on or off — and new eyes are two matrices. One stage
 * draws a map at a time: the one that owns the cover (`claimCover`) writes
 * it, and puts it back to "nothing covered", seen with plain eyes, when it
 * goes (`releaseCover`). With nothing covered (the lab, a GM with no lens)
 * the patch skips its reads on a uniform branch. Beside the set, each
 * material has one uniform of its own: which of a vision mode's matrices it
 * takes, if any.
 *
 * ## Vision
 *
 * The 2D map restyles itself for a pair of eyes (thermal, low-light,
 * ultrasound) with two colour-matrix filters: one on its floor containers
 * (the map images, the painted tiles, and the floors below with the tokens
 * seen on them), one on its tokens and their badges (`stage/viewModes.ts`
 * holds the matrices, as data both renderers read). Everything else it
 * draws — the light-map wash, the grid, the doors and zones, the cameras'
 * cones, the lights, pins and notes — lies in containers neither filter
 * reaches, in its own colours. Here the same step is part of the patch: just
 * before the cover's mix, the fragment's final colour — after tone mapping
 * and the output colour space, so the same encoding the 2D filters see —
 * goes through a colour matrix, clamped to 0 … 1 as the 2D filter's target
 * keeps it. Which matrix is the material's own business, told by a uniform
 * of its own, so marking one compiles nothing:
 *   - the BODIES' on what draws the figures on the floor in view
 *     (`markBody`);
 *   - none on the overlays and the GM's markers (`markPlain`), which lie
 *     over the restyled floor in their own colours, as the 2D map's do: an
 *     open door stays green and a closed one red whatever the eyes;
 *   - the FLOOR's on every other covered material: the world, the map, the
 *     traced walls, the floors below and the figures seen down on them.
 * The cover colour mixed in after it, and the background, are left as they
 * are, as the 2D map's fog and shroud sheets lie unfiltered over its
 * filtered layers; what is exempt from the cover (the templates, the ruler,
 * the pings) is not restyled either, as the 2D fx layer is not.
 *
 * Premultiplied colour is unpremultiplied for the step and premultiplied
 * again, as Pixi's filter does. Added light (a halo) takes only the
 * matrix's linear part, with no offsets: the matrix is affine, so M(dst +
 * src) = M(dst) + A·src — adding A·src over a floor the matrix already
 * styled is the matrix applied to the sum, where adding M(src) would count
 * the offsets twice.
 *
 * Switching eyes (`setVision`) writes the shared uniforms and nothing else:
 * no program is compiled again. For eyes that see the scene as it is
 * (normal, astral) the step is skipped on a uniform branch.
 *
 * ## Chaining
 *
 * `applyCover` wraps whatever `onBeforeCompile` a material already has (the
 * lighting's baked variants, the glow's emissive, the map plane's tone) and
 * adds its tag to the program cache key, so a covered material never shares a
 * program with an uncovered one. A material that wears a covered material's
 * compile hook (the lit variants in `lighting3d.ts`, the ghost glow in
 * `figures.ts`) carries the tag through that material's key, which is what
 * `coverModeOf` reads; such a material is handed to `applyCover` as well,
 * which then only notes it (`track`), so a discard flip recompiles it too.
 * The patch guards itself: a shader that already has it is left alone, so a
 * chain that wears it twice compiles it once.
 *
 * Every material in the scene is looked at after each stage update
 * (`coverScene`): one without the cover is given it there, and in a dev
 * build it is named in a warning, once, so it gets wired where it is made.
 */
import {
  AdditiveBlending,
  Color,
  DataTexture,
  LinearFilter,
  Matrix4,
  MeshBasicMaterial,
  MeshDepthMaterial,
  MeshDistanceMaterial,
  RGBADepthPacking,
  RedFormat,
  ShaderMaterial,
  UnsignedByteType,
  Vector4,
  type Material,
  type Mesh,
  type Object3D,
  type Texture,
  type WebGLProgramParametersWithUniforms,
  type WebGLRenderer,
} from 'three';
import { C } from '../stage/colors.js';
import type { ColorMatrix, ViewModeLook } from '../stage/viewModes.js';

/**
 * Which masks hide a material: `full` the shroud and the fog (what the 2D map
 * draws under its shroud), `fog` the fog alone (what it draws over its shroud
 * and under its fog). See the module note.
 */
export type CoverMode = 'full' | 'fog';

/** In every covered program's cache key, and nowhere else. */
const TAG = 'safehouse-cover';
const TAG_MODE = /safehouse-cover:(full|fog)/;

/**
 * How far past its rectangle, in squares, a mask's edge still covers (its
 * edge texel, clamped): a wall on the map's outer edge stands half outside
 * it. Past that, nothing is covered.
 */
export const COVER_MARGIN = 0.5;

/** Cover at or past this is total: the fragment is not drawn at all. */
export const COVER_TOTAL = 0.999;

/** The varying the patch adds, and the mark that a shader has the patch. */
const MARK = 'vLabCoverXZ';

/**
 * A one-channel, linearly filtered mask texture over `width × height` bytes
 * (0 … 255), row 0 at v = 0. Rows are packed tight whatever their width.
 */
export function maskTexture(data: Uint8Array, width: number, height: number): DataTexture {
  const tex = new DataTexture(data, width, height, RedFormat, UnsignedByteType);
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearFilter;
  tex.generateMipmaps = false;
  // A row of one-byte texels need not fill whole 4-byte words.
  tex.unpackAlignment = 1;
  tex.needsUpdate = true;
  return tex;
}

/** One mask as the shader reads it: its texture over a rectangle of the floor (world units), and how strongly it covers. */
export interface CoverMask {
  map: Texture;
  /** The rectangle's north-west corner, world x and z (grid x and y). */
  x0: number;
  z0: number;
  /** Its size, in squares along x and along z. */
  width: number;
  depth: number;
  /** 0 … 1: how far a fully masked fragment is taken toward the cover colour (1 hides it). */
  amount: number;
}

/** The mask a texture stands for when nothing is covered. */
const NO_FOG = maskTexture(new Uint8Array([0]), 1, 1);
const ALL_SEEN = maskTexture(new Uint8Array([255]), 1, 1);

/** The shared uniforms: every covered program reads these same objects. */
const U = {
  labCoverFogMap: { value: NO_FOG as Texture },
  labCoverFogRect: { value: new Vector4(0, 0, 1, 1) },
  labCoverFog: { value: 0 },
  labCoverShroudMap: { value: ALL_SEEN as Texture },
  labCoverShroudRect: { value: new Vector4(0, 0, 1, 1) },
  labCoverShroud: { value: 0 },
  /** The cover colour, linear: the map's ground, which is also the 3D scene's background. */
  labCoverColor: { value: new Color(C.ground) },
  /** 1 while a vision mode restyles the scene (`setVision`); 0 for eyes that see it as it is. */
  labVisionOn: { value: 0 },
  /** The floor's colour matrix (`viewModes.ts`): its 4 × 4 part, and its offsets. */
  labVisionFloor: { value: new Matrix4() },
  labVisionFloorShift: { value: new Vector4() },
  /** The bodies' colour matrix, the same way. */
  labVisionBodies: { value: new Matrix4() },
  labVisionBodiesShift: { value: new Vector4() },
};

/** The stage whose masks the uniforms show; null when none does. */
let owner: object | null = null;

/**
 * Whether the covered programs are compiled with the discard: while a fog
 * mask that can be total is shown, and only then (see the module note).
 */
let discardOn = false;

/**
 * Every material that wears the patch, its own or through another's compile
 * hook, until it is disposed: what a discard flip recompiles. A disposed
 * material drawn again compiles afresh anyway, with the flag as it then is.
 */
const wearers = new Set<Material>();

/** Note `material` as one of the `wearers`. */
function track(material: Material): void {
  if (wearers.has(material)) return;
  wearers.add(material);
  const forget = (): void => {
    material.removeEventListener('dispose', forget);
    wearers.delete(material);
  };
  material.addEventListener('dispose', forget);
}

/** Compile the discard in, or take it out, of every covered program: each is recompiled when next drawn. */
function setDiscard(on: boolean): void {
  if (on === discardOn) return;
  discardOn = on;
  for (const m of wearers) m.needsUpdate = true;
}

function writeMask(map: { value: Texture }, rect: { value: Vector4 }, amount: { value: number }, mask: CoverMask | null, none: Texture): void {
  if (mask === null || !(mask.amount > 0) || !(mask.width > 0) || !(mask.depth > 0)) {
    map.value = none;
    rect.value.set(0, 0, 1, 1);
    amount.value = 0;
    return;
  }
  map.value = mask.map;
  rect.value.set(mask.x0, mask.z0, mask.width, mask.depth);
  amount.value = Math.min(1, mask.amount);
}

/**
 * Make `who` the owner of the cover: from now on its `setCover` and
 * `setVision` are what every covered material shows. It starts with plain
 * eyes: a vision mode the last owner left on is not its to keep.
 */
export function claimCover(who: object): void {
  owner = who;
  writeVision(null);
}

/**
 * Show these masks (null for none) on every covered material, if `who` owns
 * the cover. The caller asks for a frame.
 */
export function setCover(who: object, fog: CoverMask | null, shroud: CoverMask | null): void {
  if (owner !== who) return;
  writeMask(U.labCoverFogMap, U.labCoverFogRect, U.labCoverFog, fog, NO_FOG);
  writeMask(U.labCoverShroudMap, U.labCoverShroudRect, U.labCoverShroud, shroud, ALL_SEEN);
  // The shroud never reaches total: only a fog that can is worth a discard.
  setDiscard(U.labCoverFog.value >= COVER_TOTAL);
}

/** `who` is done with the cover: if it still owns it, nothing is covered any more, and the eyes are plain. */
export function releaseCover(who: object): void {
  if (owner !== who) return;
  setCover(who, null, null);
  writeVision(null);
  owner = null;
}

/** Load a 4 × 5 colour matrix into the patch's form: its 4 × 4 part (row-major in, as `Matrix4.set` takes it) and its offsets. */
function loadVision(m: ColorMatrix, into: Matrix4, shift: Vector4): void {
  const at = (i: number): number => m[i] ?? 0;
  into.set(at(0), at(1), at(2), at(3), at(5), at(6), at(7), at(8), at(10), at(11), at(12), at(13), at(15), at(16), at(17), at(18));
  shift.set(at(4), at(9), at(14), at(19));
}

/** Write a look to the shared uniforms; null for plain eyes, which skip the step (and hold identities, for good measure). */
function writeVision(look: ViewModeLook | null): void {
  if (look === null) {
    U.labVisionOn.value = 0;
    U.labVisionFloor.value.identity();
    U.labVisionFloorShift.value.set(0, 0, 0, 0);
    U.labVisionBodies.value.identity();
    U.labVisionBodiesShift.value.set(0, 0, 0, 0);
    return;
  }
  loadVision(look.floor, U.labVisionFloor.value, U.labVisionFloorShift.value);
  loadVision(look.bodies, U.labVisionBodies.value, U.labVisionBodiesShift.value);
  U.labVisionOn.value = 1;
}

/**
 * Restyle every covered material for a pair of eyes (`viewModes.ts`
 * `viewModeLook`; null for eyes that see the scene as it is), if `who` owns
 * the cover: the bodies' matrix on what `markBody` marked, none on what
 * `markPlain` marked, the floor's on everything else covered. Uniforms only
 * — nothing is compiled again. The caller asks for a frame.
 */
export function setVision(who: object, look: ViewModeLook | null): void {
  if (owner !== who) return;
  writeVision(look);
}

/** A material's `labVisionKind`: the floor's matrix, the bodies', or none. */
const VISION_FLOOR = 0;
const VISION_BODY = 1;
const VISION_PLAIN = -1;

/**
 * Per material, which matrix a vision mode gives it (`VISION_FLOOR`,
 * `VISION_BODY`, `VISION_PLAIN`): the uniform of its own each covered
 * program reads. Made on first ask, by a mark or by the material's compile,
 * whichever comes first, so a mark before or after the compile is the same
 * object the program reads.
 */
const visionKinds = new WeakMap<Material, { value: number }>();

function visionKind(material: Material): { value: number } {
  let kind = visionKinds.get(material);
  if (kind === undefined) {
    kind = { value: VISION_FLOOR };
    visionKinds.set(material, kind);
  }
  return kind;
}

/**
 * `material` draws a body: a vision mode gives it the bodies' matrix rather
 * than the floor's. A uniform flips — no program is compiled again — so it
 * can be said as often as convenient; a material never stops being a body.
 *
 * The mark goes by the material whose compile hook the patch runs in: a
 * stand-in that runs another material's hook as that material's (the lit
 * variants in `lighting3d.ts` call `orig.onBeforeCompile`) reads the
 * original's mark, so a body's original is marked too, not only what its
 * meshes wear.
 */
export function markBody(material: Material): void {
  visionKind(material).value = VISION_BODY;
}

/**
 * `material` is never restyled by a vision mode: an overlay or a marker,
 * which the 2D map draws in its own colours over its restyled floor (see the
 * module note). A uniform, read as `markBody`'s is; said once, where the
 * material is made.
 */
export function markPlain(material: Material): void {
  visionKind(material).value = VISION_PLAIN;
}

/** Every material under `root` draws a body (`markBody`). */
export function markBodies(root: Object3D): void {
  root.traverse((o) => {
    const mat = (o as Object3D & { material?: Material | Material[] }).material;
    if (mat === undefined) return;
    if (Array.isArray(mat)) for (const m of mat) markBody(m);
    else markBody(mat);
  });
}

// ---------------------------------------------------------------------------
// The patch
// ---------------------------------------------------------------------------

/** A number as a GLSL float literal. */
const glf = (n: number): string => n.toFixed(4);

/** The fragment's world x/z, for anything built from `transformed` (every mesh, line and point material). */
const MESH_VERTEX = /* glsl */ `
	{
		vec4 labCoverAt = vec4( transformed, 1.0 );
		#ifdef USE_BATCHING
			labCoverAt = batchingMatrix * labCoverAt;
		#endif
		#ifdef USE_INSTANCING
			labCoverAt = instanceMatrix * labCoverAt;
		#endif
		${MARK} = ( modelMatrix * labCoverAt ).xz;
	}
`;

/**
 * A sprite is a billboard with no world position of its own per fragment:
 * it is hidden by the square its centre hangs over (a lamp's halo, by its
 * lamp's).
 */
const SPRITE_VERTEX = /* glsl */ `
	${MARK} = modelMatrix[ 3 ].xz;
`;

/** The uniforms and the two helpers every fragment side reads the masks with. */
const COVER_PARS = /* glsl */ `
uniform sampler2D labCoverFogMap;
uniform vec4 labCoverFogRect;
uniform float labCoverFog;
uniform sampler2D labCoverShroudMap;
uniform vec4 labCoverShroudRect;
uniform float labCoverShroud;
uniform vec3 labCoverColor;
float labCoverIn( vec4 rect, vec2 p ) {
	vec2 lo = rect.xy - ${glf(COVER_MARGIN)};
	vec2 hi = rect.xy + rect.zw + ${glf(COVER_MARGIN)};
	return ( all( greaterThanEqual( p, lo ) ) && all( lessThanEqual( p, hi ) ) ) ? 1.0 : 0.0;
}
vec2 labCoverUv( vec4 rect, vec2 p ) {
	return clamp( ( p - rect.xy ) / rect.zw, 0.0, 1.0 );
}
`;

const FRAGMENT_PARS = /* glsl */ `${COVER_PARS}varying vec2 ${MARK};
`;

/** The vision step's uniforms: the shared looks, and the material's own kind (`markBody`, `markPlain`). Colour passes only. */
const VISION_PARS = /* glsl */ `uniform float labVisionOn;
uniform mat4 labVisionFloor;
uniform vec4 labVisionFloorShift;
uniform mat4 labVisionBodies;
uniform vec4 labVisionBodiesShift;
uniform float labVisionKind;
`;

/**
 * The vision step (see the module note), on the final colour before the
 * cover's mix, on a uniform branch: skipped for plain eyes and for a plain
 * material alike. Added light takes the matrix's linear part alone;
 * anything else the whole matrix, on straight colour, as Pixi's filter
 * applies it.
 */
function visionMain(additive: boolean): string {
  const body = `labVisionKind > ${glf(VISION_BODY - 0.5)}`;
  const step = additive
    ? /* glsl */ `
		gl_FragColor.rgb = clamp( ( labVisionM * vec4( gl_FragColor.rgb, 0.0 ) ).rgb, 0.0, 1.0 );`
    : /* glsl */ `
		vec4 labVisionIn = gl_FragColor;
		#ifdef PREMULTIPLIED_ALPHA
			if ( labVisionIn.a > 0.0 ) labVisionIn.rgb /= labVisionIn.a;
		#endif
		vec4 labVisionShift = ${body} ? labVisionBodiesShift : labVisionFloorShift;
		vec4 labVisionOut = clamp( labVisionM * labVisionIn + labVisionShift, 0.0, 1.0 );
		#ifdef PREMULTIPLIED_ALPHA
			labVisionOut.rgb *= labVisionOut.a;
		#endif
		gl_FragColor = labVisionOut;`;
  return /* glsl */ `
	if ( labVisionOn > 0.5 && labVisionKind > ${glf(VISION_PLAIN + 0.5)} ) {
		mat4 labVisionM = ${body} ? labVisionBodies : labVisionFloor;${step}
	}
`;
}

/** The fog's cover at the fragment, 0 … 1: what the patch and the lid both start from. */
const FOG_AT = /* glsl */ `labCoverFog * labCoverIn( labCoverFogRect, ${MARK} )
			* texture2D( labCoverFogMap, labCoverUv( labCoverFogRect, ${MARK} ) ).r`;

/** The discard under total cover, when it is compiled in at all (`discardOn`). */
function discardLine(): string {
  return discardOn ? `\n\t\tif ( labCover >= ${glf(COVER_TOTAL)} ) discard;` : '';
}

/** A program key's word for whether the discard is compiled in. */
function discardKey(): string {
  return discardOn ? ':cut' : '';
}

/**
 * The end of the fragment shader: the vision step, then the cover. Both
 * textures are read inside a branch on uniforms only, so the reads stay in
 * uniform control flow.
 */
function fragmentMain(mode: CoverMode, additive: boolean): string {
  const shroud =
    mode === 'full'
      ? /* glsl */ `
		float labSeen = texture2D( labCoverShroudMap, labCoverUv( labCoverShroudRect, ${MARK} ) ).r;
		labCover = max( labCover, labCoverShroud * labCoverIn( labCoverShroudRect, ${MARK} ) * ( 1.0 - labSeen ) );`
      : '';
  // Added light (a halo) is covered by adding less of it; anything else is
  // taken toward the cover colour, as the 2D sheets blend over it.
  const apply = additive
    ? /* glsl */ `
		gl_FragColor.rgb *= 1.0 - labCover;`
    : /* glsl */ `
		vec3 labCoverOut = linearToOutputTexel( vec4( labCoverColor, 1.0 ) ).rgb;
		#ifdef PREMULTIPLIED_ALPHA
			labCoverOut *= gl_FragColor.a;
		#endif
		gl_FragColor.rgb = mix( gl_FragColor.rgb, labCoverOut, labCover );`;
  return /* glsl */ `${visionMain(additive)}
	if ( labCoverFog + labCoverShroud > 0.0 ) {
		float labCover = ${FOG_AT};${shroud}${discardLine()}${apply}
	}
`;
}

/**
 * The end of a shadow pass's fragment shader (`coverShadows`): a caster under
 * total fog is not there. Nothing else — the colour is packed depth, which a
 * mix would corrupt — and nothing at all while the discard is off.
 */
function shadowMain(): string {
  if (!discardOn) return '';
  return /* glsl */ `
	if ( labCoverFog > 0.0 ) {
		float labCover = ${FOG_AT};${discardLine()}
	}
`;
}

/** `code` put just before the last closing brace of `src` — the end of its `main`. */
function atEndOfMain(src: string, code: string): string | null {
  const end = src.lastIndexOf('}');
  return end < 0 ? null : `${src.slice(0, end)}${code}${src.slice(end)}`;
}

/** How a shader's fragment side ends: a material's colour pass, or a shadow pass. */
type PatchEnd = { kind: 'colour'; mode: CoverMode; additive: boolean } | { kind: 'shadow' };

/**
 * Patch `shader`, the program `material` is being compiled with. A colour
 * pass also gets the material's own vision kind (`markBody`, `markPlain`):
 * three hands every material its own uniforms object here, even where
 * materials share a program.
 */
function patchShader(shader: WebGLProgramParametersWithUniforms, sprite: boolean, end: PatchEnd, material: Material | null): void {
  // Already there: a chain that wears the cover twice compiles it once.
  if (shader.vertexShader.includes(MARK)) return;
  const colour = end.kind === 'colour';
  const vertex = atEndOfMain(shader.vertexShader, sprite ? SPRITE_VERTEX : MESH_VERTEX);
  const fragment = atEndOfMain(shader.fragmentShader, colour ? fragmentMain(end.mode, end.additive) : shadowMain());
  if (vertex === null || fragment === null) {
    console.warn('[stage3d] cover: a shader with no main to patch');
    return;
  }
  Object.assign(shader.uniforms, U);
  if (colour && material !== null) shader.uniforms.labVisionKind = visionKind(material);
  shader.vertexShader = `varying vec2 ${MARK};\n${vertex}`;
  shader.fragmentShader = `${FRAGMENT_PARS}${colour ? VISION_PARS : ''}${fragment}`;
}

// ---------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------

/** The mode each material was given here. Materials that wear another's patch are known by their key instead. */
const modes = new WeakMap<Material, CoverMode>();
/** Materials drawn over the cover on purpose (`exemptFromCover`). */
const exempt = new WeakSet<Material>();

/**
 * Put the cover on `material`, hidden by the masks `mode` names: its compile
 * hook is wrapped (whatever it did still happens first) and its program key
 * tagged. A material that already wears the cover, through the hook it
 * shares with a covered one (a lit variant, a ghost's glow), is only noted,
 * so a discard flip recompiles it with the rest. Call it before the material
 * is first drawn; later is fine, at the price of one recompile.
 */
export function applyCover(material: Material, mode: CoverMode = 'full'): void {
  exempt.delete(material);
  if (coverModeOf(material) !== null) {
    track(material);
    return;
  }
  if (material instanceof ShaderMaterial) {
    // Hand-written shaders have no `transformed`, no `main` layout to rely on.
    console.warn(`[stage3d] cover: "${material.name || material.type}" is a ShaderMaterial and cannot take the cover`);
    return;
  }
  const sprite = (material as { isSpriteMaterial?: boolean }).isSpriteMaterial === true;
  const additive = material.blending === AdditiveBlending;
  const tag = `${TAG}:${mode}${sprite ? ':sprite' : ''}${additive ? ':add' : ''}`;
  const end: PatchEnd = { kind: 'colour', mode, additive };
  const before = material.onBeforeCompile;
  const ownKey = Object.prototype.hasOwnProperty.call(material, 'customProgramCacheKey') ? material.customProgramCacheKey : null;
  material.onBeforeCompile = function coverCompile(this: Material, shader: WebGLProgramParametersWithUniforms, renderer: WebGLRenderer): void {
    before.call(this, shader, renderer);
    patchShader(shader, sprite, end, this);
  };
  // three's own key is the hook's source text: the hook being wrapped keeps
  // standing for itself, so two materials that differed before still do.
  // Read when three looks for a program, as the patch is made: the discard's
  // word in it is always the one the patch compiled.
  material.customProgramCacheKey = function coverKey(this: Material): string {
    return `${ownKey ? ownKey.call(this) : before.toString()}|${tag}${discardKey()}`;
  };
  modes.set(material, mode);
  track(material);
  material.needsUpdate = true;
}

/** The two shadow-pass materials every caster shares (`coverShadows`); made when first asked for. */
let shadowPass: { depth: MeshDepthMaterial; distance: MeshDistanceMaterial } | null = null;

/** A shadow pass's material wearing the discard-only patch, noted with the wearers so a discard flip reaches it. */
function coverShadowPass<M extends MeshDepthMaterial | MeshDistanceMaterial>(material: M, name: string): M {
  material.name = name;
  material.onBeforeCompile = (shader) => patchShader(shader, false, { kind: 'shadow' }, null);
  material.customProgramCacheKey = () => `${TAG}:shadow${discardKey()}`;
  // The scene check never sees these (they are no mesh's `material`), and
  // they must never be covered as a colour pass would be.
  exempt.add(material);
  track(material);
  return material;
}

/**
 * Give shadow caster `mesh` the cover in its shadow passes: three draws the
 * key light's and the spot lamps' shadow maps with a depth material and the
 * point lamps' with a distance material, never with the mesh's own, so the
 * colour pass's cover would not reach them and a wall under the fog would
 * still cast its shadow onto a revealed floor. These discard where the fog
 * is total, and do nothing else. The builders call it on every mesh they
 * make cast a shadow; it costs nothing while nothing is fogged.
 */
export function coverShadows(mesh: Mesh): void {
  if (shadowPass === null) {
    shadowPass = {
      // three's own depth material for these passes packs depth the same way.
      depth: coverShadowPass(new MeshDepthMaterial({ depthPacking: RGBADepthPacking }), 'cover-shadow-depth'),
      distance: coverShadowPass(new MeshDistanceMaterial(), 'cover-shadow-distance'),
    };
  }
  mesh.customDepthMaterial = shadowPass.depth;
  mesh.customDistanceMaterial = shadowPass.distance;
}

// ---------------------------------------------------------------------------
// The fog lid
// ---------------------------------------------------------------------------

/** The lid's world x/z varying. */
const LID_XZ = 'vLabLidXZ';

/**
 * How far short of total the lid already stands, so that where the floor's
 * discard and the lid meet — the one computed on the floor's triangles, the
 * other on the lid's — neither leaves a hairline open. Where both are drawn,
 * the floor lies over the lid and wins.
 */
const LID_OVERLAP = 0.02;

/**
 * The fog lid's material (see the module note): the cover colour, exactly as
 * the covered materials and the background come out, where the fog is total
 * (`COVER_TOTAL`, less `LID_OVERLAP`), and nothing anywhere else. Opaque and
 * depth-writing, so what lies under it — the storeys below, seen at a slant
 * through a fogged square of the floor in view — is not drawn there. Exempt
 * from the cover: it is the cover. It shares the cover's uniforms, so it
 * follows the fog with no work of its own; the stage puts it just under the
 * floor in view (`CoverMasks.lid`).
 */
export function createFogLidMaterial(): MeshBasicMaterial {
  const m = new MeshBasicMaterial({ color: 0xffffff, toneMapped: false, fog: false });
  m.name = 'cover-fog-lid';
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, U);
    const vertex = atEndOfMain(shader.vertexShader, `\t${LID_XZ} = ( modelMatrix * vec4( transformed, 1.0 ) ).xz;\n`);
    const lid = /* glsl */ `
	{
		float labCover = labCoverFog * labCoverIn( labCoverFogRect, ${LID_XZ} )
			* texture2D( labCoverFogMap, labCoverUv( labCoverFogRect, ${LID_XZ} ) ).r;
		if ( labCover < ${glf(COVER_TOTAL - LID_OVERLAP)} ) discard;
		gl_FragColor = vec4( linearToOutputTexel( vec4( labCoverColor, 1.0 ) ).rgb, 1.0 );
	}
`;
    const fragment = atEndOfMain(shader.fragmentShader, lid);
    if (vertex === null || fragment === null) return;
    shader.vertexShader = `varying vec2 ${LID_XZ};\n${vertex}`;
    shader.fragmentShader = `${COVER_PARS}varying vec2 ${LID_XZ};\n${fragment}`;
  };
  m.customProgramCacheKey = () => `${TAG}:lid`;
  exempt.add(m);
  return m;
}

/**
 * Draw `material` over the cover, on purpose: what the 2D map draws above its
 * fog (the templates, the ruler, the drafts, pings and the trail). The scene
 * check (`coverScene`) leaves it alone.
 */
export function exemptFromCover(material: Material): void {
  if (modes.has(material)) return;
  exempt.add(material);
}

/**
 * Which masks hide `material` (`CoverMode`), or null when it wears no cover:
 * given here, or worn through another covered material's hook, whose tag its
 * program key then carries.
 */
export function coverModeOf(material: Material): CoverMode | null {
  const known = modes.get(material);
  if (known !== undefined) return known;
  const m = TAG_MODE.exec(material.customProgramCacheKey());
  return m ? (m[1] as CoverMode) : null;
}

/** Materials already found covered (or exempt) by `coverScene`; a material never loses its cover. */
const checked = new WeakSet<Material>();
/** Materials a dev build has already warned about. */
const warned = new WeakSet<Material>();

function ensureCovered(material: Material, holder: Object3D): void {
  if (checked.has(material)) {
    // A wearer disposed since and drawn again is one again (`track`).
    if (!exempt.has(material)) track(material);
    return;
  }
  // Never drawn: nothing to hide (a pick box).
  if (material.visible === false) return;
  if (exempt.has(material)) {
    checked.add(material);
    return;
  }
  if (coverModeOf(material) !== null) {
    track(material);
    checked.add(material);
    return;
  }
  if (import.meta.env.DEV && !warned.has(material)) {
    warned.add(material);
    console.warn(
      `[stage3d] cover: material "${material.name || material.type}" on "${holder.name || holder.type}" was drawn without the fog/shroud cover — covered it now; give it applyCover (or exemptFromCover) where it is made`,
    );
  }
  applyCover(material, 'full');
  if (coverModeOf(material) !== null) checked.add(material);
}

/**
 * Every material under `root` wears the cover or is exempt from it: one that
 * does not is covered now (by both masks), and named in a dev-build warning,
 * once. The stage runs this after each update, before the frame it asks for.
 */
export function coverScene(root: Object3D): void {
  root.traverse((o) => {
    const mat = (o as Object3D & { material?: Material | Material[] }).material;
    if (mat === undefined) return;
    if (Array.isArray(mat)) for (const m of mat) ensureCovered(m, o);
    else ensureCovered(mat, o);
  });
}
