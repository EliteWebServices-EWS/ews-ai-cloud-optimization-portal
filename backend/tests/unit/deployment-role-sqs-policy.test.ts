import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const BACKEND_TEMPLATE = path.join(REPO_ROOT, 'backend/template.yaml');
const DEPLOY_SQS_JSON = path.join(
  REPO_ROOT,
  'infrastructure/iam/sisum-backend-deploy-sqs-policy.json',
);
const DEPLOY_POLICY_CFN = path.join(
  REPO_ROOT,
  'infrastructure/backend/deployment-role-audit-policy.yaml',
);
const DEPLOY_DYNAMODB_JSON = path.join(
  REPO_ROOT,
  'infrastructure/iam/sisum-backend-deploy-dynamodb-policy.json',
);

const EC2_INTELLIGENCE_QUEUE_NAME_PATTERN =
  /QueueName:\s*!Sub\s+"(sisum-ec2-intelligence(?:-dlq)?)-\$\{Environment\}"/g;

const QUEUE_ARN_SUFFIX = 'sisum-ec2-intelligence-*';

const REQUIRED_DEPLOY_ACTIONS = [
  'sqs:CreateQueue',
  'sqs:DeleteQueue',
  'sqs:GetQueueAttributes',
  'sqs:SetQueueAttributes',
  'sqs:GetQueueUrl',
  'sqs:TagQueue',
  'sqs:UntagQueue',
  'sqs:ListQueueTags',
] as const;

const DEPLOY_MANAGEMENT_ACTIONS = REQUIRED_DEPLOY_ACTIONS.filter(
  (action) => action !== 'sqs:CreateQueue',
);

function parseJsonPolicy(filePath: string): {
  Statement: Array<{
    Sid?: string;
    Action?: string | string[];
    Resource?: string | string[];
    Condition?: unknown;
  }>;
} {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function manageStatement(document: ReturnType<typeof parseJsonPolicy>) {
  const statement = document.Statement.find(
    (entry) => entry.Sid === 'ManageSisumEc2IntelligenceQueues',
  );
  assert.ok(statement, 'ManageSisumEc2IntelligenceQueues statement is required');
  return statement;
}

function manageActions(document: ReturnType<typeof parseJsonPolicy>): string[] {
  const actions = manageStatement(document).Action;
  return Array.isArray(actions) ? actions : [actions!];
}

function cfnSqsDeploySection(cfnPolicy: string): string {
  return cfnPolicy.slice(
    cfnPolicy.indexOf('ManageSisumEc2IntelligenceQueues'),
    cfnPolicy.indexOf('ManageAuditLambdaExecutionPolicy'),
  );
}

describe('backend deploy role EC2 intelligence SQS policy', () => {
  const templateYaml = readFileSync(BACKEND_TEMPLATE, 'utf8');
  const sqsPolicyJson = readFileSync(DEPLOY_SQS_JSON, 'utf8');
  const cfnPolicy = readFileSync(DEPLOY_POLICY_CFN, 'utf8');
  const dynamodbPolicyJson = readFileSync(DEPLOY_DYNAMODB_JSON, 'utf8');
  const sqsDocument = parseJsonPolicy(DEPLOY_SQS_JSON);
  const sqsSection = cfnSqsDeploySection(cfnPolicy);

  const queueNamePrefixes = [
    ...new Set(
      [...templateYaml.matchAll(EC2_INTELLIGENCE_QUEUE_NAME_PATTERN)].map(
        (match) => match[1]!,
      ),
    ),
  ].sort();

  it('discovers work queue and DLQ name prefixes from backend/template.yaml', () => {
    assert.deepEqual(queueNamePrefixes, ['sisum-ec2-intelligence', 'sisum-ec2-intelligence-dlq']);
  });

  it('grants sqs:CreateQueue on the deployment manage statement', () => {
    assert.ok(manageActions(sqsDocument).includes('sqs:CreateQueue'));
    assert.match(sqsSection, /sqs:CreateQueue/);
  });

  it('scopes CreateQueue to sisum-ec2-intelligence-* queue ARNs in JSON policy', () => {
    const statement = manageStatement(sqsDocument);
    const resources = statement.Resource as string[];
    assert.ok(resources.every((resource) => resource !== '*'));
    assert.ok(
      resources.some((resource) => resource.endsWith(`:${QUEUE_ARN_SUFFIX}`)),
    );
    assert.equal(statement.Condition, undefined);
  });

  it('does not use sqs:QueueName in deployment SQS policies', () => {
    assert.doesNotMatch(sqsPolicyJson, /sqs:QueueName/);
    assert.doesNotMatch(sqsSection, /sqs:QueueName/);
  });

  it('limits deployment queue scope to sisum-ec2-intelligence-* and not unrelated prefixes', () => {
    const jsonResources = manageStatement(sqsDocument).Resource as string[];
    for (const resource of jsonResources) {
      assert.match(resource, /:sisum-ec2-intelligence-\*$/);
      assert.doesNotMatch(resource, /:sisum-(?!ec2-intelligence)/);
    }
    assert.match(
      sqsSection,
      /sqs:\$\{AWS::Region\}:\$\{AWS::AccountId\}:sisum-ec2-intelligence-\*/,
    );
    assert.doesNotMatch(sqsSection, /sisum-ec2-cost/);
    assert.doesNotMatch(sqsSection, /sisum-\*/);
  });

  it('covers work queue and DLQ names under sisum-ec2-intelligence-*', () => {
    const pattern = /^sisum-ec2-intelligence(-dlq)?-production$/;
    assert.ok(pattern.test('sisum-ec2-intelligence-production'));
    assert.ok(pattern.test('sisum-ec2-intelligence-dlq-production'));
    assert.ok(!pattern.test('sisum-other-queue-production'));
  });

  it('does not grant sqs:* in deployment SQS policies', () => {
    assert.doesNotMatch(sqsPolicyJson, /sqs:\*/);
    assert.doesNotMatch(sqsSection, /sqs:\*/);
  });

  it('does not use broad SQS Resource:"*" in deployment policies', () => {
    assert.doesNotMatch(sqsPolicyJson, /"Resource"\s*:\s*"\*"/);
    const resourceStarInSqsSection = /Resource:\s*"\*"/.test(sqsSection);
    assert.equal(resourceStarInSqsSection, false);
  });

  for (const action of DEPLOY_MANAGEMENT_ACTIONS) {
    it(`grants ${action} when required for CloudFormation queue lifecycle`, () => {
      assert.ok(manageActions(sqsDocument).includes(action));
      assert.match(sqsSection, new RegExp(action.replace(':', '\\:')));
    });
  }

  it('does not add Step Functions or EventBridge permissions to deploy SQS policy', () => {
    assert.doesNotMatch(sqsPolicyJson, /states:/);
    assert.doesNotMatch(sqsPolicyJson, /events:/);
    assert.doesNotMatch(sqsSection, /states:/);
    assert.doesNotMatch(sqsSection, /events:/);
  });

  it('leaves DynamoDB deploy JSON unchanged except prior async-jobs table entry', () => {
    assert.match(dynamodbPolicyJson, /sisum-async-jobs-\*/);
    assert.doesNotMatch(dynamodbPolicyJson, /sqs:/);
  });
});

describe('runtime Lambda EC2 intelligence queue IAM (unchanged)', () => {
  const template = readFileSync(BACKEND_TEMPLATE, 'utf8');

  const producerPolicySection = template.slice(
    template.indexOf('SisumEc2IntelligenceQueueSendPolicy'),
    template.indexOf('SisumEc2IntelligenceQueueConsumePolicy'),
  );

  it('grants API Lambda only sqs:SendMessage on the work queue ARN', () => {
    assert.match(producerPolicySection, /sqs:SendMessage/);
    assert.match(producerPolicySection, /Resource: !GetAtt SisumEc2IntelligenceQueue\.Arn/);
    assert.doesNotMatch(producerPolicySection, /sqs:\*/);
  });

  it('does not grant consumer SQS actions on SisumLambdaExecutionRole producer policy', () => {
    assert.doesNotMatch(producerPolicySection, /ReceiveMessage/);
    assert.doesNotMatch(producerPolicySection, /DeleteMessage/);
    assert.doesNotMatch(producerPolicySection, /ChangeMessageVisibility/);
  });

  it('does not grant SQS deployment-management actions on SisumLambdaExecutionRole', () => {
    for (const action of REQUIRED_DEPLOY_ACTIONS) {
      assert.doesNotMatch(producerPolicySection, new RegExp(action.replace(':', '\\:')));
    }
  });
});
