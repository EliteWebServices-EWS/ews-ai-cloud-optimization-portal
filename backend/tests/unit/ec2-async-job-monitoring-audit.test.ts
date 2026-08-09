import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

import { AUDIT_EVENTS } from '../../audit/audit-events';
import { buildAuditEvent } from '../../audit/audit-console';
import { EC2_ASYNC_JOB_EVENT } from '../../services/ec2-async-job-consumer-service';

const MONITORING_TEMPLATE = path.resolve(
  __dirname,
  '../../../infrastructure/monitoring/template.yaml',
);

describe('EC2 async job monitoring audit alignment', () => {
  const monitoring = readFileSync(MONITORING_TEMPLATE, 'utf8');

  it('uses audit event names that match AUDIT_EVENTS constants', () => {
    const pairs: Array<[string, string]> = [
      ['Ec2AsyncJobsStarted', AUDIT_EVENTS.EC2_ASYNC_JOB_STARTED],
      ['Ec2AsyncJobsSucceeded', AUDIT_EVENTS.EC2_ASYNC_JOB_SUCCEEDED],
      ['Ec2AsyncJobsFailed', AUDIT_EVENTS.EC2_ASYNC_JOB_FAILED],
      ['Ec2AsyncJobRetries', AUDIT_EVENTS.EC2_ASYNC_JOB_RETRYING],
    ];
    for (const [, eventName] of pairs) {
      assert.match(monitoring, new RegExp(eventName.replace('.', '\\.')));
    }
  });

  it('does not duplicate job lifecycle event constant strings', () => {
    assert.equal(EC2_ASYNC_JOB_EVENT.RETRYING, AUDIT_EVENTS.EC2_ASYNC_JOB_RETRYING);
    assert.equal(EC2_ASYNC_JOB_EVENT.SUCCEEDED, AUDIT_EVENTS.EC2_ASYNC_JOB_SUCCEEDED);
    assert.equal(EC2_ASYNC_JOB_EVENT.FAILED, AUDIT_EVENTS.EC2_ASYNC_JOB_FAILED);
    assert.equal(EC2_ASYNC_JOB_EVENT.STARTED, AUDIT_EVENTS.EC2_ASYNC_JOB_STARTED);
  });

  it('does not add high-cardinality metric dimensions in monitoring template', () => {
    assert.doesNotMatch(monitoring, /MetricName:.*jobId/s);
    assert.doesNotMatch(monitoring, /Dimensions:.*tenantId/s);
  });

  it('documents job-level PARTIAL as not currently emitted at terminal completion', () => {
    assert.doesNotMatch(monitoring, /ec2\.async_job_partial/);
  });

  it('metric filters match JSON emitted by writeAuditEvent in consumer logs', () => {
    const sample = buildAuditEvent({
      eventName: AUDIT_EVENTS.EC2_ASYNC_JOB_STARTED,
      outcome: 'started',
      tenantId: 'tenant-a',
      correlationId: 'corr-a',
      requestId: 'req-a',
      actor: {
        authenticated: true,
        userId: 'system:ec2-async-worker',
        email: 'system@sisum.local',
        roles: [],
      },
      resource: { type: 'ec2_async_job', id: 'job-a', accountId: '111122223333' },
    });
    const line = JSON.stringify(sample);
    assert.match(line, /"eventName":"ec2\.async_job_started"/);
    assert.match(monitoring, /\{ \$\.eventName = "ec2\.async_job_started" \}/);
    for (const eventName of [
      AUDIT_EVENTS.EC2_ASYNC_JOB_RETRYING,
      AUDIT_EVENTS.EC2_ASYNC_JOB_SUCCEEDED,
      AUDIT_EVENTS.EC2_ASYNC_JOB_FAILED,
    ]) {
      assert.match(line.replace(sample.eventName, eventName), new RegExp(`"eventName":"${eventName}"`));
      assert.match(monitoring, new RegExp(`\\{ \\$\\.eventName = "${eventName.replace('.', '\\.')}" \\}`));
    }
  });

  it('targets consumer Lambda log group for custom metrics', () => {
    assert.match(
      monitoring,
      /LogGroupName: !Sub "\/aws\/lambda\/\$\{Ec2AnalysisConsumerFunctionName\}"/,
    );
  });
});
