import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const backendRoot = join(__dirname, '../..');

describe('EC2 cost infrastructure guardrails', () => {
  it('includes cloudwatch SDK dependency', () => {
    const pkg = JSON.parse(readFileSync(join(backendRoot, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
    };
    assert.ok(pkg.dependencies['@aws-sdk/client-cloudwatch']);
  });

  it('does not add platform cloudwatch GetMetricData on lambda role', () => {
    const template = readFileSync(join(backendRoot, 'template.yaml'), 'utf8');
    assert.doesNotMatch(template, /cloudwatch:\*/i);
    assert.doesNotMatch(template, /cloudwatch:GetMetricData/i);
  });

  it('does not add EC2 mutation actions to template', () => {
    const template = readFileSync(join(backendRoot, 'template.yaml'), 'utf8');
    assert.doesNotMatch(template, /ec2:StopInstances|ec2:TerminateInstances|ec2:ModifyInstanceAttribute/i);
  });

  it('ec2-cost slice does not use ScanCommand', () => {
    const repoPath = join(backendRoot, 'repositories/dynamodb/dynamodb-ec2-cost-repository.ts');
    const text = readFileSync(repoPath, 'utf8');
    assert.doesNotMatch(text, /ScanCommand/);
    assert.match(text, /QueryCommand/);
  });

  it('performance metrics port exposes no AWS SDK types', () => {
    const text = readFileSync(
      join(backendRoot, 'cloud-intelligence/ec2-cost/ec2-performance-metrics-client.port.ts'),
      'utf8',
    );
    assert.doesNotMatch(text, /@aws-sdk/);
  });

  it('ec2-cost routes do not grant security_admin analysis roles', () => {
    const text = readFileSync(join(backendRoot, 'api/routes/ec2-cost.routes.ts'), 'utf8');
    assert.doesNotMatch(text, /SECURITY_ADMIN/);
  });
});
