#!/usr/bin/env node
/**
 * Sprint 11 DynamoDB migration utility.
 *
 * Imports tenant-scoped persistence records from a JSON export file into the
 * configured DynamoDB tables. Does not depend on integration test harness code.
 *
 * Usage:
 *   export WORKFLOWS_TABLE_NAME=sisum-workflows-dev
 *   export OWNERSHIP_TABLE_NAME=sisum-ownership-dev
 *   export REPORTS_TABLE_NAME=sisum-reports-dev        # optional section
 *   export LEARNING_TABLE_NAME=sisum-learning-dev      # optional section
 *   export VERIFICATIONS_TABLE_NAME=sisum-verifications-dev
 *   export MIGRATION_SOURCE_PATH=./export.json
 *   export MIGRATION_DRY_RUN=true                      # log counts only
 *   export AWS_REGION=us-east-1
 *   export DYNAMODB_ENDPOINT=http://localhost:8000     # optional (DynamoDB Local)
 *
 *   npx tsx backend/scripts/migrate-memory-to-dynamodb.ts
 *
 * Export JSON shape:
 * {
 *   "workflows": [ { "pk": "...", "sk": "...", ... } ],
 *   "ownership": [ ... ],
 *   "reports": [ ... ],
 *   "learning": [ ... ],
 *   "verifications": [ ... ]
 * }
 *
 * Each array item must be a complete DynamoDB item (pk/sk included). Writes are
 * idempotent Put operations (re-run safe). Sensitive field values are never logged.
 */

import { readFileSync } from 'node:fs';
import { BatchWriteCommand, type WriteRequest } from '@aws-sdk/lib-dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

type MigrationSection =
  | 'workflows'
  | 'ownership'
  | 'reports'
  | 'learning'
  | 'verifications';

interface MigrationExport {
  workflows?: Record<string, unknown>[];
  ownership?: Record<string, unknown>[];
  reports?: Record<string, unknown>[];
  learning?: Record<string, unknown>[];
  verifications?: Record<string, unknown>[];
}

const SECTION_TABLE_ENV: Record<MigrationSection, string> = {
  workflows: 'WORKFLOWS_TABLE_NAME',
  ownership: 'OWNERSHIP_TABLE_NAME',
  reports: 'REPORTS_TABLE_NAME',
  learning: 'LEARNING_TABLE_NAME',
  verifications: 'VERIFICATIONS_TABLE_NAME',
};

const MAX_BATCH = 25;
const MAX_RETRIES = 5;

function parseBoolean(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === 'true';
}

function resolveTableName(section: MigrationSection): string | undefined {
  const fromEnv = process.env[SECTION_TABLE_ENV[section]]?.trim();
  return fromEnv && fromEnv.length > 0 ? fromEnv : undefined;
}

function loadExport(path: string): MigrationExport {
  const raw = readFileSync(path, 'utf8');
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Migration export must be a JSON object.');
  }
  return parsed as MigrationExport;
}

function createScriptDocumentClient(): DynamoDBDocumentClient {
  const region = process.env.AWS_REGION?.trim() || 'us-east-1';
  const endpoint = process.env.DYNAMODB_ENDPOINT?.trim();

  const client = new DynamoDBClient({
    region,
    ...(endpoint ? { endpoint } : {}),
  });

  return DynamoDBDocumentClient.from(client, {
    marshallOptions: { removeUndefinedValues: true },
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function writeBatchWithRetry(
  client: DynamoDBDocumentClient,
  tableName: string,
  items: Record<string, unknown>[],
  dryRun: boolean
): Promise<number> {
  if (items.length === 0) {
    return 0;
  }

  if (dryRun) {
    console.log(`[dry-run] Would write ${items.length} item(s) to ${tableName}`);
    return items.length;
  }

  let pending: WriteRequest[] = items.map((Item) => ({
    PutRequest: { Item },
  }));
  let written = 0;

  for (let attempt = 0; attempt <= MAX_RETRIES && pending.length > 0; attempt++) {
    const response = await client.send(
      new BatchWriteCommand({
        RequestItems: {
          [tableName]: pending,
        },
      })
    );

    const unprocessed = response.UnprocessedItems?.[tableName] ?? [];
    written += pending.length - unprocessed.length;
    pending = unprocessed;

    if (pending.length > 0) {
      const delayMs = Math.min(1000, 50 * 2 ** attempt);
      await sleep(delayMs);
    }
  }

  if (pending.length > 0) {
    throw new Error(
      `Failed to write ${pending.length} unprocessed item(s) to ${tableName} after retries.`
    );
  }

  return written;
}

async function migrateSection(
  client: DynamoDBDocumentClient,
  section: MigrationSection,
  items: Record<string, unknown>[] | undefined,
  dryRun: boolean
): Promise<number> {
  if (!items || items.length === 0) {
    return 0;
  }

  const tableName = resolveTableName(section);
  if (!tableName) {
    throw new Error(
      `${SECTION_TABLE_ENV[section]} is required to migrate ${section} records (${items.length} item(s) in export).`
    );
  }

  let migrated = 0;
  for (let index = 0; index < items.length; index += MAX_BATCH) {
    const chunk = items.slice(index, index + MAX_BATCH);
    for (const item of chunk) {
      if (
        typeof item.pk !== 'string' ||
        typeof item.sk !== 'string' ||
        item.pk.length === 0 ||
        item.sk.length === 0
      ) {
        throw new Error(
          `Invalid ${section} item at index ${index}: each item requires string pk and sk.`
        );
      }
    }
    migrated += await writeBatchWithRetry(client, tableName, chunk, dryRun);
  }

  console.log(`Migrated ${section}: ${migrated} item(s) -> ${tableName}`);
  return migrated;
}

async function main(): Promise<void> {
  const sourcePath = process.env.MIGRATION_SOURCE_PATH?.trim();
  const dryRun = parseBoolean(process.env.MIGRATION_DRY_RUN);

  if (!sourcePath) {
    console.error(
      'MIGRATION_SOURCE_PATH is required (path to JSON export). Set MIGRATION_DRY_RUN=true to validate without writing.'
    );
    process.exit(1);
  }

  const exportData = loadExport(sourcePath);
  const client = createScriptDocumentClient();

  console.log(
    `Starting Sprint 11 migration (dryRun=${dryRun}) from ${sourcePath}`
  );

  const sections: MigrationSection[] = [
    'workflows',
    'ownership',
    'reports',
    'learning',
    'verifications',
  ];

  let total = 0;
  for (const section of sections) {
    total += await migrateSection(
      client,
      section,
      exportData[section],
      dryRun
    );
  }

  if (total === 0) {
    console.log('No records found in export sections; nothing to migrate.');
  } else {
    console.log(`Migration finished. Total items processed: ${total}`);
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown migration failure';
  console.error(`Migration failed: ${message}`);
  process.exit(1);
});
