/**
 * Background map images (FR9.2). Sprites are pooled by attachment id and
 * reused across scene updates; textures come from pixi's Assets cache so
 * re-activating a scene costs no decode.
 *
 * Scanned and photographed maps carry a per-image adjustment (rotate / crop /
 * contrast / brightness) parsed out of the scene's image ref — see
 * `../mapImage.ts` for the encoding and the INTEGRATION note on lifting it to
 * a real contract field.
 */
import {
  Assets,
  ColorMatrixFilter,
  Container,
  Graphics,
  Rectangle,
  Sprite,
  Texture,
  type TextureSource,
} from 'pixi.js';
import { sceneWorldSize, type SceneMetrics } from '../geometry.js';
import {
  cropPixels,
  localSizeFor,
  parseMapImageRef,
  radians,
  type MapImageRef,
} from '../mapImage.js';
import { C } from './colors.js';

interface MapEntry {
  sprite: Sprite;
  ref: MapImageRef;
  /** The uncropped texture from the Assets cache — never destroyed by us. */
  loaded: Texture | null;
  /** The uncropped source, kept so a crop change re-frames without a reload. */
  base: TextureSource | null;
  /** The cropped sub-texture we own (and must free when the crop changes). */
  owned: Texture | null;
  filter: ColorMatrixFilter | null;
}

/**
 * `Scene.mapAttachmentIds` carries no per-image placement, so every image is
 * stretched over the calibrated scene rect and overlays stack in draw order
 * (the building, then the inset). Should the contract ever grow an
 * `{ id, x, y, w, h }` layout, read it here in place of `fitAll` — nothing
 * else in this layer assumes the stretch.
 */
export class MapLayer {
  readonly root = new Container();
  private readonly backdrop = new Graphics();
  private readonly entries = new Map<string, MapEntry>();
  private generation = 0;

  constructor(private urlFor: (attachmentId: string) => string) {
    this.root.eventMode = 'none';
    this.root.addChild(this.backdrop);
  }

  /** Swap the image set; returns immediately, textures stream in. */
  setImages(rawRefs: readonly string[], m: SceneMetrics): void {
    const gen = ++this.generation;
    const refs = rawRefs.map((raw) => parseMapImageRef(raw));
    const wanted = new Set(refs.map((r) => r.id));
    for (const [id, entry] of this.entries) {
      if (wanted.has(id)) continue;
      entry.owned?.destroy(false);
      entry.sprite.destroy();
      this.entries.delete(id);
    }

    for (const ref of refs) {
      const existing = this.entries.get(ref.id);
      if (existing) {
        // Same image, possibly new adjustment — no reload, just re-apply.
        existing.ref = ref;
        this.applyAdjustment(existing);
        continue;
      }
      const sprite = new Sprite();
      sprite.eventMode = 'none';
      sprite.visible = false;
      const entry: MapEntry = { sprite, ref, loaded: null, base: null, owned: null, filter: null };
      this.entries.set(ref.id, entry);
      this.root.addChild(sprite);
      void this.load(entry, gen);
    }
    // Keep draw order = declaration order, backdrop underneath.
    this.root.setChildIndex(this.backdrop, 0);
    for (let i = 0; i < refs.length; i += 1) {
      const ref = refs[i];
      const entry = ref ? this.entries.get(ref.id) : undefined;
      if (entry) this.root.setChildIndex(entry.sprite, i + 1);
    }
    this.fitAll(m, refs.length === 0);
  }

  private async load(entry: MapEntry, gen: number): Promise<void> {
    let texture: Texture | null = null;
    try {
      texture = (await Assets.load<Texture>(this.urlFor(entry.ref.id))) ?? null;
    } catch {
      texture = null; // missing/offline attachment — the backdrop stands in
    }
    if (gen !== this.generation || entry.sprite.destroyed || !texture) return;
    entry.loaded = texture;
    entry.base = texture.source;
    entry.sprite.visible = true;
    this.applyAdjustment(entry);
  }

  private size = { width: 0, height: 0 };

  /** Re-stretch every sprite after a grid recalibration. */
  fitAll(m: SceneMetrics, emptyBackdrop = false): void {
    this.size = sceneWorldSize(m);
    this.backdrop.clear();
    this.backdrop
      .rect(0, 0, this.size.width, this.size.height)
      .fill({ color: emptyBackdrop ? C.deck : C.panel, alpha: 1 });
    for (const entry of this.entries.values()) this.applyAdjustment(entry);
  }

  /**
   * Crop → texture frame, rotate → sprite rotation about the scene centre,
   * contrast/brightness → one pooled ColorMatrixFilter. Cheap enough to run on
   * every calibration change; never runs per frame.
   */
  private applyAdjustment(entry: MapEntry): void {
    const { sprite, ref, base, loaded } = entry;
    if (!base || !loaded || sprite.destroyed) return;

    const frame = cropPixels(ref.crop, base.width, base.height);
    const full =
      frame.x === 0 && frame.y === 0 && frame.width === base.width && frame.height === base.height;
    const previousOwned = entry.owned;
    if (full) {
      entry.owned = null;
      sprite.texture = loaded;
    } else {
      entry.owned = new Texture({
        source: base,
        frame: new Rectangle(frame.x, frame.y, frame.width, frame.height),
      });
      sprite.texture = entry.owned;
    }
    // Our sub-textures are ours to free; the shared source stays in the cache.
    if (previousOwned && previousOwned !== entry.owned) previousOwned.destroy(false);

    if (this.size.width <= 0) return;
    const local = localSizeFor(ref.rotateDeg, this.size);
    sprite.anchor.set(0.5);
    sprite.rotation = radians(ref.rotateDeg);
    sprite.width = local.width;
    sprite.height = local.height;
    sprite.x = this.size.width / 2;
    sprite.y = this.size.height / 2;

    const needsFilter = ref.contrast !== 1 || ref.brightness !== 1;
    if (!needsFilter) {
      sprite.filters = [];
      entry.filter = null;
      return;
    }
    const filter = entry.filter ?? new ColorMatrixFilter();
    filter.reset();
    filter.brightness(ref.brightness, false);
    // pixi's contrast() is an offset: 0 is untouched, so 1.2 → +0.2.
    filter.contrast(ref.contrast - 1, true);
    entry.filter = filter;
    sprite.filters = [filter];
  }

  destroy(): void {
    this.generation += 1;
    for (const entry of this.entries.values()) entry.owned?.destroy(false);
    this.root.destroy({ children: true });
    this.entries.clear();
  }
}
