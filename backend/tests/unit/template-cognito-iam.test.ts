import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const templatePath = join(process.cwd(), 'template.yaml');

describe('SAM template — Cognito identity alignment IAM', () => {
  it('grants AdminUpdateUserAttributes on the partition-aware user pool ARN only', () => {
    const template = readFileSync(templatePath, 'utf8');

    const policyBlock = template.slice(
      template.indexOf('SisumCognitoIdentityAlignmentPolicy'),
      template.indexOf('SisumHttpApi'),
    );

    assert.match(policyBlock, /cognito-idp:AdminUpdateUserAttributes/);
    assert.doesNotMatch(policyBlock, /cognito-idp:\*/);
    assert.match(policyBlock, /\$\{AWS::Partition\}/);
    assert.match(policyBlock, /\$\{CognitoUserPoolId\}/);
    assert.match(
      policyBlock,
      /arn:\$\{AWS::Partition\}:cognito-idp:\$\{AWS::Region\}:\$\{AWS::AccountId\}:userpool\/\$\{CognitoUserPoolId\}/,
    );
    assert.doesNotMatch(policyBlock, /Resource:\s"\*"/);
  });
});
