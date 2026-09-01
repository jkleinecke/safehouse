/**
 * §15's "codex editor lazy-loaded" clause, pinned as a source-level rule.
 *
 * The vite build is what actually proves the split, and running it in a unit
 * test would cost ten seconds per run. But the *way* this clause regresses is
 * not subtle and does not need a bundler to catch: someone adds one ordinary
 * `import … from '../codex/…'` to a file the entry chunk already carries — a
 * shell component, a sheet panel, the table log wanting `Markdown.tsx` — and
 * rollup dutifully hoists the whole codex subtree back into the entry, with no
 * error, no warning, and a green suite. This file is the tripwire for exactly
 * that: `features/codex/` may be reached from outside itself ONLY through a
 * dynamic `import()`.
 *
 * The same reasoning is why the Grid's pixi subtree has `useStage.ts`'s
 * docblock and only one `import('./stage/index.js')` in the tree; this is that
 * rule written down as an assertion rather than a comment.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = path.dirname(fileURLToPath(import.meta.url));
/**
 * The route table, which is `routes.tsx` now — `router.tsx` kept only
 * `createBrowserRouter(routes)` so the table could be imported without a DOM
 * (see `components/shell/navigation.test.tsx`, which walks it). The lazy
 * `import()` calls moved with the table, so this tripwire follows them.
 */
const ROUTER = path.join(SRC, 'routes.tsx');

/** Every `.ts`/`.tsx` under `src/`, excluding tests. */
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, out);
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** A static ESM import of `features/codex/…`, by any spelling of the path. */
const STATIC_CODEX =
  /^\s*import\s+(?!type\b)[^;]*?from\s+['"][^'"]*(?:features\/codex|\.\.\/codex)\/[^'"]*['"]/gm;

/** The dynamic form — what we require instead. */
const DYNAMIC_CODEX = /import\(\s*['"][^'"]*features\/codex\/[^'"]*['"]\s*\)/g;

function rel(file: string): string {
  return path.relative(SRC, file).split(path.sep).join('/');
}

describe('the codex feature is a lazy chunk (§15)', () => {
  const codexDir = path.join(SRC, 'features', 'codex');
  const outsiders = sourceFiles(SRC).filter((f) => !f.startsWith(codexDir + path.sep));

  it('is reached from outside itself only through a dynamic import', () => {
    const offenders: string[] = [];
    for (const file of outsiders) {
      const src = fs.readFileSync(file, 'utf8');
      STATIC_CODEX.lastIndex = 0;
      for (const m of src.matchAll(STATIC_CODEX)) offenders.push(`${rel(file)}: ${m[0].trim()}`);
    }
    // A `import type` is erased by tsc and costs the bundle nothing, so the
    // pattern above lets those through deliberately. Anything else is a value
    // import, and one of them is all it takes to un-split the chunk.
    expect(offenders).toEqual([]);
  });

  it('the router lazy-loads all three codex routes', () => {
    const src = fs.readFileSync(ROUTER, 'utf8');
    const dynamic = [...src.matchAll(DYNAMIC_CODEX)].map((m) => m[0]);
    // CodexPage (the /codex + /codex/:pageId editor), CalendarView, and
    // RunsBoard — which lives under features/codex/ and so rides the same
    // chunk whether or not its route looks like a codex one.
    expect(dynamic).toHaveLength(3);
    for (const name of ['CodexPage', 'CalendarView', 'RunsBoard']) {
      expect(src).toMatch(new RegExp(`const ${name} = lazy\\(`));
    }
  });

  it('every lazy route element sits inside a Suspense boundary', () => {
    const src = fs.readFileSync(ROUTER, 'utf8');
    // React.lazy throws a promise on first render; without a boundary above it
    // the whole route tree unmounts to the router's error element instead of
    // showing a spinner. Assert each lazy component is only ever rendered
    // wrapped, so adding a fourth codex route cannot forget the wrapper.
    for (const name of ['CodexPage', 'CalendarView', 'RunsBoard']) {
      const uses = [...src.matchAll(new RegExp(`element: (.*<${name} ?/>.*)`, 'g'))];
      expect(uses.length).toBeGreaterThan(0);
      for (const [, element] of uses) {
        expect(element).toContain(`<Chunk><${name} /></Chunk>`);
      }
    }
  });

  it('the pixi stage is never imported statically (§15)', () => {
    // The pattern this file is copied from, asserted alongside it so the two
    // never drift. The property §15 needs is that NOTHING pulls `stage/` into
    // a static import graph — that is what would drag PixiJS into the initial
    // chunk. The number of dynamic sites is not the property: the Grid loads
    // it on demand and the TV stage does the same, deliberately sharing one
    // renderer, and both stay lazy. Counting sites also miscounts prose,
    // since the docblocks above those calls quote the specifier.
    const stageDir = path.join(SRC, 'features', 'grid', 'stage');
    const offenders: string[] = [];
    let dynamicHits = 0;
    for (const file of sourceFiles(SRC)) {
      if (file.startsWith(stageDir + path.sep)) continue;
      const src = fs.readFileSync(file, 'utf8');
      for (const m of src.matchAll(
        /^\s*import\s+(?!type\b)[^;]*?from\s+['"][^'"]*stage\/index\.js['"]/gm,
      )) {
        offenders.push(`${rel(file)}: ${m[0].trim()}`);
      }
      dynamicHits += [...src.matchAll(/import\(\s*['"][^'"]*stage\/index\.js['"]\s*\)/g)].length;
    }
    expect(offenders).toEqual([]);
    expect(dynamicHits).toBeGreaterThan(0);
  });
});
