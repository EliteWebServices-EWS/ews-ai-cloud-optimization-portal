import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { resolveDataCompleteness, resolveTelemetryApplicability } from '../../evidence-maturity/telemetry-applicability';

describe('telemetry applicability', () => {
  it('STOPPED_WITH_STORAGE → NOT_APPLICABLE', () => {
    assert.equal(
      resolveTelemetryApplicability({
        ruleId: 'ec2.cost.stopped_with_storage',
        category: 'STOPPED_WITH_STORAGE',
      }),
      'NOT_APPLICABLE',
    );
  });

  it('INSTANCE_FAMILY_UPGRADE → NOT_APPLICABLE', () => {
    assert.equal(
      resolveTelemetryApplicability({
        ruleId: 'ec2.cost.family_upgrade',
        category: 'INSTANCE_FAMILY_UPGRADE',
      }),
      'NOT_APPLICABLE',
    );
  });

  it('idle instance rule → REQUIRED', () => {
    assert.equal(
      resolveTelemetryApplicability({
        ruleId: 'ec2.cost.idle_instance',
        category: 'IDLE_HIGH_CONFIDENCE',
      }),
      'REQUIRED',
    );
  });

  it('unknown rule/category defaults to REQUIRED (conservative)', () => {
    assert.equal(
      resolveTelemetryApplicability({
        ruleId: 'ec2.cost.unknown_future_rule',
        category: 'UNKNOWN_CATEGORY',
      }),
      'REQUIRED',
    );
  });

  it('NOT_APPLICABLE findings ignore missing CloudWatch object', () => {
    assert.equal(
      resolveDataCompleteness({
        telemetryApplicability: 'NOT_APPLICABLE',
        dataCompleteness: undefined,
      }),
      'NOT_APPLICABLE',
    );
  });

  it('REQUIRED without evidence object resolves to NO_DATA', () => {
    assert.equal(
      resolveDataCompleteness({
        telemetryApplicability: 'REQUIRED',
        dataCompleteness: undefined,
      }),
      'NO_DATA',
    );
  });
});
