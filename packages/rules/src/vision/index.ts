/**
 * Vision: what can be seen from where, and what it costs to shoot at it.
 *
 * Pure grid-space maths (FR9.16). Knows nothing about pixels, cameras or the
 * isometric projection — turning the map 30 degrees must not change who can
 * shoot whom, which is exactly why this is here and not in the renderer.
 */
export * from './los.js';
export * from './model.js';
export * from './cover.js';
export * from './visible.js';
