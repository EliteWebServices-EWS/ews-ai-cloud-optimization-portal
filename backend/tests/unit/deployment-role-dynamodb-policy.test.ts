import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const BACKEND_TEMPLATE = path.join(REPO_ROOT, 'backend/template.yaml');
const DEPLOY_POLICY_JSON = path.join(
  REPO_ROOT,
  'infrastructure/iam/sisum-backend-deploy-dynamodb-policy.json',
);
const DEPLOY_POLICY_CFN = path.join(
  REPO_ROOT,
  'infrastructure/backend/deployment-role-audit-policy.yaml',
);

const TABLE_NAME_SUB_PATTERN =
  /TableName:\s*!Sub\s+"(sisum-[\w-]+)-\$\{Environment\}"/g;

function extractBackendTablePrefixes(templateYaml: string): string[] {
  const prefixes = new Set<string>();
  for (const match of templateYaml.matchAll(TABLE_NAME_SUB_PATTERN)) {
    prefixes.add(match[1]!);
  }
  return [...prefixes].sort();
}

function extractTableArnPatternsFromJson(policyJson: string): string[] {
  const document = JSON.parse(policyJson) as {
    Statement: Array<{ Sid?: string; Resource?: string | string[] }>;
  };
  const statement = document.Statement.find(
    (entry) => entry.Sid === 'ManageSisumDynamoDbTables',
  );
  assert.ok(statement, 'ManageSisumDynamoDbTables statement is required');

  const resources = statement.Resource;
  const list = Array.isArray(resources) ? resources : [resources];
  return list.filter((value): value is string => typeof value === 'string');
}

function suffixFromArnPattern(arnPattern: string): string {
  const tableSegment = arnPattern.split(':table/')[1];
  assert.ok(tableSegment, `invalid table ARN pattern: ${arnPattern}`);
  return tableSegment;
}

function policyCoversPrefix(prefix: string, arnPatterns: string[]): boolean {
  const expected = `${prefix}-*`;
  return arnPatterns.some((pattern) => suffixFromArnPattern(pattern) === expected);
}

describe('backend deploy role DynamoDB table policy', () => {
  const templateYaml = readFileSync(BACKEND_TEMPLATE, 'utf8');
  const jsonPolicy = readFileSync(DEPLOY_POLICY_JSON, 'utf8');
  const cfnPolicy = readFileSync(DEPLOY_POLICY_CFN, 'utf8');

  const backendPrefixes = extractBackendTablePrefixes(templateYaml);
  const jsonResources = extractTableArnPatternsFromJson(jsonPolicy);
  const yamlTableSuffixes = [
    ...cfnPolicy.matchAll(/table\/(sisum-[\w-]+-\*)/g),
  ].map((match) => match[1]!);

  it('discovers explicit sisum table prefixes from backend/template.yaml', () => {
    assert.deepEqual(backendPrefixes, [
      'sisum-audit',
      'sisum-aws-accounts',
<<<<<<< HEAD
      'sisum-cost-findings',
=======
      'sisum-cloud-resources',
>>>>>>> origin/main
      'sisum-execution-plans',
      'sisum-invitations',
      'sisum-learning',
      'sisum-memberships',
      'sisum-ownership',
      'sisum-reports',
      'sisum-tenants',
      'sisum-verifications',
      'sisum-workflows',
    ]);
  });

  it('covers every backend table family in the JSON deploy policy', () => {
    for (const prefix of backendPrefixes) {
      assert.ok(
        policyCoversPrefix(prefix, jsonResources),
        `JSON policy missing resource for ${prefix}-*`,
      );
    }
    assert.ok(policyCoversPrefix('sisum-memberships', jsonResources));
    assert.ok(policyCoversPrefix('sisum-invitations', jsonResources));
  });

  it('covers every backend table family in the CloudFormation deploy policy', () => {
    for (const prefix of backendPrefixes) {
      assert.ok(
        yamlTableSuffixes.includes(`${prefix}-*`),
        `CFN policy missing resource for ${prefix}-*`,
      );
    }
  });

  it('does not grant dynamodb:*, wildcard resources, or Scan on table management', () => {
    assert.doesNotMatch(jsonPolicy, /dynamodb:\*/);
    assert.doesNotMatch(cfnPolicy, /dynamodb:\*/);
    assert.doesNotMatch(jsonPolicy, /dynamodb:Scan/);
    assert.doesNotMatch(cfnPolicy, /dynamodb:Scan/);

    const statement = JSON.parse(jsonPolicy).Statement.find(
      (entry: { Sid?: string }) => entry.Sid === 'ManageSisumDynamoDbTables',
    );
    const resources = statement.Resource as string[];
    assert.ok(resources.length > 0);
    assert.ok(resources.every((resource) => resource !== '*'));
    assert.ok(resources.every((resource) => resource.includes(':table/sisum-')));
  });
});
