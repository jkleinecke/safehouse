/**
 * The 2D stage's labels: pooled pixi `Text`, one per key, in the container
 * the overlay's labels are drawn into — the `LabelSink` the flat overlays
 * write through (`ink.ts`).
 *
 * This is the pool the draw functions in `layers.ts` used to keep for
 * themselves, moved behind the sink so those functions no longer need pixi:
 * the same two styles, the same anchors, created on first sight and destroyed
 * by the sweep of the first draw that no longer puts them.
 */
import { Text, type Container } from 'pixi.js';
import { C } from './colors.js';
import { LabelPool, type InkLabel } from './ink.js';
import { NOTE_FONT_PX, NOTE_LINE_PX } from './notes.js';

export class TextLabels extends LabelPool<Text> {
  /**
   * `layer` is where new labels are added; `pool` is the stage's own map of
   * them, handed in so the stage still destroys what is left on teardown.
   */
  constructor(
    private readonly layer: Container,
    pool?: Map<string, Text>,
  ) {
    super(pool);
  }

  protected create(label: InkLabel): Text {
    const text = new Text({
      text: '',
      style:
        label.look === 'note'
          ? {
              fill: label.color,
              fontSize: NOTE_FONT_PX,
              lineHeight: NOTE_LINE_PX,
              fontFamily: 'Inter, sans-serif',
              wordWrap: true,
              wordWrapWidth: label.wrap ?? 120,
              breakWords: true,
            }
          : {
              fill: label.color,
              fontSize: 12,
              fontFamily: 'Inter, sans-serif',
              stroke: { color: C.ground, width: 3 },
            },
    });
    this.layer.addChild(text);
    return text;
  }

  protected show(text: Text, label: InkLabel): void {
    text.anchor.set(label.anchorX, label.anchorY);
    text.text = label.text;
    text.style.fill = label.color;
    if (label.wrap !== undefined) text.style.wordWrapWidth = label.wrap;
    text.x = label.x;
    text.y = label.y;
  }

  protected drop(text: Text): void {
    text.destroy();
  }
}
