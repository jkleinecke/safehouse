/**
 * The harness waits for its port before spawning onto it.
 *
 * The whole e2e stack binds ONE fixed port, so two runs in quick succession
 * overlap: the previous Playwright process has returned, but its server child
 * is still shutting down and still holding :8791. On Windows the new run's
 * boot died with a bare `0xC0000409` and no message anywhere — a failure with
 * nothing to read, which is the worst kind a harness can produce.
 *
 * Tested with real sockets rather than a mock, because the thing being checked
 * IS the socket behaviour: that a refused connection reads as free and an
 * accepted one reads as held.
 *
 * This is a VITEST file living under `e2e/`, which is only safe because
 * `playwright.config.ts` pins `testMatch` to `*.spec.ts`. Playwright's default
 * would take `*.test.ts` too, load vitest inside a Playwright worker, and kill
 * the whole browser run with a message about internal state that names nothing
 * relevant.
 */
import { createServer, type Server } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { portInUse, waitForFreePort } from './harness.js';

let open: Server | null = null;

/** Listen on an ephemeral port and report which one we got. */
function listen(): Promise<{ server: Server; port: number }> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (addr === null || typeof addr === 'string') {
        reject(new Error('no port'));
        return;
      }
      resolve({ server, port: addr.port });
    });
  });
}

const close = (server: Server): Promise<void> =>
  new Promise((resolve) => server.close(() => resolve()));

afterEach(async () => {
  if (open) await close(open);
  open = null;
});

describe('portInUse', () => {
  it('sees a port somebody is listening on', async () => {
    const { server, port } = await listen();
    open = server;
    expect(await portInUse(port)).toBe(true);
  });

  it('sees a free port as free', async () => {
    // Bind one to learn a port number nobody else has, then let it go.
    const { server, port } = await listen();
    await close(server);
    expect(await portInUse(port)).toBe(false);
  });
});

describe('waitForFreePort', () => {
  it('returns at once when nothing holds the port', async () => {
    const { server, port } = await listen();
    await close(server);
    const waited = await waitForFreePort(port, 5_000);
    expect(waited).toBeLessThan(1_000);
  });

  it('waits for a lingering server and then continues', async () => {
    // The real scenario: the previous run's server is still on its way out.
    const { server, port } = await listen();
    open = server;
    setTimeout(() => {
      void close(server).then(() => {
        open = null;
      });
    }, 400);

    const waited = await waitForFreePort(port, 10_000);
    expect(waited).toBeGreaterThanOrEqual(250);
    expect(await portInUse(port)).toBe(false);
  });

  it('gives up with a message that names the port and the way out', async () => {
    // A harness that hangs forever is no better than one that crashes without
    // a word. It has to say which port, and what to do about it.
    const { server, port } = await listen();
    open = server;
    await expect(waitForFreePort(port, 700)).rejects.toThrow(
      new RegExp(`:${port} is still held`),
    );
    await expect(waitForFreePort(port, 700)).rejects.toThrow(/SAFEHOUSE_E2E_PORT/);
  });
});
