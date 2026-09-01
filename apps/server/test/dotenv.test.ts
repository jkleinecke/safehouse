/**
 * The repo-root/infra `.env` loader.
 *
 * The bug it exists for: `.env` was read by `docker compose` alone, so a GM
 * who set `LLM_BASE_URL` in the documented place and ran `pnpm dev:server`
 * got a Fixer that still reported itself switched off, with nothing to
 * explain why.
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadEnvFile, parseEnvFile } from '../src/dotenv.js';

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
