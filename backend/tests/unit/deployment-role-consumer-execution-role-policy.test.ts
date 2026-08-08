import assert from 'node:assert/strict';

import { readFileSync } from 'node:fs';

import path from 'node:path';

import { describe, it } from 'node:test';



const REPO_ROOT = path.resolve(__dirname, '../../..');

const DEPLOY_POLICY_CFN = path.join(

  REPO_ROOT,

  'infrastructure/backend/deployment-role-audit-policy.yaml',

);

const CONSUMER_DEPLOY_JSON = path.join(

  REPO_ROOT,

  'infrastructure/iam/sisum-backend-deploy-consumer-execution-role-policy.json',

);

const BACKEND_TEMPLATE = path.join(REPO_ROOT, 'backend/template.yaml');



const CONSUMER_ROLE_NAME = 'SisumEc2AnalysisConsumerExecutionRole';

const CONSUMER_DEPLOY_POLICY_NAME = 'SisumBackendDeployConsumerExecutionRole';



const ROLE_LIFECYCLE_ACTIONS = [

  'iam:CreateRole',

  'iam:GetRole',

  'iam:DeleteRole',

  'iam:UpdateAssumeRolePolicy',

  'iam:AttachRolePolicy',

  'iam:DetachRolePolicy',

  'iam:ListAttachedRolePolicies',

  'iam:TagRole',

  'iam:UntagRole',

  'iam:ListRoleTags',

] as const;



const INLINE_POLICY_LIFECYCLE_ACTIONS = [

  'iam:PutRolePolicy',

  'iam:GetRolePolicy',

  'iam:DeleteRolePolicy',

  'iam:ListRolePolicies',

] as const;



function consumerDeployPolicySection(cfn: string): string {

  const start = cfn.indexOf(`PolicyName: ${CONSUMER_DEPLOY_POLICY_NAME}`);

  const end = cfn.indexOf('Outputs:');

  assert.ok(start >= 0, 'consumer deploy PolicyName missing from deployment-role-audit-policy.yaml');

  return cfn.slice(start, end >= 0 ? end : undefined);

}



function auditDeployPolicySection(cfn: string): string {

  const start = cfn.indexOf('PolicyName: SisumBackendDeployAuditResources');

  const end = cfn.indexOf(`PolicyName: ${CONSUMER_DEPLOY_POLICY_NAME}`);

  assert.ok(start >= 0 && end > start, 'audit deploy policy section missing');

  return cfn.slice(start, end);

}



describe('SisumBackendDeployRole EC2 consumer execution role IAM', () => {

  const cfn = readFileSync(DEPLOY_POLICY_CFN, 'utf8');

  const json = readFileSync(CONSUMER_DEPLOY_JSON, 'utf8');

  const backendTemplate = readFileSync(BACKEND_TEMPLATE, 'utf8');

  const consumerSection = consumerDeployPolicySection(cfn);

  const auditSection = auditDeployPolicySection(cfn);

  const document = JSON.parse(json) as {
    Version?: string;
    Statement: Array<{
      Sid?: string;

      Action?: string | string[];

      Resource?: string | string[];

      Condition?: Record<string, Record<string, string>>;

    }>;

  };



  it('backend template attaches AWS::IAM::Policy inline policies to consumer role', () => {

    const consumerInlinePolicies = [

      'SisumAuditTablePolicy',

      'SisumBusinessPersistencePolicy',

      'SisumEc2IntelligenceQueueConsumePolicy',

      'SisumStsAssumeRolePolicy',

    ];

    for (const logicalId of consumerInlinePolicies) {

      const block = backendTemplate.slice(

        backendTemplate.indexOf(`${logicalId}:`),

        backendTemplate.indexOf(`${logicalId}:`) + 400,

      );

      assert.match(block, /Type: AWS::IAM::Policy/);

      assert.match(block, new RegExp(`!Ref ${CONSUMER_ROLE_NAME}|${CONSUMER_ROLE_NAME}`));

    }

    const roleBlock = backendTemplate.slice(

      backendTemplate.indexOf(`${CONSUMER_ROLE_NAME}:`),

      backendTemplate.indexOf('SisumEc2IntelligenceQueueConsumePolicy:'),

    );

    assert.match(roleBlock, /Type: AWS::IAM::Role/);

    assert.match(roleBlock, /ManagedPolicyArns:/);

  });



  it('scopes deploy permissions to SisumEc2AnalysisConsumerExecutionRole', () => {

    assert.match(

      consumerSection,

      new RegExp(`role/\\$\\{Ec2AnalysisConsumerExecutionRoleName\\}`),

    );

    assert.match(json, new RegExp(CONSUMER_ROLE_NAME));

    assert.doesNotMatch(consumerSection, /iam:\*/);

    assert.doesNotMatch(json, /iam:\*/);

    assert.doesNotMatch(json, /"Resource": "\*"/);

  });



  it('uses a separate deploy inline policy name from SisumBackendDeployAuditResources', () => {

    assert.match(cfn, new RegExp(`PolicyName: ${CONSUMER_DEPLOY_POLICY_NAME}`));

    assert.match(cfn, /PolicyName: SisumBackendDeployAuditResources/);

    assert.doesNotMatch(auditSection, /Ec2AnalysisConsumerExecutionRoleName/);

    assert.doesNotMatch(auditSection, /iam:GetRole/);

  });



  it('preserves SisumBackendDeployAuditResources DynamoDB and SQS statements', () => {

    assert.match(auditSection, /ManageSisumDynamoDbTables/);

    assert.match(auditSection, /sisum-async-jobs-\*/);

    assert.match(auditSection, /ManageSisumEc2IntelligenceQueues/);

    assert.match(auditSection, /ManageAuditLambdaExecutionPolicy/);

  });



  for (const action of ROLE_LIFECYCLE_ACTIONS) {

    it(`allows ${action} for consumer execution role in consumer deploy CFN`, () => {

      assert.match(consumerSection, new RegExp(action.replace(':', '\\:')));

    });

  }



  for (const action of INLINE_POLICY_LIFECYCLE_ACTIONS) {

    it(`allows ${action} for consumer AWS::IAM::Policy inline lifecycle`, () => {

      assert.match(consumerSection, new RegExp(action.replace(':', '\\:')));

      const inline = document.Statement.find(

        (entry) => entry.Sid === 'ManageSisumEc2AnalysisConsumerExecutionRoleInlinePolicies',

      );

      const actions = inline?.Action;

      const list = Array.isArray(actions) ? actions : actions ? [actions] : [];

      assert.ok(list.includes(action), `JSON missing ${action}`);

    });

  }



  it('allows iam:GetRole and iam:DetachRolePolicy required by failed deployment events', () => {

    const lifecycle = document.Statement.find(

      (entry) => entry.Sid === 'ManageSisumEc2AnalysisConsumerExecutionRole',

    );

    assert.ok(lifecycle?.Action?.includes('iam:GetRole'));

    assert.ok(lifecycle?.Action?.includes('iam:DetachRolePolicy'));

  });



  it('allows iam:PassRole to lambda.amazonaws.com for the consumer role', () => {

    assert.match(consumerSection, /iam:PassRole/);

    assert.match(consumerSection, /iam:PassedToService: lambda\.amazonaws\.com/);

    const pass = document.Statement.find(

      (entry) => entry.Sid === 'PassSisumEc2AnalysisConsumerExecutionRoleToLambda',

    );

    assert.ok(pass?.Action?.includes('iam:PassRole'));

    assert.equal(pass?.Condition?.StringEquals?.['iam:PassedToService'], 'lambda.amazonaws.com');

  });



  it('does not use customer managed policy APIs for consumer runtime inline policies', () => {

    assert.doesNotMatch(consumerSection, /iam:CreatePolicy/);

    assert.doesNotMatch(json, /iam:CreatePolicy/);

  });



  it('does not broaden SisumLambdaExecutionRole runtime permissions in backend template', () => {

    const consumePolicy = backendTemplate.slice(

      backendTemplate.indexOf('SisumEc2IntelligenceQueueConsumePolicy'),

      backendTemplate.indexOf('SisumStsAssumeRolePolicy'),

    );

    assert.doesNotMatch(consumePolicy, /iam:GetRole/);

    assert.doesNotMatch(consumePolicy, /iam:CreateRole/);

  });



  it('parses consumer deploy JSON for manual bootstrap mirror', () => {

    assert.equal(document.Version, '2012-10-17');

    assert.equal(document.Statement.length, 3);

  });

});
