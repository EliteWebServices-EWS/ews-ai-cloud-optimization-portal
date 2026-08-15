import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  safeAwsServiceErrorDetails,
  logEc2CostCloudWatchMetricsFailure,
} from '../../cloud-intelligence/ec2-cost/ec2-cost-metrics-error-diagnostics';
import { toEc2CostMetricsAppError } from '../../cloud-intelligence/ec2-cost/ec2-cost-metrics-errors';
import { createLogger } from '../../shared/utils';

function awsSdkError(input: {
  name: string;
  metadata?: {
    httpStatusCode?: number;
    requestId?: string;
    attempts?: number;
  };
  extras?: Record<string, unknown>;
}): Error {
  return Object.assign(new Error('sensitive underlying message'), {
    name: input.name,
    $metadata: input.metadata,
    ...input.extras,
  });
}

describe('safeAwsServiceErrorDetails', () => {
  it('extracts AWS SDK metadata for unknown service errors', () => {
    const error = awsSdkError({
      name: 'ValidationException',
      metadata: {
        httpStatusCode: 400,
        requestId: 'request-123',
        attempts: 1,
      },
    });

    const mapped = toEc2CostMetricsAppError(error);
    const details = safeAwsServiceErrorDetails(error);

    assert.equal(mapped.code, 'CLOUDWATCH_METRICS_FAILED');
    assert.equal(details.awsErrorName, 'ValidationException');
    assert.equal(details.awsHttpStatusCode, 400);
    assert.equal(details.awsRequestId, 'request-123');
    assert.equal(details.awsRetryAttempts, 1);
  });

  it('maps AccessDenied to CLOUDWATCH_ACCESS_DENIED with safe metadata', () => {
    const error = awsSdkError({
      name: 'AccessDeniedException',
      metadata: {
        httpStatusCode: 403,
        requestId: 'req-denied',
      },
    });

    const mapped = toEc2CostMetricsAppError(error);
    const details = safeAwsServiceErrorDetails(error);

    assert.equal(mapped.code, 'CLOUDWATCH_ACCESS_DENIED');
    assert.equal(details.awsErrorName, 'AccessDeniedException');
    assert.equal(details.awsHttpStatusCode, 403);
    assert.equal(details.awsRequestId, 'req-denied');
  });

  it('maps throttling to CLOUDWATCH_THROTTLED with safe metadata', () => {
    const error = awsSdkError({
      name: 'ThrottlingException',
      metadata: {
        httpStatusCode: 429,
        requestId: 'req-throttle',
        attempts: 2,
      },
    });

    const mapped = toEc2CostMetricsAppError(error);
    const details = safeAwsServiceErrorDetails(error);

    assert.equal(mapped.code, 'CLOUDWATCH_THROTTLED');
    assert.equal(details.awsErrorName, 'ThrottlingException');
    assert.equal(details.awsHttpStatusCode, 429);
    assert.equal(details.awsRequestId, 'req-throttle');
    assert.equal(details.awsRetryAttempts, 2);
  });

  it('handles generic Error without exposing message or stack', () => {
    const error = new Error('raw failure message');
    error.stack = 'Error: raw failure message\n    at sensitive.js:1:1';

    const mapped = toEc2CostMetricsAppError(error);
    const details = safeAwsServiceErrorDetails(error);

    assert.equal(mapped.code, 'CLOUDWATCH_METRICS_FAILED');
    assert.equal(details.awsErrorName, 'Error');
    assert.equal('message' in details, false);
    assert.equal('stack' in details, false);
  });

  it('handles non-Error input safely without throwing', () => {
    const details = safeAwsServiceErrorDetails({ accessKeyId: 'AKIA1234567890ABCD' });

    assert.equal(details.awsErrorName, 'UnknownError');
    assert.equal('accessKeyId' in details, false);
  });

  it('does not expose sensitive enumerable properties from error-like objects', () => {
    const error = awsSdkError({
      name: 'ValidationException',
      metadata: {
        httpStatusCode: 400,
        requestId: 'request-safe',
      },
      extras: {
        accessKeyId: 'AKIA1234567890ABCD',
        secretAccessKey: 'super-secret',
        sessionToken: 'session-token-value',
        Authorization: 'Bearer token',
        credentials: { accessKeyId: 'AKIA1234567890ABCD' },
        requestPayload: { MetricDataQueries: [{ Id: 'q1' }] },
        MetricDataQueries: [{ Id: 'q1' }],
      },
    });

    const details = safeAwsServiceErrorDetails(error);
    const serialized = JSON.stringify(details);

    assert.equal(details.awsErrorName, 'ValidationException');
    assert.equal(serialized.includes('AKIA'), false);
    assert.equal(serialized.includes('super-secret'), false);
    assert.equal(serialized.includes('session-token-value'), false);
    assert.equal(serialized.includes('Bearer token'), false);
    assert.equal(serialized.includes('MetricDataQueries'), false);
    assert.equal(serialized.includes('requestPayload'), false);
    assert.equal(serialized.includes('sensitive underlying message'), false);
  });
});

describe('logEc2CostCloudWatchMetricsFailure', () => {
  it('emits sanitized structured diagnostics for GetMetricData failures', () => {
    const logs: string[] = [];
    const originalError = console.error;
    console.error = (message?: unknown) => {
      logs.push(String(message));
    };

    try {
      const error = awsSdkError({
        name: 'ValidationException',
        metadata: {
          httpStatusCode: 400,
          requestId: 'request-123',
          attempts: 1,
        },
      });
      const mapped = toEc2CostMetricsAppError(error);

      logEc2CostCloudWatchMetricsFailure(
        createLogger('Ec2CostMetrics'),
        {
          operation: 'GetMetricData',
          region: 'us-east-1',
          tenantId: 'tenant-a',
          accountId: '111122223333',
          mappedCode: mapped.code,
        },
        error,
      );

      assert.equal(logs.length, 1);
      const payload = JSON.parse(logs[0] ?? '{}') as Record<string, unknown>;
      assert.equal(payload.scope, 'Ec2CostMetrics');
      assert.equal(payload.message, 'CloudWatch metric collection failed');
      assert.equal(payload.operation, 'GetMetricData');
      assert.equal(payload.region, 'us-east-1');
      assert.equal(payload.mappedCode, 'CLOUDWATCH_METRICS_FAILED');
      assert.equal(payload.awsErrorName, 'ValidationException');
      assert.equal(payload.awsHttpStatusCode, 400);
      assert.equal(payload.awsRequestId, 'request-123');
      assert.equal(JSON.stringify(payload).includes('sensitive underlying message'), false);
    } finally {
      console.error = originalError;
    }
  });
});
