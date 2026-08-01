import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

const templatePath = path.join(__dirname, '../../template.yaml');

describe('AWS accounts SAM template', () => {
  const template = readFileSync(templatePath, 'utf8');

  it('defines SisumAwsAccountsTable with gsi1 and gsi2', () => {
    assert.match(template, /SisumAwsAccountsTable:/);
    assert.match(template, /sisum-aws-accounts-\$\{Environment\}/);
    assert.match(template, /AWS_ACCOUNTS_TABLE_NAME/);
    assert.match(template, /AwsAccountsTableName:/);
    assert.match(template, /AwsAccountsTableArn:/);
  });

  it('does not grant dynamodb:Scan on business persistence policy', () => {
    assert.doesNotMatch(template, /dynamodb:Scan/);
    assert.doesNotMatch(template, /dynamodb:\*/);
  });

  it('grants Query on AWS accounts table through SisumBusinessPersistencePolicy', () => {
    const policySection = template.slice(
      template.indexOf('SisumBusinessPersistencePolicy'),
      template.indexOf('SisumHttpApi'),
    );
    assert.match(policySection, /dynamodb:Query/);
    assert.match(policySection, /SisumAwsAccountsTable/);
  });
});
