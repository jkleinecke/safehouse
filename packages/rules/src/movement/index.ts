/**
 * Movement: where a runner's token may go.
 *
 * Pure grid-space rules, like vision. The server asks them before it stores
 * a player's move, and the canvas asks the same ones while the player drags,
 * so the drag and the drop cannot disagree about where the walls are.
 */
export * from './walk.js';
