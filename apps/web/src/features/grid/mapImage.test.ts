import { describe, expect, it } from 'vitest';
import {
  clampCrop,
  cropPixels,
  cssFilter,
  defaultMapImageRef,
  describeAdjustment,
  formatMapImageRef,
  isFullCrop,
  isIdentityRef,
  localSizeFor,
  mapImageId,
  normalizeRotation,
  parseMapImageRef,
  radians,
} from './mapImage.js';

describe('parse / format', () => {
  it('reads a bare attachment id as the identity adjustment', () => {
    const ref = parseMapImageRef('att_abc');
    expect(ref).toEqual(defaultMapImageRef('att_abc'));
    expect(isIdentityRef(ref)).toBe(true);
    // A scene written before scan controls existed keeps working untouched.
    expect(formatMapImageRef(ref)).toBe('att_abc');
  });

  it('round-trips a full adjustment', () => {
    const ref = {
      id: 'att_abc',
      rotateDeg: 90,
      crop: { x: 0.1, y: 0.05, w: 0.8, h: 0.9 },
      contrast: 1.2,
      brightness: 0.95,
    };
    const encoded = formatMapImageRef(ref);
    expect(encoded).toBe('att_abc#rot=90&crop=0.1,0.05,0.8,0.9&con=1.2&bri=0.95');
    expect(parseMapImageRef(encoded)).toEqual(ref);
  });

  it('omits untouched knobs from the encoding', () => {
    expect(formatMapImageRef({ ...defaultMapImageRef('m1'), rotateDeg: 180 })).toBe('m1#rot=180');
    expect(formatMapImageRef({ ...defaultMapImageRef('m1'), contrast: 1.4 })).toBe('m1#con=1.4');
  });

  it('hands the file route a bare id whatever the ref carries', () => {
    expect(mapImageId('att_abc#rot=90&con=1.2')).toBe('att_abc');
    expect(mapImageId('att_abc')).toBe('att_abc');
  });

  it('survives a mangled fragment rather than blanking the map', () => {
    const ref = parseMapImageRef('att_abc#rot=banana&crop=1,2&con=');
    expect(ref.id).toBe('att_abc');
    expect(ref.rotateDeg).toBe(0);
    expect(ref.crop).toBeNull();
    expect(ref.contrast).toBe(1);
  });
});

describe('normalisation', () => {
  it('snaps rotation to quarter turns inside 0..359', () => {
    expect(normalizeRotation(0)).toBe(0);
    expect(normalizeRotation(91)).toBe(90);
    expect(normalizeRotation(-90)).toBe(270);
    expect(normalizeRotation(450)).toBe(90);
    expect(normalizeRotation(Number.NaN)).toBe(0);
  });

  it('clamps a crop inside the image and keeps it non-degenerate', () => {
    expect(clampCrop({ x: -1, y: 0.5, w: 5, h: 0 })).toEqual({ x: 0, y: 0.5, w: 1, h: 0.02 });
    expect(isFullCrop({ x: 0, y: 0, w: 1, h: 1 })).toBe(true);
    expect(isFullCrop(null)).toBe(true);
    expect(isFullCrop({ x: 0.1, y: 0, w: 0.9, h: 1 })).toBe(false);
  });

  it('clamps contrast and brightness into a sane range', () => {
    const ref = parseMapImageRef('m#con=99&bri=0');
    expect(ref.contrast).toBe(3);
    expect(ref.brightness).toBe(0.1);
  });
});

describe('render maths', () => {
  it('turns a normalised crop into source pixels', () => {
    expect(cropPixels(null, 800, 600)).toEqual({ x: 0, y: 0, width: 800, height: 600 });
    expect(cropPixels({ x: 0.25, y: 0.5, w: 0.5, h: 0.5 }, 800, 600)).toEqual({
      x: 200,
      y: 300,
      width: 400,
      height: 300,
    });
  });

  it('never runs the crop off the end of the source', () => {
    const px = cropPixels({ x: 0.9, y: 0.9, w: 0.9, h: 0.9 }, 100, 100);
    expect(px.x + px.width).toBeLessThanOrEqual(100);
    expect(px.y + px.height).toBeLessThanOrEqual(100);
  });

  it('transposes the local sprite size on a quarter turn', () => {
    const rect = { width: 1280, height: 640 };
    expect(localSizeFor(0, rect)).toEqual({ width: 1280, height: 640 });
    expect(localSizeFor(90, rect)).toEqual({ width: 640, height: 1280 });
    expect(localSizeFor(180, rect)).toEqual({ width: 1280, height: 640 });
    expect(localSizeFor(270, rect)).toEqual({ width: 640, height: 1280 });
    expect(radians(180)).toBeCloseTo(Math.PI, 10);
  });

  it('builds a CSS filter for the panel thumbnail', () => {
    expect(cssFilter(defaultMapImageRef('m'))).toBe('none');
    expect(cssFilter({ ...defaultMapImageRef('m'), contrast: 1.2, brightness: 0.9 })).toBe(
      'contrast(1.2) brightness(0.9)',
    );
  });

  it('summarises an adjustment for the panel row', () => {
    expect(describeAdjustment(defaultMapImageRef('m'))).toBe('as uploaded');
    expect(
      describeAdjustment({
        id: 'm',
        rotateDeg: 90,
        crop: { x: 0.1, y: 0, w: 0.8, h: 1 },
        contrast: 1.2,
        brightness: 1,
      }),
    ).toBe('90°, cropped, contrast 1.2');
  });
});
