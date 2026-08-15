import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { toEc2CostMetricsAppError } from '../../cloud-intelligence/ec2-cost/ec2-cost-metrics-errors';
import { safeAwsServiceErrorDetails } from '../../cloud-intelligence/ec2-cost/ec2-cost-metrics-error-diagnostics';
import { p95, average } from '../../cloud-intelligence/ec2-cost/ec2-metric-stats';

describe('ec2-cost-metrics-errors', () => {
  it('sanitizes AccessDenied', () => {
    const err = toEc2CostMetricsAppError(Object.assign(new Error('x'), { name: 'AccessDenied' }));
    assert.equal(err.code, 'CLOUDWATCH_ACCESS_DENIED');
    assert.equal(err.statusCode, 403);
    assert.doesNotMatch(err.message, /x/);
  });

  it('sanitizes AccessDeniedException', () => {
    const err = toEc2CostMetricsAppError(
      Object.assign(new Error('x'), { name: 'AccessDeniedException' }),
    );
    assert.equal(err.code, 'CLOUDWATCH_ACCESS_DENIED');
    assert.equal(err.statusCode, 403);
  });

  it('sanitizes throttling as retryable 429', () => {
    const err = toEc2CostMetricsAppError(Object.assign(new Error('x'), { name: 'ThrottlingException' }));
    assert.equal(err.code, 'CLOUDWATCH_THROTTLED');
    assert.equal(err.statusCode, 429);
  });

  it('maps unknown AWS SDK errors to CLOUDWATCH_METRICS_FAILED', () => {
    const err = toEc2CostMetricsAppError(
      Object.assign(new Error('x'), {
        name: 'ValidationException',
        $metadata: { httpStatusCode: 400, requestId: 'request-123' },
      }),
    );
    assert.equal(err.code, 'CLOUDWATCH_METRICS_FAILED');
    assert.equal(err.statusCode, 502);
    assert.doesNotMatch(err.message, /x/);
    const details = safeAwsServiceErrorDetails(err);
    assert.equal(details.awsErrorName, 'AppError');
  });

  it('maps generic Error to CLOUDWATCH_METRICS_FAILED', () => {
    const err = toEc2CostMetricsAppError(new Error('network failure'));
    assert.equal(err.code, 'CLOUDWATCH_METRICS_FAILED');
    assert.doesNotMatch(err.message, /network failure/);
  });
});

describe('ec2-metric-stats', () => {
  it('p95 calculation is correct', () => {
    assert.equal(p95([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]), 10);
  });

  it('discards non-finite values', () => {
    assert.equal(average([1, Number.NaN, 3]), 2);
  });
});
