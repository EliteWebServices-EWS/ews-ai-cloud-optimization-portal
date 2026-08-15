import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildMetricDataQueriesForTargets,
  metricId,
} from '../../cloud-intelligence/ec2-cost/ec2-cloudwatch-metric-queries';

const REALISTIC_INSTANCE_ID = 'i-0ce183611f7fc8ed2';
const PERIOD = 3600;

function isValidCloudWatchMetricDataQueryId(id: string): boolean {
  return /^[a-z][a-zA-Z0-9_]*$/.test(id);
}

describe('buildMetricDataQueriesForTargets (PD-4 GetMetricData shape)', () => {
  it('sets ReturnData true on every generated query', () => {
    const queries = buildMetricDataQueriesForTargets(
      [
        { region: 'us-east-1', instanceId: REALISTIC_INSTANCE_ID, instanceType: 't3.micro' },
        { region: 'us-east-1', instanceId: 'i-other', instanceType: 'm5.large' },
      ],
      PERIOD,
    );

    assert.ok(queries.length > 0);
    for (const query of queries) {
      assert.equal(query.ReturnData, true);
    }
  });

  it('sets MetricStat.Period on every metric-stat query', () => {
    const queries = buildMetricDataQueriesForTargets(
      [{ region: 'us-east-1', instanceId: REALISTIC_INSTANCE_ID, instanceType: 'm5.large' }],
      PERIOD,
    );

    for (const query of queries) {
      assert.equal(query.MetricStat?.Period, PERIOD);
    }
  });

  it('does not include invalid top-level Period on MetricDataQuery', () => {
    const queries = buildMetricDataQueriesForTargets(
      [{ region: 'us-east-1', instanceId: REALISTIC_INSTANCE_ID, instanceType: 'm5.large' }],
      PERIOD,
    );

    for (const query of queries) {
      assert.equal('Period' in query, false);
      assert.equal((query as { Period?: number }).Period, undefined);
    }
  });

  it('generates CloudWatch-valid IDs for a realistic EC2 instance ID', () => {
    const queries = buildMetricDataQueriesForTargets(
      [{ region: 'us-east-1', instanceId: REALISTIC_INSTANCE_ID, instanceType: 'm5.large' }],
      PERIOD,
    );

    assert.equal(metricId(REALISTIC_INSTANCE_ID, 'CPUUtilization'), 'i_0ce183611f7fc8ed2_CPUUtilization');
    for (const query of queries) {
      assert.ok(query.Id);
      assert.ok(
        isValidCloudWatchMetricDataQueryId(query.Id),
        `invalid CloudWatch query Id: ${query.Id}`,
      );
    }
  });

  it('keeps query IDs unique across multiple targets', () => {
    const queries = buildMetricDataQueriesForTargets(
      [
        { region: 'us-east-1', instanceId: REALISTIC_INSTANCE_ID, instanceType: 'm5.large' },
        { region: 'us-east-1', instanceId: 'i-abc123def456', instanceType: 'm5.large' },
      ],
      PERIOD,
    );

    const ids = queries.map((query) => query.Id);
    assert.equal(ids.length, new Set(ids).size);
  });

  it('preserves non-burstable and burstable query counts', () => {
    const nonBurstable = buildMetricDataQueriesForTargets(
      [{ region: 'us-east-1', instanceId: REALISTIC_INSTANCE_ID, instanceType: 'm5.large' }],
      PERIOD,
    );
    const burstable = buildMetricDataQueriesForTargets(
      [{ region: 'us-east-1', instanceId: REALISTIC_INSTANCE_ID, instanceType: 't3.micro' }],
      PERIOD,
    );

    assert.equal(nonBurstable.length, 5);
    assert.equal(burstable.length, 9);
  });
});
