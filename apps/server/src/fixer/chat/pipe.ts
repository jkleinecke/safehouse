/**
 * The chat turn's stream to the browser, read to the end whatever the
 * browser does.
 *
 * The SDK's own pipe waits for "drain" after a full write, and a socket that
 * has gone never drains: the stream stalled, `onEnd` never saved the answer
 * and the run never let go, so the Fixer stayed busy. Here the browser is only
 * a listener — writes stop when it goes, nothing waits on it, and the turn
 * runs on to its save. The GM's Cancel is the one thing that ends a turn early.
 */
import type { ServerResponse } from 'node:http';
import { JsonToSseTransformStream, UI_MESSAGE_STREAM_HEADERS, type UIMessageChunk } from 'ai';

export async function pipeTurnToResponse(
  response: ServerResponse,
  stream: ReadableStream<UIMessageChunk>,
): Promise<void> {
  let open = !response.destroyed;
  const gone = () => {
    open = false;
  };
  response.once('close', gone);
  if (open) response.writeHead(200, UI_MESSAGE_STREAM_HEADERS);
  const reader = stream.pipeThrough(new JsonToSseTransformStream()).getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      // No wait on "drain": a slow browser is buffered (an answer is small), a gone one skipped.
      if (open && !response.destroyed) response.write(value);
    }
  } finally {
    response.off('close', gone);
    if (open && !response.destroyed && !response.writableEnded) response.end();
  }
}
