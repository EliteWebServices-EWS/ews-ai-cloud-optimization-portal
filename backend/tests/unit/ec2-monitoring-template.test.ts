import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

const MONITORING_TEMPLATE = path.resolve(
  __dirname,
  '../../../infrastructure/monitoring/template.yaml',
);

describe('EC2 async job monitoring stack template', () => {
  const template = readFileSync(MONITORING_TEMPLATE, 'utf8');

  it('declares EC2 consumer, queue, and DLQ parameters', () => {
    assert.match(template, /Ec2AnalysisConsumerFunctionName:/);
    assert.match(template, /Ec2IntelligenceQueueName:/);
    assert.match(template, /Ec2IntelligenceDlqName:/);
    assert.match(template, /Ec2QueueAgeAlarmThresholdSeconds:/);
    assert.match(template, /Ec2JobRetryAlarmThresholdPercent:/);
    assert.match(template, /Ec2ConsumerNearTimeoutThresholdMilliseconds:/);
  });

  it('reuses the existing operations dashboard and alarm topic', () => {
    assert.match(template, /DashboardName: !Sub SISUM-\$\{Environment\}-Operations/);
    assert.match(template, /MonitoringAlarmTopic:/);
    assert.match(template, /Lambda Invocations and Errors/);
    assert.match(template, /Production Alarm Status/);
  });

  it('includes native SQS queue health dashboard metrics', () => {
    assert.match(template, /EC2 Queue Depth/);
    assert.match(template, /ApproximateNumberOfMessagesVisible/);
    assert.match(template, /EC2 Oldest Message Age \(Seconds\)/);
    assert.match(template, /ApproximateAgeOfOldestMessage/);
    assert.match(template, /EC2 DLQ Depth/);
    assert.match(template, /\$\{Ec2IntelligenceQueueName\}/);
    assert.match(template, /\$\{Ec2IntelligenceDlqName\}/);
  });

  it('includes EC2 consumer Lambda infrastructure metrics', () => {
    assert.match(template, /EC2 Consumer Lambda Errors and Throttles/);
    assert.match(template, /EC2 Consumer Lambda Duration and Concurrency/);
    assert.match(template, /\$\{Ec2AnalysisConsumerFunctionName\}/);
    assert.match(template, /ConcurrentExecutions/);
    assert.doesNotMatch(template, /sisum-backend-\$\{Environment\}.*EC2 Consumer/s);
  });

  it('uses truthful success metric math and retry intensity labeling', () => {
    assert.match(template, /IF\(m2\+m3>0,100\*m2\/\(m2\+m3\),0\)/);
    assert.doesNotMatch(template, /IF\(m2\+m3>0,100\*m2\/\(m2\+m3\),100\)/);
    assert.match(template, /EC2 Retry Intensity \(retries per 100 starts\)/);
    assert.match(template, /terminal jobs only/);
    assert.match(template, /RetryIntensityPer100Starts/);
  });

  it('uses Maximum statistic for consumer ConcurrentExecutions', () => {
    const block = template.slice(
      template.indexOf('EC2 Consumer Lambda Duration and Concurrency'),
      template.indexOf('EC2 Job Success Rate'),
    );
    assert.match(block, /ConcurrentExecutions/);
    assert.match(block, /"stat": "Maximum"/);
  });

  it('includes business job success and retry intensity widgets', () => {
    assert.match(template, /EC2 Job Success Rate % \(terminal jobs only\)/);
    assert.match(template, /EC2 Retry Intensity \(retries per 100 starts\)/);
    assert.match(template, /SISUM\/EC2AsyncJobs/);
    assert.match(template, /Ec2AsyncJobsSucceeded/);
    assert.match(template, /Ec2AsyncJobRetries/);
  });

  it('defines log metric filters on authoritative audit event names', () => {
    assert.match(template, /ec2\.async_job_started/);
    assert.match(template, /ec2\.async_job_succeeded/);
    assert.match(template, /ec2\.async_job_failed/);
    assert.match(template, /ec2\.async_job_retrying/);
    assert.doesNotMatch(template, /jobId/);
    assert.doesNotMatch(template, /tenantId/);
  });

  it('defines EC2 operational alarms on MonitoringAlarmTopic', () => {
    const ec2Alarms = template.slice(
      template.indexOf('Ec2IntelligenceDlqDepthAlarm:'),
      template.indexOf('ProductionMonitoringDashboard:'),
    );
    for (const alarm of [
      'Ec2IntelligenceDlqDepthAlarm',
      'Ec2IntelligenceQueueAgeAlarm',
      'Ec2AnalysisConsumerErrorsAlarm',
      'Ec2AnalysisConsumerThrottlesAlarm',
      'Ec2AnalysisConsumerNearTimeoutAlarm',
      'Ec2AsyncJobHighRetryRateAlarm',
    ]) {
      assert.match(ec2Alarms, new RegExp(`${alarm}:`));
    }
    assert.equal((ec2Alarms.match(/MonitoringAlarmTopic/g) ?? []).length >= 12, true);
  });

  it('uses DLQ depth threshold >= 1 and configurable queue age', () => {
    const dlq = template.slice(
      template.indexOf('Ec2IntelligenceDlqDepthAlarm:'),
      template.indexOf('Ec2IntelligenceQueueAgeAlarm:'),
    );
    assert.match(dlq, /Threshold: 1/);
    const age = template.slice(
      template.indexOf('Ec2IntelligenceQueueAgeAlarm:'),
      template.indexOf('Ec2AnalysisConsumerErrorsAlarm:'),
    );
    assert.match(age, /Threshold: !Ref Ec2QueueAgeAlarmThresholdSeconds/);
  });

  it('does not use a nonexistent AWS/Lambda Timeouts metric', () => {
    assert.doesNotMatch(template, /MetricName: Timeouts/);
    assert.match(template, /ec2-analysis-consumer-near-timeout/);
  });

  it('preserves existing platform alarms in the dashboard widget', () => {
    const alarmsWidget = template.slice(
      template.indexOf('"title": "Production Alarm Status"'),
      template.indexOf('"title": "Production Alarm Status"') + 1200,
    );
    assert.match(alarmsWidget, /LambdaErrorsAlarm/);
    assert.match(alarmsWidget, /ApiGateway5xxAlarm/);
    assert.match(alarmsWidget, /AuthorizationDenialAlarm/);
  });
});
