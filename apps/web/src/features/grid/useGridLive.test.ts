/**
 * The map hearing the server refuse its own drop (`watchServerRefusals`):
 * a player's runner dropped through a wall (`blocked`) is sent home and the
 * player told, once per refusal, and never for a refusal that was already
 * in the store when the map opened.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useLiveStore, type LiveErrorFrame } from '../../live/store.js';
import { watchServerRefusals } from './useGridLive.js';

const refuse = (code: string): void =>
  useLiveStore.getState().handleEphemeral({ type: 'error', payload: { code, message: 'no' }, ephemeral: true });

describe('watchServerRefusals', () => {
  beforeEach(() => useLiveStore.getState().reset());

  it('hears every refusal of its code from now on, and nothing else', () => {
    refuse('blocked'); // before the map opened: not the map's
    const heard = vi.fn<(frame: LiveErrorFrame) => void>();
    const stop = watchServerRefusals('blocked', heard);
    expect(heard).not.toHaveBeenCalled();

    refuse('blocked');
    refuse('forbidden');
    refuse('blocked');
    expect(heard).toHaveBeenCalledTimes(2);
    expect(heard.mock.calls.map(([f]) => f.seq)).toEqual([2, 4]);

    // Other news in the store is not a refusal.
    useLiveStore.getState().handleEphemeral({ type: 'token.dragging', payload: { tokenId: 't', x: 1, y: 1 }, ephemeral: true });
    expect(heard).toHaveBeenCalledTimes(2);

    stop();
    refuse('blocked');
    expect(heard).toHaveBeenCalledTimes(2);
  });

  it('still hears a refusal after the store was reset and its numbering began again', () => {
    const heard = vi.fn<(frame: LiveErrorFrame) => void>();
    const stop = watchServerRefusals('blocked', heard);
    refuse('blocked');
    useLiveStore.getState().reset();
    refuse('blocked');
    expect(heard).toHaveBeenCalledTimes(2);
    stop();
  });
});
