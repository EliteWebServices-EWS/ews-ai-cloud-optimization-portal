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

  it('injects platform account id for integration trust policy generation on API Lambda', () => {
    const backendSection = template.slice(
      template.indexOf('SisumBackendFunction:'),
      template.indexOf('SisumEc2AnalysisConsumerLogGroup:'),
    );
    assert.match(
      backendSection,
      /SISUM_PLATFORM_AWS_ACCOUNT_ID:\s*!Ref AWS::AccountId/,
    );
    assert.doesNotMatch(backendSection, /739275446782/);
    assert.match(
      backendSection,
      /WORKFLOW_DEMO_REPORTS_ENABLED:\s*!Ref WorkflowDemoReportsEnabled/,
    );
  });

  it('does not inject SISUM_PLATFORM_AWS_ACCOUNT_ID on EC2 analysis consumer Lambda', () => {
    const consumerSection = template.slice(
      template.indexOf('SisumEc2AnalysisConsumerFunction:'),
      template.indexOf('Outputs:'),
    );
    assert.doesNotMatch(consumerSection, /SISUM_PLATFORM_AWS_ACCOUNT_ID/);
  });
});
