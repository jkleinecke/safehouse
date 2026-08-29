/**
 * The map on the big screen (FR9.20). A thin React lifetime around the
 * read-only stage adapter — mount once, push state, tear down cleanly.
 *
 * Kiosk discipline (FR9.19): the host is `pointer-events: none`, so the
 * canvas's own pan/zoom/drag listeners can never fire. Nothing on this device
 * is a control surface, whatever wanders past the TV and touches it.
 *
 * Six-hour discipline: exactly one stage instance (the pixi ticker inside it is
 * the only ticker on the page), the handle is guarded against post-teardown
 * calls, and the props flowing in are memoised upstream so an idle minute
 * pushes zero updates.
 */
import { useEffect, useRef, useState } from 'react';
import type { Scene, Token } from '@safehouse/contracts';
import { createTvStage, type TvStageHandle } from '../grid/tvStage.js';
import type { TokenBars } from '../grid/types.js';
import { getToken } from '../../api/session.js';

export interface TvStageViewProps {
  scene: Scene;
  tokens: Token[];
  bars: ReadonlyMap<string, TokenBars>;
  actingTokenId: string | null;
  /** GM "focus here" target in grid units, or null (FR9.21). */
  focus?: { x: number; y: number; ts: number } | null;
}

/**
 * Map images and token art come from the authenticated file store. An <img> —
 * and pixi's texture loader — cannot set an Authorization header, so the
 * device token rides as a query parameter, the same iframe-safe path the book
 * reader uses. A display token only ever unlocks player-visible files.
 *
 * `createTvStage` wraps this so pixi is told which parser to use: the URL has
 * no file extension, and pixi picks its texture parser by extension.
 */
function fileUrlWithToken(attachmentId: string): string {
  const token = getToken();
  return `/files/${attachmentId}${token ? `?token=${encodeURIComponent(token)}` : ''}`;
}

export default function TvStageView({
  scene,
  tokens,
  bars,
  actingTokenId,
  focus = null,
}: TvStageViewProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const handleRef = useRef<TvStageHandle | null>(null);
  const [failed, setFailed] = useState(false);

  // Latest props for the mount effect, which deliberately runs once.
  const latest = useRef({ scene, tokens, bars, actingTokenId });
  latest.current = { scene, tokens, bars, actingTokenId };

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;

    void createTvStage({
      host,
      input: latest.current,
      urlFor: fileUrlWithToken,
    })
      .then((handle) => {
        if (cancelled) {
          handle.destroy();
          return;
        }
        handleRef.current = handle;
        handle.update(latest.current);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
      handleRef.current?.destroy();
      handleRef.current = null;
    };
  }, []);

  useEffect(() => {
    handleRef.current?.update({ scene, tokens, bars, actingTokenId });
  }, [scene, tokens, bars, actingTokenId]);

  useEffect(() => {
    if (!focus) return;
    handleRef.current?.centerOn(focus.x, focus.y);
  }, [focus]);

  return (
    <div className="absolute inset-0 overflow-hidden">
      <div ref={hostRef} className="pointer-events-none absolute inset-0" aria-hidden="true" />
      {failed && (
        <div className="absolute inset-0 grid place-items-center">
          <span className="font-label tv-breathe text-2xl tracking-[0.4em] text-warn">
            MAP RENDERER UNAVAILABLE
          </span>
        </div>
      )}
    </div>
  );
}
