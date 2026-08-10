import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildSisumCustomerIntegrationRoleTrustPolicy,
  buildSisumPlatformTrustedRoleArn,
  SISUM_PLATFORM_TRUSTED_ROLE_NAMES,
} from '../../services/aws-account-integration-trust-policy';

const PLATFORM = '739275446782';
const EXTERNAL_ID = 'tenant-generated-external-id-example';

describe('SISUM customer integration role trust policy', () => {
  it('trusts both platform Lambda execution roles with ExternalId condition', () => {
    const policy = buildSisumCustomerIntegrationRoleTrustPolicy({
      platformAccountId: PLATFORM,
      externalId: EXTERNAL_ID,
    });
    const statement = (policy.Statement as Record<string, unknown>[])[0];
    assert.equal(statement.Effect, 'Allow');
    assert.deepEqual(statement.Action, 'sts:AssumeRole');
    assert.deepEqual(statement.Condition, {
      StringEquals: { 'sts:ExternalId': EXTERNAL_ID },
    });

    const principals = (statement.Principal as { AWS: string[] }).AWS;
    assert.equal(principals.length, 2);
    assert.ok(
      principals.includes(
        buildSisumPlatformTrustedRoleArn(PLATFORM, 'SisumLambdaExecutionRole'),
      ),
    );
    assert.ok(
      principals.includes(
        buildSisumPlatformTrustedRoleArn(PLATFORM, 'SisumEc2AnalysisConsumerExecutionRole'),
      ),
    );
  });

  it('does not use wildcard Principal', () => {
    const policy = buildSisumCustomerIntegrationRoleTrustPolicy({
      platformAccountId: PLATFORM,
      externalId: EXTERNAL_ID,
    });
    const json = JSON.stringify(policy);
    assert.doesNotMatch(json, /"\*"/);
    assert.doesNotMatch(json, /Principal":\s*"\*"/);
  });

  it('lists the expected trusted role names only', () => {
    assert.deepEqual(SISUM_PLATFORM_TRUSTED_ROLE_NAMES, [
      'SisumLambdaExecutionRole',
      'SisumEc2AnalysisConsumerExecutionRole',
    ]);
  });
});
