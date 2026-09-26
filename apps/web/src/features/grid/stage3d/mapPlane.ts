/**
 * The scene's background map images (FR9.2) on the 3D map: each one a
 * textured plane lying on the ground floor, under the painted tiles.
 *
 * The same placement as the 2D map (`stage/mapLayer.ts`): the scene's
 * `mapAttachmentIds` carry no layout, so every image is stretched over the
 * calibrated scene rectangle — `cols × rows` squares starting at world px 0
 * in the top-down metrics, which is grid point −offset — and later images lie
 * over earlier ones. The per-image adjustments a scanned map carries in its
 * ref (`../mapImage.ts`) are honoured the same way: a quarter turn about the
 * rectangle's centre with the image's local size transposed so it still fills
 * the rectangle, a crop as a window on the texture, and contrast and
 * brightness applied as the 2D map's colour matrix applies them (brightness,
 * then contrast about mid-grey, on the sRGB values).
 *
 * The planes lie a hair below the ground floor's slab (world3d.ts builds its
 * ground floor 0.02 squares thick, its top at y = 0), so every painted square
 * draws over the map and the map shows wherever the GM has not painted, as in
 * 2D. They are unlit and not tone-mapped — the map is the map, as it was
 * drawn — do not write depth, and are hidden until their image has loaded.
 * A viewer's fog and shroud hide them square by square (`cover.ts`), as the
 * 2D map's cover lies over its image.
 */
import {
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  SRGBColorSpace,
  TextureLoader,
  Vector2,
  type BufferAttribute,
  type Texture,
} from 'three';
import type { Scene } from '@safehouse/contracts';
import { metricsFor } from '../geometry.js';
import { cropPixels, localSizeFor, parseMapImageRef, radians, type MapImageRef } from '../mapImage.js';
import { applyCover } from './cover.js';

/** Options for a `MapPlane`. */
export interface MapPlaneOptions {
  /**
   * Called when an image finishes loading and is shown, so an on-demand
   * renderer draws a frame for it (`Runtime3D.requestRender`).
   */
  onChange?: () => void;
  /** Draw order of the first image; each later one draws one after. Default −1000: before anything else that is see-through. */
  renderOrder?: number;
}

/** The planes' height: just under the ground floor's 0.02-square slab. */
const MAP_Y = -0.021;
/** Anisotropic filtering for a map seen at a slant; three clamps it to what the GPU offers. */
const ANISOTROPY = 8;
/** Shared by every map material, so they compile to one program. */
const PROGRAM_KEY = 'safehouse-map-plane';

/**
 * The adjustment, after the texture is sampled. The texel arrives linear; the
 * 2D map's colour matrix works on sRGB values, so the maths goes back to sRGB
 * for it and returns.
 */
const TONE_GLSL = /* glsl */ `
{
	vec3 mapTone = sRGBTransferOETF( vec4( max( diffuseColor.rgb, vec3( 0.0 ) ), 1.0 ) ).rgb;
	mapTone = ( mapTone * mapGain.y - 0.5 ) * mapGain.x + 0.5;
	diffuseColor.rgb = sRGBTransferEOTF( vec4( clamp( mapTone, 0.0, 1.0 ), 1.0 ) ).rgb;
}`;

interface Entry {
  ref: MapImageRef;
  mesh: Mesh<BufferGeometry, MeshBasicMaterial>;
  /** From the loader at once; its image arrives later (`ready`). */
  texture: Texture;
  ready: boolean;
  /** x: contrast, y: brightness — the shader's `mapGain`. */
  gain: { value: Vector2 };
  /** What the plane was last fitted to, so an unchanged scene rewrites nothing. */
  fitted: string;
  dead: boolean;
}

/** The image's pixel size, once it has one. */
function imageSize(texture: Texture): { width: number; height: number } {
  const img = texture.image as { width?: unknown; height?: unknown } | null | undefined;
  const width = typeof img?.width === 'number' ? img.width : 0;
  const height = typeof img?.height === 'number' ? img.height : 0;
  return { width, height };
}

/**
 * The background map images on the ground floor. Add `group` to the scene
 * and call `update` whenever the scene changes; an image loads once, when its
 * id first appears, and everything else about it is re-fitted in place.
 */
export class MapPlane {
  /** Holds one plane per image, in the scene's order. */
  readonly group = new Group();

  private readonly entries = new Map<string, Entry>();
  private readonly loader = new TextureLoader();
  private readonly onChange: (() => void) | undefined;
  private readonly baseOrder: number;
  /** The scene rectangle in grid units: its top-left corner and size. */
  private rect = { x0: 0, z0: 0, w: 0, h: 0 };
  private disposed = false;

  constructor(options: MapPlaneOptions = {}) {
    this.onChange = options.onChange;
    this.baseOrder = options.renderOrder ?? -1000;
    this.group.name = 'map-plane';
  }

  /**
   * Show `scene`'s map images. New ids load through `urlFor`; ids no longer
   * listed are freed; a changed adjustment, order or grid calibration is
   * re-fitted without a reload. Cheap when nothing changed.
   */
  update(scene: Scene, urlFor: (attachmentId: string) => string): void {
    if (this.disposed) return;
    // One plane per id, in first-listed order, with the last ref listed for
    // it — as the 2D layer keys its sprites.
    const refs = new Map<string, MapImageRef>();
    for (const raw of scene.mapAttachmentIds) {
      const ref = parseMapImageRef(raw);
      refs.set(ref.id, ref);
    }
    for (const [id, entry] of this.entries) {
      if (refs.has(id)) continue;
      this.drop(entry);
      this.entries.delete(id);
    }
    for (const [id, ref] of refs) {
      const entry = this.entries.get(id);
      if (entry !== undefined) entry.ref = ref;
      else this.entries.set(id, this.load(ref, urlFor(id)));
    }

    const m = metricsFor(scene.grid);
    this.rect = { x0: -m.offset.x, z0: -m.offset.y, w: m.cols, h: m.rows };
    let i = 0;
    for (const id of refs.keys()) {
      const entry = this.entries.get(id);
      if (entry === undefined) continue;
      entry.mesh.renderOrder = this.baseOrder + i;
      i += 1;
      this.fit(entry);
    }
  }

  /** Free every plane, material and texture, and take the group out of the scene. */
  dispose(): void {
    this.disposed = true;
    for (const entry of this.entries.values()) this.drop(entry);
    this.entries.clear();
    this.group.removeFromParent();
  }

  private load(ref: MapImageRef, url: string): Entry {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(new Float32Array(12), 3));
    // Image top-left, top-right, bottom-right, bottom-left (the texture is flipped: v = 1 is the top row).
    geometry.setAttribute('uv', new Float32BufferAttribute([0, 1, 1, 1, 1, 0, 0, 0], 2));
    geometry.setIndex([0, 1, 2, 0, 2, 3]);

    const gain = { value: new Vector2(1, 1) };
    const material = new MeshBasicMaterial({
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
      toneMapped: false,
      fog: false,
    });
    material.name = 'map-plane';
    material.onBeforeCompile = (shader) => {
      shader.uniforms.mapGain = gain;
      shader.fragmentShader =
        'uniform vec2 mapGain;\n' +
        shader.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>\n${TONE_GLSL}`);
    };
    material.customProgramCacheKey = () => PROGRAM_KEY;
    // Under the shroud and the fog, as the 2D map's image lies under both:
    // the image is the whole map, unrevealed rooms included.
    applyCover(material, 'full');

    const mesh = new Mesh(geometry, material);
    mesh.name = `map:${ref.id}`;
    mesh.visible = false;
    this.group.add(mesh);

    // The callbacks run after the image arrives, long after `entry` exists.
    const texture = this.loader.load(
      url,
      () => this.loaded(entry),
      undefined,
      () => {
        // A missing or offline attachment: the plane stays hidden, as the 2D
        // map leaves its backdrop showing.
      },
    );
    texture.colorSpace = SRGBColorSpace;
    texture.anisotropy = ANISOTROPY;
    const entry: Entry = { ref, mesh, texture, ready: false, gain, fitted: '', dead: false };
    return entry;
  }

  /** The image is in: give the plane its texture, fit its crop, and show it. */
  private loaded(entry: Entry): void {
    if (entry.dead || this.disposed) return;
    const { mesh, texture } = entry;
    entry.ready = true;
    mesh.material.map = texture;
    mesh.material.needsUpdate = true;
    entry.fitted = '';
    this.fit(entry);
    mesh.visible = true;
    this.onChange?.();
  }

  /**
   * Lay the plane over the scene rectangle with the ref's turn, crop and
   * tone. Rewrites nothing when neither the ref nor the rectangle changed.
   */
  private fit(entry: Entry): void {
    const { ref, mesh, texture } = entry;
    const { x0, z0, w, h } = this.rect;
    const size = entry.ready ? imageSize(texture) : { width: 0, height: 0 };
    const key = [x0, z0, w, h, ref.rotateDeg, ref.contrast, ref.brightness, JSON.stringify(ref.crop), size.width, size.height].join('|');
    if (key === entry.fitted) return;
    entry.fitted = key;

    // The rotated image fills the rectangle: its local size is the
    // rectangle's, transposed for a quarter turn, turned about the centre.
    // Grid y runs south, down the screen in the top view, as the 2D map's y
    // does, so pixi's clockwise rotation is the same formula here.
    const local = localSizeFor(ref.rotateDeg, { width: w, height: h });
    const th = radians(ref.rotateDeg);
    const cos = Math.cos(th);
    const sin = Math.sin(th);
    const cx = x0 + w / 2;
    const cz = z0 + h / 2;
    const hw = local.width / 2;
    const hh = local.height / 2;
    const corners: ReadonlyArray<readonly [number, number]> = [
      [-hw, -hh],
      [hw, -hh],
      [hw, hh],
      [-hw, hh],
    ];
    const pos = mesh.geometry.getAttribute('position') as BufferAttribute;
    corners.forEach(([lx, lz], i) => {
      pos.setXYZ(i, cx + lx * cos - lz * sin, MAP_Y, cz + lx * sin + lz * cos);
    });
    pos.needsUpdate = true;
    mesh.geometry.computeBoundingSphere();

    // The crop, rounded to whole source pixels as the 2D map crops its frame.
    if (size.width > 0 && size.height > 0) {
      const f = cropPixels(ref.crop, size.width, size.height);
      texture.repeat.set(f.width / size.width, f.height / size.height);
      texture.offset.set(f.x / size.width, 1 - (f.y + f.height) / size.height);
    }

    entry.gain.value.set(ref.contrast, ref.brightness);
  }

  private drop(entry: Entry): void {
    entry.dead = true;
    entry.texture.dispose();
    entry.mesh.geometry.dispose();
    entry.mesh.material.dispose();
    entry.mesh.removeFromParent();
  }
}
