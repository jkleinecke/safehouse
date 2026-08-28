/**
 * Background map images (FR9.2). Sprites are pooled by attachment id and
 * reused across scene updates; textures come from pixi's Assets cache so
 * re-activating a scene costs no decode.
 */
import { Assets, Container, Graphics, Sprite, type Texture } from 'pixi.js';
import { sceneWorldSize, type SceneMetrics } from '../geometry.js';
import { C } from './colors.js';

/**
 * INTEGRATION: `Scene.mapAttachmentIds` has no per-image placement, so every
 * image is stretched over the calibrated scene rect (building + inset overlays
 * stack in draw order). If the scenes agent adds `{ id, x, y, w, h }` layout,
 * read it here instead of `fitAll`.
 */
export class MapLayer {
  readonly root = new Container();
  private readonly backdrop = new Graphics();
  private readonly sprites = new Map<string, Sprite>();
  private generation = 0;

  constructor(private urlFor: (attachmentId: string) => string) {
    this.root.eventMode = 'none';
    this.root.addChild(this.backdrop);
  }

  /** Swap the image set; returns immediately, textures stream in. */
  setImages(ids: readonly string[], m: SceneMetrics): void {
    const gen = ++this.generation;
    const wanted = new Set(ids);
    for (const [id, sprite] of this.sprites) {
      if (wanted.has(id)) continue;
      sprite.destroy();
      this.sprites.delete(id);
    }

    for (const id of ids) {
      if (this.sprites.has(id)) continue;
      const sprite = new Sprite();
      sprite.eventMode = 'none';
      sprite.visible = false;
      this.sprites.set(id, sprite);
      this.root.addChild(sprite);
      void this.load(id, sprite, gen);
    }
    // Keep draw order = declaration order, backdrop underneath.
    this.root.setChildIndex(this.backdrop, 0);
    for (let i = 0; i < ids.length; i += 1) {
      const id = ids[i];
      const sprite = id ? this.sprites.get(id) : undefined;
      if (sprite) this.root.setChildIndex(sprite, i + 1);
    }
    this.fitAll(m, ids.length === 0);
  }

  private async load(id: string, sprite: Sprite, gen: number): Promise<void> {
    let texture: Texture | null = null;
    try {
      texture = (await Assets.load<Texture>(this.urlFor(id))) ?? null;
    } catch {
      texture = null; // missing/offline attachment — the backdrop stands in
    }
    if (gen !== this.generation || sprite.destroyed || !texture) return;
    sprite.texture = texture;
    sprite.visible = true;
    this.applyFit(sprite);
  }

  private size = { width: 0, height: 0 };

  /** Re-stretch every sprite after a grid recalibration. */
  fitAll(m: SceneMetrics, emptyBackdrop = false): void {
    this.size = sceneWorldSize(m);
    this.backdrop.clear();
    this.backdrop
      .rect(0, 0, this.size.width, this.size.height)
      .fill({ color: emptyBackdrop ? C.deck : C.panel, alpha: 1 });
    for (const sprite of this.sprites.values()) this.applyFit(sprite);
  }

  private applyFit(sprite: Sprite): void {
    if (!sprite.texture || this.size.width <= 0) return;
    sprite.x = 0;
    sprite.y = 0;
    sprite.width = this.size.width;
    sprite.height = this.size.height;
  }

  destroy(): void {
    this.generation += 1;
    this.root.destroy({ children: true });
    this.sprites.clear();
  }
}
