/**
 * A tab left open across a rebuild still runs the old bundle, and the old
 * bundle names its lazy chunks by their old hashes. The server answers those
 * with a 404 (they are gone, and it will not pass index.html off as
 * JavaScript), Vite reports the failed import as `vite:preloadError`, and
 * without this the route that wanted the chunk simply never appears.
 *
 * The fix is the one the GM would reach for: reload, which fetches the new
 * `index.html` (always revalidated) and with it the new names. Once only —
 * if the chunk still fails within the window, the problem is not a stale tab
 * (the server is down, the build is broken), and reloading again would be a
 * loop that hides the error rather than a fix.
 */
const KEY = 'safehouse:stale-chunk-reload';
const WINDOW_MS = 30_000;

type Win = Pick<Window, 'addEventListener' | 'sessionStorage'> & { location: Pick<Location, 'reload'> };

export function reloadOnStaleChunk(win: Win, now: () => number = Date.now): void {
  win.addEventListener('vite:preloadError', (event) => {
    let last = 0;
    try {
      last = Number(win.sessionStorage.getItem(KEY) ?? 0);
    } catch {
      // Storage blocked: fall through with no memory of a previous attempt.
    }
    if (now() - last < WINDOW_MS) return;
    try {
      win.sessionStorage.setItem(KEY, String(now()));
    } catch {
      // Without storage a second failure would reload again; better than never.
    }
    event.preventDefault();
    win.location.reload();
  });
}
