import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

const ROOT = path.join(__dirname, '../..');

const TARGET_FILES = [
  'repositories/dynamodb/dynamodb-aws-account-repository.ts',
  'repositories/mock/mock-aws-account-repository.ts',
  'repositories/models/aws-account-persistence-models.ts',
  'database/aws-account/aws-account-keys.ts',
  'services/aws-account-lifecycle.ts',
  'services/aws-account-repository-factory.ts',
];

const FORBIDDEN = [/ScanCommand/, /dynamodb:Scan/, /dynamodb:\*/];

describe('AWS account onboarding query-only guard', () => {
  const files = TARGET_FILES.map((relative) => path.join(ROOT, relative));

  it('does not introduce ScanCommand or dynamodb:Scan in new AWS account modules', () => {
    for (const file of files) {
      const contents = readFileSync(file, 'utf8');
      for (const pattern of FORBIDDEN) {
        assert.doesNotMatch(
          contents,
          pattern,
          `${file} must remain query-only`,
        );
      }
    }
  });
});
