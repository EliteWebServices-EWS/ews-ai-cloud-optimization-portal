import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const VALIDATION_TEST_PATH = join(
  __dirname,
  '../integration/learning.validation.test.ts',
);

function childTestEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.DYNAMODB_ENDPOINT;
  delete env.DYNAMODB_TABLE_NAME;
  for (const key of Object.keys(env)) {
    if (key.startsWith('NODE_TEST')) {
      delete env[key];
    }
  }
  env.NODE_ENV = 'test';
  env.ENVIRONMENT = 'test';
  env.PERSISTENCE_ENABLED = 'false';
  return env;
}

describe('learning.validation.test.ts safety guards', () => {
  it('does not embed a production table fallback', () => {
    const source = readFileSync(VALIDATION_TEST_PATH, 'utf8');
    assert.doesNotMatch(source, /sisum-learning-production/);
    assert.doesNotMatch(source, /DYNAMODB_TABLE_NAME\s*\|\|/);
    assert.match(source, /const canRun = Boolean\(DYNAMODB_ENDPOINT && TABLE_NAME\)/);
  });

  it('guards every test and cleanup with canRun (no DynamoDB when unset)', () => {
    const source = readFileSync(VALIDATION_TEST_PATH, 'utf8');
    const itBlocks = source.match(/\bit\s*\(/g)?.length ?? 0;
    const skipGuards = source.match(/\{\s*skip:\s*!canRun\s*\}/g)?.length ?? 0;
    assert.equal(skipGuards, itBlocks, 'each it() must use { skip: !canRun }');
    assert.match(source, /if\s*\(\s*!canRun\s*\|\|\s*!TABLE_NAME\s*\)/);
    assert.match(source, /async function cleanupItem\(\)/);
    assert.match(
      source,
      /if\s*\(\s*!canRun\s*\|\|\s*!TABLE_NAME\s*\)\s*\{\s*return;/,
    );
  });

  it('skips deep validation when DYNAMODB_ENDPOINT and DYNAMODB_TABLE_NAME are unset', () => {
    const backendRoot = join(__dirname, '../..');
    const tsxCli = join(backendRoot, 'node_modules/tsx/dist/cli.mjs');

    const output = execFileSync(
      process.execPath,
      [
        tsxCli,
        '--import',
        './tests/test-env-bootstrap.ts',
        '--test',
        'tests/integration/learning.validation.test.ts',
      ],
      {
        cwd: backendRoot,
        env: childTestEnv(),
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );

    assert.match(output, /skipped|Learning table deep validation skipped/i);
    assert.doesNotMatch(output, /ConditionalCheckFailedException/);
    assert.match(output, /skipped 3/);
  });
});