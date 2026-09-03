/**
 * The one-command library load, guarded (FR11.7 · DESIGN.md §14, §16).
 *
 * Loading the books under Docker used to be three steps: run the seeder on the
 * host against the published Postgres port, then
 * `docker compose cp ./data/files/. app:/data/files`. It needed Node, a repo
 * checkout and host→container networking, and the compose header printed it as
 * the only way. `docker compose … run --rm --build seed` replaces all of it.
 *
 * Every assertion below is a way that service can quietly stop working while
 * still parsing as valid YAML — and each failure is silent at exactly the wrong
 * moment, the evening a GM sets the stack up:
 *
 *   · a lost `:ro` makes the owner's shelf writable by a container;
 *   · a `COPY` of a PDF puts purchased books in an image layer (§14.8);
 *   · a mount path or volume name that drifts from `app`'s seeds the library
 *     into a volume nothing serves — the copy step, back from the dead;
 *   · a DATABASE_URL pointed at a published port needs the host→container
 *     forwarding this whole design exists to avoid;
 *   · a dropped profile starts a seeding job on every `up -d`;
 *   · a `seed` stage below `runtime` makes a plain `docker build` produce the
 *     seeding image and call it the app.
 *
 * Text assertions, deliberately: no YAML parser is in the dependency budget and
 * no test may require Docker (BUILD_CONVENTIONS). The file itself is the
 * artefact a GM runs, so reading it is the honest check.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = new URL('../../../', import.meta.url);
const read = (relative: string): string =>
  readFileSync(fileURLToPath(new URL(relative, REPO_ROOT)), 'utf8');

const COMPOSE = read('infra/docker-compose.yml');
const DOCKERFILE = read('infra/Dockerfile');
const DOCKERIGNORE = read('.dockerignore');

/**
 * One top-level service block. Ends at the next line indented two spaces or
 * less — the next service, its leading comment, or a top-level key.
 */
function serviceBlock(name: string): string {
  const lines = COMPOSE.split(/\r?\n/);
  const start = lines.indexOf(`  ${name}:`);
  expect(start, `no \`${name}\` service in infra/docker-compose.yml`).toBeGreaterThanOrEqual(0);
  const body: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trim() === '') continue;
    if (!line.startsWith('    ')) break;
    body.push(line);
  }
  return body.join('\n');
}

/** The same block with its comments removed — for asserting on real keys. */
const withoutComments = (block: string): string =>
  block
    .split('\n')
    .filter((l) => !l.trim().startsWith('#'))
    .join('\n');

const seed = withoutComments(serviceBlock('seed'));
const app = withoutComments(serviceBlock('app'));

describe('the `seed` service', () => {
  it('is behind a profile, so `up -d` never starts a seeding job', () => {
    expect(seed).toMatch(/profiles:\s*\["seed"\]/);
    // And the services that DO belong in `up -d` are not behind one.
    expect(app).not.toMatch(/profiles:/);
    expect(withoutComments(serviceBlock('postgres'))).not.toMatch(/profiles:/);
  });

  it('is a job, not a service: nothing restarts it after it exits', () => {
    expect(seed).not.toMatch(/restart:/);
  });

  it('builds the Dockerfile stage that carries source and tsx', () => {
    expect(seed).toMatch(/dockerfile: infra\/Dockerfile/);
    expect(seed).toMatch(/target: seed/);
    // Its own tag: one image name for two stages would have each clobber the
    // other on every build.
    expect(seed).toMatch(/image: \$\{SEED_IMAGE:-safehouse\/seed:latest\}/);
    expect(app).toMatch(/image: \$\{APP_IMAGE:-safehouse\/app:latest\}/);
  });

  it('mounts the GM’s book folder READ-ONLY, from a host path set once', () => {
    expect(seed).toMatch(/- \$\{BOOKS_DIR:-\.\.\}:\/books:ro$/m);
    // The whole point of the default: relative paths resolve against `infra/`,
    // so `..` is the repo root and `.` would be `infra/` itself.
    expect(seed).not.toMatch(/BOOKS_DIR:-\.\}/);
  });

  it('writes into the same volume, at the same path, that `app` serves from', () => {
    const mount = /^\s*- files:\/data$/m;
    expect(app, '`app` stopped mounting `files` at /data').toMatch(mount);
    expect(seed, 'the seeded PDFs would land where nothing serves them').toMatch(mount);
    // Declared as a named volume, so `docker compose down` cannot eat the
    // library and `cp` is never needed to get files into it.
    expect(COMPOSE).toMatch(/^volumes:\n(?:.*\n)*?  files:$/m);
  });

  it('talks to the `postgres` service over the compose network, not a port', () => {
    const url = /DATABASE_URL: postgres:\/\/[^\n]*@postgres:5432\/[^\n]*/.exec(seed)?.[0];
    expect(url, 'the seeder must not depend on host→container forwarding').toBeTruthy();
    expect(url).not.toMatch(/127\.0\.0\.1|localhost|POSTGRES_PORT/);
    // Same database the app reads, or the shelf seeds into nowhere.
    expect(/DATABASE_URL: (postgres:[^\n]*)/.exec(app)?.[1]).toBe(
      /DATABASE_URL: (postgres:[^\n]*)/.exec(seed)?.[1],
    );
  });

  it('waits for the database to be healthy before it starts', () => {
    expect(seed).toMatch(/depends_on:\n\s+postgres:\n\s+condition: service_healthy/);
  });

  it('seeds the library with calibration by default, and forwards GM flags', () => {
    // The entrypoint carries what must not be retyped; `command` is the part
    // `run --rm seed --only SR5` replaces.
    expect(seed).toMatch(
      /entrypoint: \["pnpm", "--filter", "@safehouse\/server", "seed:books", "--dir", "\/books"\]/,
    );
    expect(seed).toMatch(/command: \["--calibrate"\]/);
  });
});

describe('the compose header, which is what a GM copies from', () => {
  it('prints the one command as the way to load the library', () => {
    expect(COMPOSE).toMatch(/run --rm --build seed/);
    expect(COMPOSE).toMatch(/--env-file \.env/);
  });

  it('prints the flag and demo forms of the same service', () => {
    expect(COMPOSE).toMatch(/run --rm seed --list/);
    expect(COMPOSE).toMatch(/--entrypoint/);
    expect(COMPOSE).toMatch(/pnpm --filter @safehouse\/server seed:demo/);
  });

  it('keeps the host-side path as a note, not as the instructions', () => {
    const header = COMPOSE.slice(0, COMPOSE.indexOf('\nservices:'));
    expect(header).toMatch(/cp \.\/data\/files\/\. app:\/data\/files/);
    // It is no longer the only way in, and the file must not still say so.
    expect(header).not.toMatch(/no way to seed the book library/);
  });
});

describe('the seeding image', () => {
  it('inherits the build stage — the runtime image gains nothing', () => {
    expect(DOCKERFILE).toMatch(/^FROM build AS seed$/m);
  });

  it('keeps `runtime` last, so a bare `docker build` still makes the app', () => {
    const stages = [...DOCKERFILE.matchAll(/^FROM .+ AS (\w+)$/gm)].map((m) => m[1]);
    expect(stages).toContain('seed');
    expect(stages.at(-1)).toBe('runtime');
    // Belt and braces: both services name their stage, so stage order alone
    // can never decide what `app` runs.
    expect(app).toMatch(/target: runtime/);
  });

  it('never copies a book into a layer (§14.8) — they are bind-mounted', () => {
    const copies = DOCKERFILE.split(/\r?\n/).filter((l) => /^(COPY|ADD)\b/.test(l));
    expect(copies.length).toBeGreaterThan(0);
    for (const line of copies) {
      expect(line, 'a rulebook must never enter an image layer').not.toMatch(/\.pdf|\/books|books\//i);
    }
    // Belt and braces again: the build context cannot carry one either.
    expect(DOCKERIGNORE).toMatch(/^\*\.pdf$/m);
  });

  it('runs as the app’s own user, so the file store stays writable', () => {
    const stage = DOCKERFILE.slice(DOCKERFILE.indexOf('FROM build AS seed'));
    // A fresh `files` volume is seeded from whichever container mounts it
    // first, and that can be this one — root ownership there would lock the
    // app (USER node) out of its own uploads.
    expect(stage).toMatch(/chown -R node:node \/data/);
    expect(stage).toMatch(/^USER node$/m);
    // pnpm resolved from a cache `node` can read: a re-download per run would
    // make seeding need the internet (Principle 5).
    expect(stage).toMatch(/COREPACK_HOME=/);
  });
});
