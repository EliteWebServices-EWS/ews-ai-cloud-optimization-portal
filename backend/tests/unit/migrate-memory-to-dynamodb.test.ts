import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import {
  PutCommand,
  type DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb';

import { FakeDocumentClient } from './support/fake-persistence-table';
import {
  buildConfirmationToken,
  computeSourceSha256,
  loadExport,
  parseMigrationConfig,
  runMigration,
  validateMigrationExport,
  type MigrationConfig,
  type MigrationExport,
} from '../../scripts/migrate-memory-to-dynamodb';

function workflowItem(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    pk: 'TENANT#tenant-a',
    sk: 'WORKFLOW#wf-1',
    entityType: 'WORKFLOW',
    tenantId: 'tenant-a',
    workflowId: 'wf-1',
    status: 'PENDING',
    provider: 'mock',
    version: 1,
    createdAt: '2026-07-22T10:00:00.000Z',
    updatedAt: '2026-07-22T10:00:00.000Z',
    ...overrides,
  };
}

function baseConfig(overrides: Partial<MigrationConfig> = {}): MigrationConfig {
  const dir = mkdtempSync(join(tmpdir(), 'migration-config-'));
  const sourcePath = join(dir, 'export.json');
  writeFileSync(sourcePath, JSON.stringify({ workflows: [workflowItem()] }));

  return {
    sourcePath,
    dryRun: false,
    mode: 'insert-only',
    environment: 'dev',
    confirmTarget: undefined,
    expectedAccountId: undefined,
    sourceSha256: undefined,
    allowUpsert: false,
    onConflict: 'continue',
    region: 'us-east-1',
    endpoint: undefined,
    tableNames: {
      workflows: 'workflows-dev',
    },
    ...overrides,
  };
}

function asDocumentClient(fake: FakeDocumentClient): DynamoDBDocumentClient {
  return fake as unknown as DynamoDBDocumentClient;
}

describe('migrate-memory-to-dynamodb', () => {
  describe('validateMigrationExport', () => {
    it('accepts a valid dry-run export', () => {
      assert.doesNotThrow(() =>
        validateMigrationExport({ workflows: [workflowItem()] }),
      );
    });

    it('rejects malformed section arrays', () => {
      assert.throws(
        () =>
          validateMigrationExport({
            workflows: 'bad' as unknown as Record<string, unknown>[],
          }),
        /must be an array/,
      );
    });

    it('rejects invalid workflow keys', () => {
      assert.throws(
        () =>
          validateMigrationExport({
            workflows: [workflowItem({ pk: 'BAD', sk: 'WORKFLOW#wf-1' })],
          }),
        /pk must start with TENANT#/,
      );
    });

    it('rejects tenant mismatch', () => {
      assert.throws(
        () =>
          validateMigrationExport({
            workflows: [
              workflowItem({ tenantId: 'tenant-b' }),
            ],
          }),
        /does not match pk/,
      );
    });

    it('rejects an export with no recognized sections', () => {
      assert.throws(
        () => validateMigrationExport({}),
        /no recognized sections/,
      );
    });
  });

  describe('runMigration', () => {
    it('performs a valid dry-run without calling STS', async () => {
      const result = await runMigration({
        config: baseConfig({ dryRun: true, environment: 'dev' }),
        exportData: { workflows: [workflowItem(), workflowItem({ workflowId: 'wf-2', sk: 'WORKFLOW#wf-2' })] },
        documentClient: asDocumentClient(new FakeDocumentClient()),
      });

      assert.equal(result.counts.workflows.inserted, 2);
      assert.equal(result.verificationFailed, false);
    });

    it('inserts a new workflow item in insert-only mode', async () => {
      const fake = new FakeDocumentClient();
      const result = await runMigration({
        config: baseConfig(),
        exportData: { workflows: [workflowItem()] },
        documentClient: asDocumentClient(fake),
        getCallerIdentity: async () => ({ Account: '111122223333' }),
      });

      assert.equal(result.counts.workflows.inserted, 1);
      assert.equal(result.counts.workflows.conflicted, 0);
      assert.ok(fake.store.has('TENANT#tenant-a||WORKFLOW#wf-1'));
    });

    it('counts an identical existing workflow as skipped-identical', async () => {
      const fake = new FakeDocumentClient();
      const item = workflowItem();
      await fake.send(
        new PutCommand({
          TableName: 'workflows-dev',
          Item: item,
        }),
      );

      const result = await runMigration({
        config: baseConfig(),
        exportData: { workflows: [item] },
        documentClient: asDocumentClient(fake),
        getCallerIdentity: async () => ({ Account: '111122223333' }),
      });

      assert.equal(result.counts.workflows.skippedIdentical, 1);
      assert.equal(result.counts.workflows.inserted, 0);
      assert.equal(result.counts.workflows.conflicted, 0);
    });

    it('counts a different existing workflow as conflicted in insert-only mode', async () => {
      const fake = new FakeDocumentClient();
      await fake.send(
        new PutCommand({
          TableName: 'workflows-dev',
          Item: workflowItem({ status: 'COMPLETED' }),
        }),
      );

      const result = await runMigration({
        config: baseConfig(),
        exportData: { workflows: [workflowItem({ status: 'PENDING' })] },
        documentClient: asDocumentClient(fake),
        getCallerIdentity: async () => ({ Account: '111122223333' }),
      });

      assert.equal(result.counts.workflows.conflicted, 1);
      assert.equal(result.counts.workflows.inserted, 0);
    });

    it('rejects upsert against production without explicit upsert confirmation', async () => {
      await assert.rejects(
        () =>
          runMigration({
            config: baseConfig({
              mode: 'upsert',
              environment: 'production',
              confirmTarget: buildConfirmationToken(
                '111122223333',
                'us-east-1',
                ['workflows-dev'],
              ),
            }),
            exportData: { workflows: [workflowItem()] },
            documentClient: asDocumentClient(new FakeDocumentClient()),
            getCallerIdentity: async () => ({ Account: '111122223333' }),
          }),
        /MIGRATION_ALLOW_UPSERT=true/,
      );
    });

    it('allows upsert in production when explicitly confirmed', async () => {
      const fake = new FakeDocumentClient();
      const result = await runMigration({
        config: baseConfig({
          mode: 'upsert',
          environment: 'production',
          allowUpsert: true,
          confirmTarget: buildConfirmationToken(
            '111122223333',
            'us-east-1',
            ['workflows-dev'],
          ),
        }),
        exportData: { workflows: [workflowItem()] },
        documentClient: asDocumentClient(fake),
        getCallerIdentity: async () => ({ Account: '111122223333' }),
      });

      assert.equal(result.counts.workflows.inserted, 1);
    });

    it('rejects production migration when confirmation token mismatches', async () => {
      await assert.rejects(
        () =>
          runMigration({
            config: baseConfig({
              environment: 'production',
              confirmTarget: 'wrong-token',
            }),
            exportData: { workflows: [workflowItem()] },
            documentClient: asDocumentClient(new FakeDocumentClient()),
            getCallerIdentity: async () => ({ Account: '111122223333' }),
          }),
        /MIGRATION_CONFIRM_TARGET/,
      );
    });

    it('rejects account mismatch when expected account is configured', async () => {
      await assert.rejects(
        () =>
          runMigration({
            config: baseConfig({ expectedAccountId: '999988887777' }),
            exportData: { workflows: [workflowItem()] },
            documentClient: asDocumentClient(new FakeDocumentClient()),
            getCallerIdentity: async () => ({ Account: '111122223333' }),
          }),
        /does not match MIGRATION_EXPECTED_ACCOUNT_ID/,
      );
    });

    it('rejects checksum mismatch when source hash is configured', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'migration-test-'));
      const path = join(dir, 'export.json');
      writeFileSync(path, JSON.stringify({ workflows: [workflowItem()] }));

      await assert.rejects(
        () =>
          runMigration({
            config: baseConfig({
              sourcePath: path,
              sourceSha256: 'deadbeef',
            }),
            exportData: { workflows: [workflowItem()] },
            documentClient: asDocumentClient(new FakeDocumentClient()),
            getCallerIdentity: async () => ({ Account: '111122223333' }),
          }),
        /checksum does not match/,
      );
    });

    it('verifies written keys after insert-only migration', async () => {
      const fake = new FakeDocumentClient();
      const result = await runMigration({
        config: baseConfig(),
        exportData: { workflows: [workflowItem()] },
        documentClient: asDocumentClient(fake),
        getCallerIdentity: async () => ({ Account: '111122223333' }),
      });

      assert.equal(result.verificationFailed, false);
      assert.ok(fake.store.has('TENANT#tenant-a||WORKFLOW#wf-1'));
    });
  });

  describe('loadExport', () => {
    it('rejects malformed JSON files', () => {
      const dir = mkdtempSync(join(tmpdir(), 'migration-json-'));
      const path = join(dir, 'bad.json');
      writeFileSync(path, '{not-json');

      assert.throws(() => loadExport(path), /not valid JSON/);
    });
  });

  describe('parseMigrationConfig', () => {
    it('defaults to insert-only mode', () => {
      const config = parseMigrationConfig({
        MIGRATION_SOURCE_PATH: './export.json',
        MIGRATION_DRY_RUN: 'true',
      });
      assert.equal(config.mode, 'insert-only');
    });

    it('requires environment for non-dry-run', () => {
      assert.throws(
        () =>
          parseMigrationConfig({
            MIGRATION_SOURCE_PATH: './export.json',
          }),
        /MIGRATION_ENVIRONMENT is required/,
      );
    });
  });

  describe('checksum helper', () => {
    it('computes stable sha256 for export content', () => {
      const content = JSON.stringify({ workflows: [workflowItem()] } as MigrationExport);
      const hash = computeSourceSha256(content);
      assert.match(hash, /^[a-f0-9]{64}$/);
    });
  });
});
