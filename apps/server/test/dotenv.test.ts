/**
 * The repo-root `.env` loader.
 *
 * The bug it exists for: `.env` was read by `docker compose` alone, so a GM
 * who set `LLM_BASE_URL` in the documented place and ran `pnpm dev:server`
 * got a Fixer that still reported itself switched off, with nothing to
 * explain why. And the bug it grew out of: for a while there were two env
 * files, and the one a GM edited was not always the one anything read.
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ENV_FILE,
  RETIRED_ENV_FILES,
  envFileFor,
  loadEnvFile,
  parseEnvFile,
  redactUrl,
  retiredEnvFiles,
} from '../src/dotenv.js';

const touched: string[] = [];
function setEnv(key: string, value: string | undefined): void {
  touched.push(key);
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
afterEach(() => {
  for (const k of touched.splice(0)) delete process.env[k];
});

function envFile(body: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'safehouse-env-'));
  const file = join(dir, '.env');
  writeFileSync(file, body, 'utf8');
  return file;
}

describe('parseEnvFile', () => {
  it('reads plain pairs and ignores comments and blanks', () => {
    expect(parseEnvFile('# note\n\nA=1\nB=two\n')).toEqual({ A: '1', B: 'two' });
  });

  it('keeps everything after the first = (URLs carry colons and slashes)', () => {
    expect(parseEnvFile('LLM_BASE_URL=http://127.0.0.1:8080/v1')).toEqual({
      LLM_BASE_URL: 'http://127.0.0.1:8080/v1',
    });
  });

  it('strips one layer of matching quotes and tolerates `export`', () => {
    expect(parseEnvFile('export A="q"\nB=\'s\'\nC="mismatched\n')).toEqual({
      A: 'q',
      B: 's',
      C: '"mismatched',
    });
  });

  it('skips malformed keys rather than importing junk', () => {
    expect(parseEnvFile('=novalue\n1BAD=x\nGOOD=y\n')).toEqual({ GOOD: 'y' });
  });
});

describe('loadEnvFile', () => {
  it('fills variables that are unset', () => {
    setEnv('SAFEHOUSE_TEST_UNSET', undefined);
    const applied = loadEnvFile(envFile('SAFEHOUSE_TEST_UNSET=from-file\n'));
    expect(applied).toContain('SAFEHOUSE_TEST_UNSET');
    expect(process.env['SAFEHOUSE_TEST_UNSET']).toBe('from-file');
  });

  it('never overrides a variable the environment already set', () => {
    // Compose, CI and `LLM_BASE_URL=… pnpm dev:server` must all keep priority.
    setEnv('SAFEHOUSE_TEST_SET', 'from-environment');
    const applied = loadEnvFile(envFile('SAFEHOUSE_TEST_SET=from-file\n'));
    expect(applied).not.toContain('SAFEHOUSE_TEST_SET');
    expect(process.env['SAFEHOUSE_TEST_SET']).toBe('from-environment');
  });

  it('treats an empty value as unset, so a blank line in .env is fillable', () => {
    setEnv('SAFEHOUSE_TEST_BLANK', '');
    loadEnvFile(envFile('SAFEHOUSE_TEST_BLANK=filled\n'));
    expect(process.env['SAFEHOUSE_TEST_BLANK']).toBe('filled');
  });

  it('is silent when the file does not exist', () => {
    expect(loadEnvFile(join(tmpdir(), 'safehouse-absent', '.env'))).toEqual([]);
  });
});

describe('one env file', () => {
  it('is the repo root .env, the same file compose reads on its own', () => {
    expect(ENV_FILE.replace(/\\/g, '/')).toMatch(/\/\.env$/);
    expect(ENV_FILE).not.toMatch(/infra/);
  });

  it('knows where the old second copy lived, so it can be named at boot', () => {
    expect(RETIRED_ENV_FILES.map((f) => f.replace(/\\/g, '/'))).toEqual([
      expect.stringMatching(/\/infra\/\.env$/),
    ]);
  });

  it('reports only the retired files that are actually there', () => {
    const present = envFile('A=1\n');
    const absent = join(tmpdir(), 'safehouse-absent', '.env');
    expect(retiredEnvFiles([absent, present])).toEqual([present]);
    expect(retiredEnvFiles([absent])).toEqual([]);
  });
});

describe('envFileFor', () => {
  it('names the file when it defines the key', () => {
    const file = envFile('LLM_BASE_URL=http://a\n');
    expect(envFileFor('LLM_BASE_URL', file)).toBe(file);
  });

  it('is null when it does not — meaning the value came from the environment', () => {
    expect(envFileFor('LLM_BASE_URL', envFile('OTHER=1\n'))).toBeNull();
    expect(envFileFor('LLM_BASE_URL', join(tmpdir(), 'safehouse-absent', '.env'))).toBeNull();
  });
});

describe('redactUrl', () => {
  it('leaves an ordinary endpoint alone', () => {
    expect(redactUrl('http://127.0.0.1:18020/v1')).toBe('http://127.0.0.1:18020/v1');
    expect(redactUrl('http://host.docker.internal:18020/v1')).toBe(
      'http://host.docker.internal:18020/v1',
    );
  });

  it('strips credentials, because this string goes in a log people paste', () => {
    expect(redactUrl('http://user:secret@box.lan:18020/v1')).toBe('http://***@box.lan:18020/v1');
    expect(redactUrl('http://user:secret@box.lan:18020/v1')).not.toContain('secret');
  });
});
