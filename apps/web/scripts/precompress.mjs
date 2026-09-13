/**
 * Write a `.br` and a `.gz` beside every text file of the web build, so the
 * server hands browsers compressed bytes without compressing on each request
 * (`preCompressed` in apps/server/src/app.ts).
 *
 * Brotli at quality 11 is too slow to run per request and is exactly right
 * once per build: the main bundle and the pdf.js worker are megabytes of
 * JavaScript that shrink to a fraction, and a phone on the table's wifi is
 * the client that feels it. A sibling that would not be meaningfully smaller
 * than its source is not written, and siblings left over from a previous
 * build are removed, so the server never serves a stale variant.
 *
 * Runs at the end of `build`; by hand with `node scripts/precompress.mjs`.
 */
import { existsSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

const DIST = fileURLToPath(new URL('../dist', import.meta.url));
const TEXT = /\.(?:js|mjs|css|html|svg|json|txt|xml|webmanifest|wasm|ttf|otf|pfb)$/u;
/** Below this a response is not worth an encoding (the server's own threshold). */
const MIN_BYTES = 1024;
/** A variant must save at least this share of the source to be worth keeping. */
const MAX_RATIO = 0.9;

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

if (!existsSync(DIST)) {
  console.warn('[precompress] no dist/ to compress — run vite build first');
  process.exit(0);
}

let files = 0;
let before = 0;
let after = 0;
for (const path of walk(DIST)) {
  if (/\.(?:br|gz)$/u.test(path)) {
    if (!existsSync(path.replace(/\.(?:br|gz)$/u, ''))) unlinkSync(path);
    continue;
  }
  for (const ext of ['.br', '.gz']) if (existsSync(path + ext)) unlinkSync(path + ext);
  if (!TEXT.test(path)) continue;
  const source = readFileSync(path);
  if (source.length < MIN_BYTES) continue;
  const br = brotliCompressSync(source, {
    params: {
      [constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MAX_QUALITY,
      [constants.BROTLI_PARAM_SIZE_HINT]: source.length,
    },
  });
  const gz = gzipSync(source, { level: constants.Z_BEST_COMPRESSION });
  if (br.length <= source.length * MAX_RATIO) writeFileSync(`${path}.br`, br);
  if (gz.length <= source.length * MAX_RATIO) writeFileSync(`${path}.gz`, gz);
  files += 1;
  before += source.length;
  after += Math.min(br.length, source.length);
}
const kb = (n) => `${Math.round(n / 1024)} KB`;
console.log(`[precompress] ${files} files, ${kb(before)} → ${kb(after)} brotli`);
