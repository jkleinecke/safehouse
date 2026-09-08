/**
 * The compose stack, guarded (FR11.7 · DESIGN.md §14, §16).
 *
 * Loading the books under Docker used to be three steps: run the seeder on the
 * host against the published Postgres port, then
 * `docker compose cp ./data/files/. app:/data/files`. It needed Node, a repo
 * checkout and host→container networking, and the compose header printed it as
 * the only way. `pnpm docker:seed` replaces all of it.
 *
 * And the file itself used to live in `infra/`, which made Compose read
 * `infra/.env` and never the repo root's, so every command needed `-f` and
 * `--env-file` and a GM who forgot one got a stack configured from a file they
 * were not editing. It lives at the root now, beside the one `.env`.
 *
 * Every assertion below is a way the stack can quietly stop working while
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
 *     seeding image and call it the app;
 *   · a build stamp that stops reaching the image brings back "is this the
 *     latest?" with no way to answer it.
 *
 * Text assertions, deliberately: no YAML parser is in the dependency budget and
 * no test may require Docker (BUILD_CONVENTIONS). The file itself is the
 * artefact a GM runs, so reading it is the honest check.
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = new URL('../../../', import.meta.url);
const read = (relative: string): string =>
  readFileSync(fileURLToPath(new URL(relative, REPO_ROOT)), 'utf8');

const COMPOSE = read('compose.yaml');
const DOCKERFILE = read('infra/Dockerfile');
const DOCKERIGNORE = read('.dockerignore');
const PACKAGE = read('package.json');

/**
 * One top-level service block. Ends at the next line indented two spaces or
 * less — the next service, its leading comment, or a top-level key.
 */
function serviceBlock(name: string): string {
  const lines = COMPOSE.split(/\r?\n/);
  const start = lines.indexOf(`  ${name}:`);
  expect(start, `no \`${name}\` service in compose.yaml`).toBeGreaterThanOrEqual(0);
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
const backup = withoutComments(serviceBlock('backup'));

describe('one compose file, one .env, at the repo root', () => {
  it('is compose.yaml beside .env — not in infra/, where Compose read the wrong env file', () => {
    expect(existsSync(fileURLToPath(new URL('infra/docker-compose.yml', REPO_ROOT)))).toBe(false);
    // Every path in it is root-relative now.
    expect(app).toMatch(/context: \.$/m);
    expect(seed).toMatch(/context: \.$/m);
    expect(app).toMatch(/dockerfile: infra\/Dockerfile/);
    expect(backup).toMatch(/- \.\/infra\/backup\.sh:/);
  });

  it('never tells a GM to type -f or --env-file again', () => {
    expect(COMPOSE).not.toMatch(/-f infra\/docker-compose\.yml/);
    expect(COMPOSE).not.toMatch(/--env-file/);
  });

  it('pins the project name, so the volumes do not follow the folder name', () => {
    // Without this the project is named after the directory, and a rename of
    // the checkout — or the old infra/ location — strands the data.
    expect(COMPOSE).toMatch(/^name: safehouse$/m);
  });

  it('is what the root package scripts run', () => {
    expect(PACKAGE).toMatch(/"docker:up": "node scripts\/docker\.mjs up"/);
    expect(PACKAGE).toMatch(/"docker:status": "node scripts\/docker\.mjs status"/);
    expect(PACKAGE).toMatch(/"docker:seed": "docker compose run --rm --build seed"/);
    expect(PACKAGE).toMatch(/"docker:logs": "docker compose logs -f app"/);
    expect(PACKAGE).toMatch(/"docker:down": "docker compose down"/);
  });
});

describe('the build stamp', () => {
  it('reaches both images as build args, defaulting to `dev`', () => {
    for (const block of [app, seed]) {
      expect(block).toMatch(/SAFEHOUSE_VERSION: \$\{SAFEHOUSE_VERSION:-dev\}/);
      expect(block).toMatch(/SAFEHOUSE_BUILT_AT: \$\{SAFEHOUSE_BUILT_AT:-\}/);
    }
  });

  it('is baked into the SPA at build and into the runtime environment', () => {
    const runtimeAt = DOCKERFILE.indexOf('AS runtime');
    const buildStage = DOCKERFILE.slice(0, DOCKERFILE.indexOf('AS seed'));
    const runtimeStage = DOCKERFILE.slice(runtimeAt);
    expect(buildStage).toMatch(/^ARG SAFEHOUSE_VERSION=dev$/m);
    expect(runtimeStage).toMatch(/^ARG SAFEHOUSE_VERSION=dev$/m);
    expect(runtimeStage).toMatch(/^ENV SAFEHOUSE_VERSION=\$SAFEHOUSE_VERSION SAFEHOUSE_BUILT_AT=\$SAFEHOUSE_BUILT_AT$/m);
    // Declared AFTER the source is copied and BEFORE the build, so a new
    // commit rebuilds the app and never the dependency layer.
    const arg = buildStage.indexOf('ARG SAFEHOUSE_VERSION');
    expect(arg).toBeGreaterThan(buildStage.indexOf('COPY apps/     apps/'));
    expect(arg).toBeLessThan(buildStage.indexOf('RUN pnpm -r --workspace-concurrency=1 build'));
  });
});

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
    expect(seed).toMatch(/- \$\{BOOKS_DIR:-\.\/books\}:\/books:ro$/m);
    // The default is a dedicated folder: `.` here would hand the container
    // the whole checkout.
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
    // `pnpm docker:seed --only SR5` replaces.
    expect(seed).toMatch(
      /entrypoint: \["pnpm", "--filter", "@safehouse\/server", "seed:books", "--dir", "\/books"\]/,
    );
    expect(seed).toMatch(/command: \["--calibrate"\]/);
  });
});

describe('the compose header, which is what a GM copies from', () => {
  it('prints the one command as the way to load the library', () => {
    expect(COMPOSE).toMatch(/pnpm docker:seed/);
    expect(COMPOSE).toMatch(/run --rm --build seed/);
  });

  it('prints the flag and demo forms of the same service', () => {
    expect(COMPOSE).toMatch(/docker:seed --list/);
    expect(COMPOSE).toMatch(/--entrypoint/);
    expect(COMPOSE).toMatch(/pnpm --filter @safehouse\/server seed:demo/);
  });

  it('says where the AI is chosen, because it is not here', () => {
    expect(COMPOSE).toMatch(/Fixer ▸ Which AI/);
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
