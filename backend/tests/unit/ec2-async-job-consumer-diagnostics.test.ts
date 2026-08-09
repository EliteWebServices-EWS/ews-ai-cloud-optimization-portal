import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { RepositoryConflictError } from '../../database';
import {
  isSafeForConsumerDiagnosticLog,
  safeConsumerErrorDetails,
} from '../../services/ec2-async-job-consumer-diagnostics';
import { Ec2AsyncJobConsumerRetryableError } from '../../services/ec2-async-job-consumer-errors';

describe('EC2 async job consumer diagnostics', () => {
  it('classifies retryable consumer and repository conflict errors', () => {
    const retryable = safeConsumerErrorDetails(
      new Ec2AsyncJobConsumerRetryableError('Discovery stage did not persist completion.'),
    );
    assert.equal(retryable.errorName, 'Ec2AsyncJobConsumerRetryableError');
    assert.equal(retryable.retryable, true);

    const conflict = safeConsumerErrorDetails(new RepositoryConflictError('version conflict'));
    assert.equal(conflict.errorName, 'RepositoryConflictError');
    assert.equal(conflict.retryable, true);
  });

  it('extracts safe AWS SDK metadata without logging messages', () => {
    const awsError = Object.assign(new Error('sensitive'), {
      name: 'ConditionalCheckFailedException',
      Code: 'ConditionalCheckFailedException',
      $metadata: { httpStatusCode: 400, requestId: 'req-abc' },
    });
    const details = safeConsumerErrorDetails(awsError);
    assert.equal(details.errorName, 'ConditionalCheckFailedException');
    assert.equal(details.awsErrorCode, 'ConditionalCheckFailedException');
    assert.equal(details.httpStatusCode, 400);
    assert.equal(details.awsRequestId, 'req-abc');
    assert.equal(details.retryable, false);
  });

  it('rejects diagnostic strings that resemble credentials or externalId', () => {
    assert.equal(isSafeForConsumerDiagnosticLog('operation failed'), true);
    assert.equal(isSafeForConsumerDiagnosticLog('externalId=secret-value'), false);
    assert.equal(isSafeForConsumerDiagnosticLog('AKIAIOSFODNN7EXAMPLE'), false);
    assert.equal(isSafeForConsumerDiagnosticLog('sessionToken=abc'), false);
  });
});
