#!/usr/bin/env node
/**
 * Sprint 11 hardened DynamoDB migration utility.
 *
 * Imports tenant-scoped persistence records from a JSON export into configured
 * DynamoDB tables. Defaults to conditional insert-only writes; upsert is opt-in.
 * Sensitive field values are never logged.
 *
 * Usage:
 *   npm run migrate:persistence
 *
 * See docs/operations/sprint-11-persistence-migration.md for environment variables.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
} from '@aws-sdk/lib-dynamodb';

import {
  OWNERSHIP_SORT_KEY,
  ownershipPartitionKey,
  tenantPartitionKey,
} from '../database/dynamodb-keys';
import { isConditionalCheckFailure } from '../database/dynamodb-errors';

export type MigrationSection =
  | 'workflows'
  | 'ownership'
  | 'reports'
  | 'learning'
  | 'verifications';

export type MigrationMode = 'insert-only' | 'upsert';

export interface MigrationExport {
  workflows?: Record<string, unknown>[];
  ownership?: Record<string, unknown>[];
  reports?: Record<string, unknown>[];
  learning?: Record<string, unknown>[];
  verifications?: Record<string, unknown>[];
}

export interface SectionWriteCounts {
  inserted: number;
  skippedIdentical: number;
  conflicted: number;
  failed: number;
}

export interface MigrationWriteCounts {
  workflows: SectionWriteCounts;
  ownership: SectionWriteCounts;
  reports: SectionWriteCounts;
  learning: SectionWriteCounts;
  verifications: SectionWriteCounts;
  total: SectionWriteCounts;
}

export interface MigrationConfig {
  sourcePath: string;
  dryRun: boolean;
  mode: MigrationMode;
  environment: string;
  confirmTarget: string | undefined;
  expectedAccountId: string | undefined;
  sourceSha256: string | undefined;
  allowUpsert: boolean;
  onConflict: 'continue' | 'fail';
  region: string;
  endpoint: string | undefined;
  tableNames: Partial<Record<MigrationSection, string>>;
}

export interface RunMigrationOptions {
  config: MigrationConfig;
  exportData: MigrationExport;
  documentClient: DynamoDBDocumentClient;
  getCallerIdentity?: () => Promise<{ Account: string }>;
}

export interface MigrationResult {
  counts: MigrationWriteCounts;
  verificationFailed: boolean;
}

const SECTION_TABLE_ENV: Record<MigrationSection, string> = {
  workflows: 'WORKFLOWS_TABLE_NAME',
  ownership: 'OWNERSHIP_TABLE_NAME',
  reports: 'REPORTS_TABLE_NAME',
  learning: 'LEARNING_TABLE_NAME',
  verifications: 'VERIFICATIONS_TABLE_NAME',
};

const SECTIONS: MigrationSection[] = [
  'workflows',
  'ownership',
  'reports',
  'learning',
  'verifications',
];

const WORKFLOW_STATUSES = new Set([
  'PENDING',
  'RUNNING',
  'COMPLETED',
  'FAILED',
]);

const OWNERSHIP_RESOURCE_TYPES = new Set([
  'WORKFLOW',
  'REPORT',
  'LEARNING',
  'VERIFICATION',
]);

const INSERT_ONLY_CONDITION =
  'attribute_not_exists(pk) AND attribute_not_exists(sk)';

function emptySectionCounts(): SectionWriteCounts {
  return {
    inserted: 0,
    skippedIdentical: 0,
    conflicted: 0,
    failed: 0,
  };
}

function addSectionCounts(
  target: SectionWriteCounts,
  delta: SectionWriteCounts,
): void {
  target.inserted += delta.inserted;
  target.skippedIdentical += delta.skippedIdentical;
  target.conflicted += delta.conflicted;
  target.failed += delta.failed;
}

export function parseBoolean(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === 'true';
}

function parseMigrationMode(value: string | undefined): MigrationMode {
  const normalized = value?.trim().toLowerCase() ?? 'insert-only';
  if (normalized === 'insert-only' || normalized === 'upsert') {
    return normalized;
  }
  throw new Error(
    `MIGRATION_MODE must be "insert-only" or "upsert" (received "${value}").`,
  );
}

function parseOnConflict(value: string | undefined): 'continue' | 'fail' {
  const normalized = value?.trim().toLowerCase() ?? 'continue';
  if (normalized === 'continue' || normalized === 'fail') {
    return normalized;
  }
  throw new Error(
    `MIGRATION_ON_CONFLICT must be "continue" or "fail" (received "${value}").`,
  );
}

export function resolveTableName(
  section: MigrationSection,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const fromEnv = env[SECTION_TABLE_ENV[section]]?.trim();
  return fromEnv && fromEnv.length > 0 ? fromEnv : undefined;
}

export function parseMigrationConfig(
  env: NodeJS.ProcessEnv = process.env,
): MigrationConfig {
  const sourcePath = env.MIGRATION_SOURCE_PATH?.trim();
  if (!sourcePath) {
    throw new Error(
      'MIGRATION_SOURCE_PATH is required (path to JSON export).',
    );
  }

  const dryRun = parseBoolean(env.MIGRATION_DRY_RUN);
  const mode = parseMigrationMode(env.MIGRATION_MODE);
  const environment = env.MIGRATION_ENVIRONMENT?.trim() ?? '';

  if (!dryRun && environment.length === 0) {
    throw new Error(
      'MIGRATION_ENVIRONMENT is required for non-dry-run migrations (e.g. dev, staging, production).',
    );
  }

  const tableNames: Partial<Record<MigrationSection, string>> = {};
  for (const section of SECTIONS) {
    const name = resolveTableName(section, env);
    if (name) {
      tableNames[section] = name;
    }
  }

  return {
    sourcePath,
    dryRun,
    mode,
    environment,
    confirmTarget: env.MIGRATION_CONFIRM_TARGET?.trim(),
    expectedAccountId: env.MIGRATION_EXPECTED_ACCOUNT_ID?.trim(),
    sourceSha256: env.MIGRATION_SOURCE_SHA256?.trim(),
    allowUpsert: parseBoolean(env.MIGRATION_ALLOW_UPSERT),
    onConflict: parseOnConflict(env.MIGRATION_ON_CONFLICT),
    region: env.AWS_REGION?.trim() || 'us-east-1',
    endpoint: env.DYNAMODB_ENDPOINT?.trim(),
    tableNames,
  };
}

export function loadExport(path: string): MigrationExport {
  const raw = readFileSync(path, 'utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Migration export is not valid JSON.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Migration export must be a JSON object.');
  }
  return parsed as MigrationExport;
}

export function computeSourceSha256(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return false;
  }
  const time = Date.parse(value);
  return Number.isFinite(time);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1;
}

function requireStringField(
  item: Record<string, unknown>,
  field: string,
  label: string,
): string {
  const value = item[field];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label}: ${field} must be a non-empty string.`);
  }
  return value.trim();
}

function assertTenantPk(
  pk: string,
  tenantId: string,
  label: string,
): void {
  const expected = tenantPartitionKey(tenantId);
  if (pk !== expected) {
    throw new Error(
      `${label}: tenantId "${tenantId}" does not match pk "${pk}" (expected "${expected}").`,
    );
  }
}

function assertResourceSk(
  sk: string,
  prefix: string,
  resourceId: string,
  idField: string,
  label: string,
): void {
  const expected = `${prefix}#${resourceId}`;
  if (sk !== expected) {
    throw new Error(
      `${label}: ${idField} "${resourceId}" does not match sk "${sk}" (expected "${expected}").`,
    );
  }
}

function validateCommonVersionAndTimestamps(
  item: Record<string, unknown>,
  label: string,
): void {
  if (!isPositiveInteger(item.version)) {
    throw new Error(`${label}: version must be a positive integer.`);
  }
  if (!isIsoTimestamp(item.createdAt)) {
    throw new Error(`${label}: createdAt must be a valid ISO-8601 timestamp.`);
  }
  if (!isIsoTimestamp(item.updatedAt)) {
    throw new Error(`${label}: updatedAt must be a valid ISO-8601 timestamp.`);
  }
}

function validateWorkflowItem(
  item: Record<string, unknown>,
  index: number,
): void {
  const label = `workflows[${index}]`;
  const pk = requireStringField(item, 'pk', label);
  const sk = requireStringField(item, 'sk', label);

  if (!pk.startsWith('TENANT#')) {
    throw new Error(`${label}: pk must start with TENANT#.`);
  }
  if (!sk.startsWith('WORKFLOW#')) {
    throw new Error(`${label}: sk must start with WORKFLOW#.`);
  }

  const tenantId = requireStringField(item, 'tenantId', label);
  const workflowId = requireStringField(item, 'workflowId', label);
  assertTenantPk(pk, tenantId, label);
  assertResourceSk(sk, 'WORKFLOW', workflowId, 'workflowId', label);

  validateCommonVersionAndTimestamps(item, label);

  const status = requireStringField(item, 'status', label);
  if (!WORKFLOW_STATUSES.has(status)) {
    throw new Error(`${label}: unsupported workflow status "${status}".`);
  }

  if (item.entityType !== undefined && item.entityType !== 'WORKFLOW') {
    throw new Error(`${label}: entityType must be WORKFLOW when present.`);
  }
}

function validateReportItem(item: Record<string, unknown>, index: number): void {
  const label = `reports[${index}]`;
  const pk = requireStringField(item, 'pk', label);
  const sk = requireStringField(item, 'sk', label);

  if (!pk.startsWith('TENANT#')) {
    throw new Error(`${label}: pk must start with TENANT#.`);
  }
  if (!sk.startsWith('REPORT#')) {
    throw new Error(`${label}: sk must start with REPORT#.`);
  }

  const tenantId = requireStringField(item, 'tenantId', label);
  const reportId = requireStringField(item, 'reportId', label);
  assertTenantPk(pk, tenantId, label);
  assertResourceSk(sk, 'REPORT', reportId, 'reportId', label);
  validateCommonVersionAndTimestamps(item, label);

  requireStringField(item, 'workflowId', label);
  requireStringField(item, 'reportType', label);
  requireStringField(item, 'status', label);

  if (item.entityType !== undefined && item.entityType !== 'REPORT') {
    throw new Error(`${label}: entityType must be REPORT when present.`);
  }
}

function validateLearningItem(
  item: Record<string, unknown>,
  index: number,
): void {
  const label = `learning[${index}]`;
  const pk = requireStringField(item, 'pk', label);
  const sk = requireStringField(item, 'sk', label);

  if (!pk.startsWith('TENANT#')) {
    throw new Error(`${label}: pk must start with TENANT#.`);
  }
  if (!sk.startsWith('LEARNING#')) {
    throw new Error(`${label}: sk must start with LEARNING#.`);
  }

  const tenantId = requireStringField(item, 'tenantId', label);
  const learningId = requireStringField(item, 'learningId', label);
  assertTenantPk(pk, tenantId, label);
  assertResourceSk(sk, 'LEARNING', learningId, 'learningId', label);
  validateCommonVersionAndTimestamps(item, label);
  requireStringField(item, 'feedbackType', label);

  if (item.entityType !== undefined && item.entityType !== 'LEARNING') {
    throw new Error(`${label}: entityType must be LEARNING when present.`);
  }
}

function validateVerificationItem(
  item: Record<string, unknown>,
  index: number,
): void {
  const label = `verifications[${index}]`;
  const pk = requireStringField(item, 'pk', label);
  const sk = requireStringField(item, 'sk', label);

  if (!pk.startsWith('TENANT#')) {
    throw new Error(`${label}: pk must start with TENANT#.`);
  }
  if (!sk.startsWith('VERIFICATION#')) {
    throw new Error(`${label}: sk must start with VERIFICATION#.`);
  }

  const tenantId = requireStringField(item, 'tenantId', label);
  const verificationId = requireStringField(item, 'verificationId', label);
  assertTenantPk(pk, tenantId, label);
  assertResourceSk(
    sk,
    'VERIFICATION',
    verificationId,
    'verificationId',
    label,
  );
  validateCommonVersionAndTimestamps(item, label);
  requireStringField(item, 'outcome', label);

  if (
    item.entityType !== undefined &&
    item.entityType !== 'VERIFICATION'
  ) {
    throw new Error(`${label}: entityType must be VERIFICATION when present.`);
  }
}

function validateOwnershipItem(
  item: Record<string, unknown>,
  index: number,
): void {
  const label = `ownership[${index}]`;
  const pk = requireStringField(item, 'pk', label);
  const sk = requireStringField(item, 'sk', label);

  if (!pk.startsWith('RESOURCE#')) {
    throw new Error(`${label}: pk must start with RESOURCE#.`);
  }
  if (sk !== OWNERSHIP_SORT_KEY) {
    throw new Error(`${label}: sk must be ${OWNERSHIP_SORT_KEY}.`);
  }

  const resourceType = requireStringField(item, 'resourceType', label);
  const resourceId = requireStringField(item, 'resourceId', label);
  if (!OWNERSHIP_RESOURCE_TYPES.has(resourceType)) {
    throw new Error(`${label}: unsupported resourceType "${resourceType}".`);
  }

  const expectedPk = ownershipPartitionKey(
    resourceType as 'WORKFLOW' | 'REPORT' | 'LEARNING' | 'VERIFICATION',
    resourceId,
  );
  if (pk !== expectedPk) {
    throw new Error(
      `${label}: pk "${pk}" does not match resourceType/resourceId (expected "${expectedPk}").`,
    );
  }

  requireStringField(item, 'ownerTenantId', label);
  validateCommonVersionAndTimestamps(item, label);

  if (item.entityType !== undefined && item.entityType !== 'OWNERSHIP') {
    throw new Error(`${label}: entityType must be OWNERSHIP when present.`);
  }
}

function validateSectionItems(
  section: MigrationSection,
  items: Record<string, unknown>[] | undefined,
): void {
  if (!items || items.length === 0) {
    return;
  }

  if (!Array.isArray(items)) {
    throw new Error(`Migration export section "${section}" must be an array.`);
  }

  items.forEach((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`${section}[${index}] must be an object.`);
    }

    const record = item as Record<string, unknown>;
    if (
      typeof record.pk !== 'string' ||
      typeof record.sk !== 'string' ||
      record.pk.length === 0 ||
      record.sk.length === 0
    ) {
      throw new Error(
        `${section}[${index}]: each item requires non-empty string pk and sk.`,
      );
    }

    switch (section) {
      case 'workflows':
        validateWorkflowItem(record, index);
        break;
      case 'reports':
        validateReportItem(record, index);
        break;
      case 'learning':
        validateLearningItem(record, index);
        break;
      case 'verifications':
        validateVerificationItem(record, index);
        break;
      case 'ownership':
        validateOwnershipItem(record, index);
        break;
      default: {
        const exhaustive: never = section;
        throw new Error(`Unsupported section ${exhaustive as string}.`);
      }
    }
  });
}

export function countExportItems(exportData: MigrationExport): number {
  let total = 0;
  for (const section of SECTIONS) {
    const items = exportData[section];
    if (Array.isArray(items)) {
      total += items.length;
    }
  }
  return total;
}

export function listPresentSections(
  exportData: MigrationExport,
): MigrationSection[] {
  const present: MigrationSection[] = [];
  for (const section of SECTIONS) {
    const items = exportData[section];
    if (Array.isArray(items) && items.length > 0) {
      present.push(section);
    }
  }
  return present;
}

/**
 * Validates export shape and entity keys before any DynamoDB write.
 */
export function validateMigrationExport(exportData: MigrationExport): void {
  for (const section of SECTIONS) {
    if (exportData[section] !== undefined) {
      validateSectionItems(section, exportData[section]);
    }
  }

  const presentSections = listPresentSections(exportData);
  if (presentSections.length === 0) {
    throw new Error(
      'Migration export contains no recognized sections with records (workflows, ownership, reports, learning, verifications).',
    );
  }
}

export function buildConfirmationToken(
  accountId: string,
  region: string,
  tableNames: string[],
): string {
  const sortedTables = tableNames.slice().sort();
  return `${accountId}:${region}:${sortedTables.join(',')}`;
}

function resolveConfiguredTablesForExport(
  config: MigrationConfig,
  presentSections: MigrationSection[],
): string[] {
  const names: string[] = [];
  for (const section of presentSections) {
    const tableName = config.tableNames[section];
    if (!tableName) {
      throw new Error(
        `${SECTION_TABLE_ENV[section]} is required to migrate ${section} records present in the export.`,
      );
    }
    names.push(tableName);
  }
  return names;
}

function assertUpsertAllowed(config: MigrationConfig): void {
  if (config.mode !== 'upsert') {
    return;
  }

  const isProduction =
    config.environment.trim().toLowerCase() === 'production';
  if (isProduction && !config.allowUpsert) {
    throw new Error(
      'Upsert against production requires MIGRATION_ALLOW_UPSERT=true in addition to MIGRATION_MODE=upsert.',
    );
  }
}

function assertProductionConfirmation(
  config: MigrationConfig,
  confirmationToken: string,
): void {
  const isProduction =
    config.environment.trim().toLowerCase() === 'production';
  if (!isProduction) {
    return;
  }

  if (config.confirmTarget !== confirmationToken) {
    throw new Error(
      'Production migration requires MIGRATION_CONFIRM_TARGET to match the printed confirmation token.',
    );
  }
}

function assertSourceChecksum(
  config: MigrationConfig,
  sourceContent: string,
): void {
  if (!config.sourceSha256) {
    return;
  }

  const actual = computeSourceSha256(sourceContent);
  if (actual !== config.sourceSha256.toLowerCase()) {
    throw new Error(
      'Migration source SHA-256 checksum does not match MIGRATION_SOURCE_SHA256.',
    );
  }
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
  }

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(',')}}`;
}

export function itemsDeepEqual(
  left: Record<string, unknown>,
  right: Record<string, unknown>,
): boolean {
  return stableStringify(left) === stableStringify(right);
}

interface TrackedKey {
  section: MigrationSection;
  tableName: string;
  pk: string;
  sk: string;
  outcome: 'inserted' | 'skipped-identical' | 'upserted';
}

async function writeInsertOnlyItem(
  client: DynamoDBDocumentClient,
  tableName: string,
  item: Record<string, unknown>,
): Promise<'inserted' | 'skipped-identical' | 'conflicted' | 'failed'> {
  const pk = item.pk as string;
  const sk = item.sk as string;

  try {
    const existingResponse = await client.send(
      new GetCommand({
        TableName: tableName,
        Key: { pk, sk },
      }),
    );

    const existing = existingResponse.Item as
      | Record<string, unknown>
      | undefined;

    if (existing) {
      if (itemsDeepEqual(existing, item)) {
        return 'skipped-identical';
      }
      return 'conflicted';
    }

    await client.send(
      new PutCommand({
        TableName: tableName,
        Item: item,
        ConditionExpression: INSERT_ONLY_CONDITION,
      }),
    );
    return 'inserted';
  } catch (error) {
    if (isConditionalCheckFailure(error)) {
      try {
        const raced = await client.send(
          new GetCommand({
            TableName: tableName,
            Key: { pk, sk },
          }),
        );
        const existing = raced.Item as Record<string, unknown> | undefined;
        if (existing && itemsDeepEqual(existing, item)) {
          return 'skipped-identical';
        }
        return 'conflicted';
      } catch {
        return 'failed';
      }
    }
    return 'failed';
  }
}

async function writeUpsertItem(
  client: DynamoDBDocumentClient,
  tableName: string,
  item: Record<string, unknown>,
): Promise<'inserted' | 'failed'> {
  try {
    await client.send(
      new PutCommand({
        TableName: tableName,
        Item: item,
      }),
    );
    return 'inserted';
  } catch {
    return 'failed';
  }
}

async function migrateSectionItems(
  client: DynamoDBDocumentClient,
  section: MigrationSection,
  tableName: string,
  items: Record<string, unknown>[] | undefined,
  config: MigrationConfig,
  trackedKeys: TrackedKey[],
): Promise<SectionWriteCounts> {
  const counts = emptySectionCounts();
  if (!items || items.length === 0) {
    return counts;
  }

  for (const item of items) {
    if (config.mode === 'insert-only') {
      const outcome = await writeInsertOnlyItem(client, tableName, item);
      switch (outcome) {
        case 'inserted':
          counts.inserted += 1;
          trackedKeys.push({
            section,
            tableName,
            pk: item.pk as string,
            sk: item.sk as string,
            outcome: 'inserted',
          });
          break;
        case 'skipped-identical':
          counts.skippedIdentical += 1;
          trackedKeys.push({
            section,
            tableName,
            pk: item.pk as string,
            sk: item.sk as string,
            outcome: 'skipped-identical',
          });
          break;
        case 'conflicted':
          counts.conflicted += 1;
          if (config.onConflict === 'fail') {
            throw new Error(
              `Insert-only conflict for ${section} item pk=${item.pk as string} sk=${item.sk as string}.`,
            );
          }
          break;
        case 'failed':
          counts.failed += 1;
          break;
        default: {
          const exhaustive: never = outcome;
          throw new Error(`Unexpected write outcome ${exhaustive as string}.`);
        }
      }
    } else {
      const outcome = await writeUpsertItem(client, tableName, item);
      if (outcome === 'inserted') {
        counts.inserted += 1;
        trackedKeys.push({
          section,
          tableName,
          pk: item.pk as string,
          sk: item.sk as string,
          outcome: 'upserted',
        });
      } else {
        counts.failed += 1;
      }
    }
  }

  return counts;
}

async function verifyWrittenKeys(
  client: DynamoDBDocumentClient,
  trackedKeys: TrackedKey[],
): Promise<boolean> {
  let failures = 0;

  for (const key of trackedKeys) {
    try {
      const response = await client.send(
        new GetCommand({
          TableName: key.tableName,
          Key: { pk: key.pk, sk: key.sk },
        }),
      );
      if (!response.Item) {
        failures += 1;
      }
    } catch {
      failures += 1;
    }
  }

  return failures === 0;
}

function initWriteCounts(): MigrationWriteCounts {
  return {
    workflows: emptySectionCounts(),
    ownership: emptySectionCounts(),
    reports: emptySectionCounts(),
    learning: emptySectionCounts(),
    verifications: emptySectionCounts(),
    total: emptySectionCounts(),
  };
}

export async function runMigration(
  options: RunMigrationOptions,
): Promise<MigrationResult> {
  const { config, exportData, documentClient } = options;
  validateMigrationExport(exportData);

  const presentSections = listPresentSections(exportData);
  const configuredTables = resolveConfiguredTablesForExport(
    config,
    presentSections,
  );

  assertUpsertAllowed(config);

  if (!config.dryRun) {
    const getIdentity =
      options.getCallerIdentity ??
      (async () => {
        const sts = new STSClient({
          region: config.region,
        });
        const response = await sts.send(new GetCallerIdentityCommand({}));
        if (!response.Account) {
          throw new Error('STS GetCallerIdentity did not return an account ID.');
        }
        return { Account: response.Account };
      });

    const identity = await getIdentity();
    const confirmationToken = buildConfirmationToken(
      identity.Account,
      config.region,
      configuredTables,
    );

    console.log(`Migration account: ${identity.Account}`);
    console.log(`Migration region: ${config.region}`);
    console.log(`Migration mode: ${config.mode}`);
    console.log(`Migration environment: ${config.environment}`);
    console.log(`Target tables: ${configuredTables.join(', ')}`);
    console.log(`Confirmation token: ${confirmationToken}`);

    if (
      config.expectedAccountId &&
      identity.Account !== config.expectedAccountId
    ) {
      throw new Error(
        `AWS account ${identity.Account} does not match MIGRATION_EXPECTED_ACCOUNT_ID.`,
      );
    }

    assertProductionConfirmation(config, confirmationToken);

    if (config.sourceSha256) {
      const sourceContent = readFileSync(config.sourcePath, 'utf8');
      assertSourceChecksum(config, sourceContent);
    }
  }

  const counts = initWriteCounts();
  const trackedKeys: TrackedKey[] = [];

  if (config.dryRun) {
    for (const section of presentSections) {
      const items = exportData[section] ?? [];
      const sectionCounts = emptySectionCounts();
      sectionCounts.inserted = items.length;
      counts[section] = sectionCounts;
      addSectionCounts(counts.total, sectionCounts);
      const tableName = config.tableNames[section];
      console.log(
        `[dry-run] Would process ${items.length} ${section} item(s) -> ${tableName ?? 'unknown'}`,
      );
    }
    return { counts, verificationFailed: false };
  }

  for (const section of presentSections) {
    const tableName = config.tableNames[section];
    if (!tableName) {
      throw new Error(
        `${SECTION_TABLE_ENV[section]} is required for ${section} migration.`,
      );
    }

    const sectionCounts = await migrateSectionItems(
      documentClient,
      section,
      tableName,
      exportData[section],
      config,
      trackedKeys,
    );
    counts[section] = sectionCounts;
    addSectionCounts(counts.total, sectionCounts);

    console.log(
      `Migrated ${section}: inserted=${sectionCounts.inserted} skipped-identical=${sectionCounts.skippedIdentical} conflicted=${sectionCounts.conflicted} failed=${sectionCounts.failed} -> ${tableName}`,
    );
  }

  const expectedVerified =
    config.mode === 'insert-only'
      ? counts.total.inserted + counts.total.skippedIdentical
      : counts.total.inserted;

  const verificationOk = await verifyWrittenKeys(documentClient, trackedKeys);
  const countMismatch = trackedKeys.length !== expectedVerified;
  const verificationFailed = !verificationOk || countMismatch;

  if (verificationFailed) {
    console.error(
      `Post-write verification failed (tracked=${trackedKeys.length}, expected=${expectedVerified}, readOk=${verificationOk}).`,
    );
  } else {
    console.log(
      `Post-write verification succeeded for ${trackedKeys.length} key(s).`,
    );
  }

  return { counts, verificationFailed };
}

export function createScriptDocumentClient(
  config: Pick<MigrationConfig, 'region' | 'endpoint'>,
): DynamoDBDocumentClient {
  const client = new DynamoDBClient({
    region: config.region,
    ...(config.endpoint ? { endpoint: config.endpoint } : {}),
  });

  return DynamoDBDocumentClient.from(client, {
    marshallOptions: { removeUndefinedValues: true },
  });
}

async function main(): Promise<void> {
  const config = parseMigrationConfig();
  const exportData = loadExport(config.sourcePath);

  console.log(
    `Starting Sprint 11 migration (dryRun=${config.dryRun}, mode=${config.mode}, environment=${config.environment || 'n/a'}) from ${config.sourcePath}`,
  );

  if (!config.dryRun && config.sourceSha256) {
    const sourceContent = readFileSync(config.sourcePath, 'utf8');
    assertSourceChecksum(config, sourceContent);
  }

  const client = createScriptDocumentClient(config);
  const result = await runMigration({
    config,
    exportData,
    documentClient: client,
  });

  const { total } = result.counts;
  console.log(
    `Migration finished. inserted=${total.inserted} skipped-identical=${total.skippedIdentical} conflicted=${total.conflicted} failed=${total.failed}`,
  );

  if (result.verificationFailed || total.failed > 0) {
    process.exit(1);
  }

  if (
    config.onConflict === 'fail' &&
    config.mode === 'insert-only' &&
    total.conflicted > 0
  ) {
    process.exit(1);
  }
}

function isExecutedDirectly(): boolean {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }

  const normalized = entry.replace(/\\/g, '/');
  return normalized.endsWith('/scripts/migrate-memory-to-dynamodb.ts')
    || normalized.endsWith('migrate-memory-to-dynamodb.ts');
}

if (isExecutedDirectly()) {
  main().catch((error: unknown) => {
    const message =
      error instanceof Error ? error.message : 'Unknown migration failure';
    console.error(`Migration failed: ${message}`);
    process.exit(1);
  });
}
