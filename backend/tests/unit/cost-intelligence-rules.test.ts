import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { COST_FINDING_TYPES } from '../../shared/constants';
import type { Ec2CostInstance } from '../../shared/types';
import { DEFAULT_COST_INTELLIGENCE_CONFIG } from '../../engines/cost-intelligence/cost-intelligence.config';
import {
  classifyInstance,
  evaluatePreviousGenerationType,
  evaluateStoppedInstanceRetained,
  evaluateUntaggedCostOwnershipGap,
} from '../../engines/cost-intelligence/cost-intelligence.rules';

function daysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString();
}

function baseInstance(overrides: Partial<Ec2CostInstance> = {}): Ec2CostInstance {
  return {
    instanceId: 'i-test01',
    instanceType: 't3.medium',
    state: 'running',
    region: 'us-east-1',
    launchTime: daysAgo(30),
    tags: { Environment: 'production', Owner: 'platform-team' },
    ...overrides,
  };
}

describe('evaluatePreviousGenerationType', () => {
  it('flags a running previous-generation instance with a known replacement', () => {
    const match = evaluatePreviousGenerationType(
      baseInstance({ instanceType: 'm4.large' }),
      DEFAULT_COST_INTELLIGENCE_CONFIG,
    );
    assert.ok(match);
    assert.equal(match?.findingType, COST_FINDING_TYPES.PREVIOUS_GENERATION_TYPE);
    assert.equal(match?.suggestedInstanceType, 'm6i.large');
  });

  it('does not flag a stopped previous-generation instance', () => {
    const match = evaluatePreviousGenerationType(
      baseInstance({ instanceType: 'm4.large', state: 'stopped' }),
      DEFAULT_COST_INTELLIGENCE_CONFIG,
    );
    assert.equal(match, undefined);
  });

  it('does not flag a current-generation instance', () => {
    const match = evaluatePreviousGenerationType(
      baseInstance({ instanceType: 't3.medium' }),
      DEFAULT_COST_INTELLIGENCE_CONFIG,
    );
    assert.equal(match, undefined);
  });
});

describe('evaluateStoppedInstanceRetained', () => {
  it('flags an instance stopped past the retention threshold', () => {
    const match = evaluateStoppedInstanceRetained(
      baseInstance({ state: 'stopped', launchTime: daysAgo(45) }),
      DEFAULT_COST_INTELLIGENCE_CONFIG,
      new Date(),
    );
    assert.ok(match);
    assert.equal(match?.findingType, COST_FINDING_TYPES.STOPPED_INSTANCE_RETAINED);
  });

  it('does not flag a recently stopped instance', () => {
    const match = evaluateStoppedInstanceRetained(
      baseInstance({ state: 'stopped', launchTime: daysAgo(2) }),
      DEFAULT_COST_INTELLIGENCE_CONFIG,
      new Date(),
    );
    assert.equal(match, undefined);
  });

  it('does not flag a running instance', () => {
    const match = evaluateStoppedInstanceRetained(
      baseInstance({ state: 'running' }),
      DEFAULT_COST_INTELLIGENCE_CONFIG,
      new Date(),
    );
    assert.equal(match, undefined);
  });
});

describe('evaluateUntaggedCostOwnershipGap', () => {
  it('flags a running instance missing required cost-ownership tags', () => {
    const match = evaluateUntaggedCostOwnershipGap(
      baseInstance({ tags: {} }),
      DEFAULT_COST_INTELLIGENCE_CONFIG,
    );
    assert.ok(match);
    assert.equal(match?.findingType, COST_FINDING_TYPES.UNTAGGED_COST_OWNERSHIP_GAP);
    assert.match(match!.reason, /Environment/);
    assert.match(match!.reason, /Owner/);
  });

  it('does not flag a fully tagged running instance', () => {
    const match = evaluateUntaggedCostOwnershipGap(
      baseInstance({ tags: { Environment: 'production', Owner: 'team' } }),
      DEFAULT_COST_INTELLIGENCE_CONFIG,
    );
    assert.equal(match, undefined);
  });

  it('does not flag a stopped instance regardless of tags', () => {
    const match = evaluateUntaggedCostOwnershipGap(
      baseInstance({ state: 'stopped', tags: {} }),
      DEFAULT_COST_INTELLIGENCE_CONFIG,
    );
    assert.equal(match, undefined);
  });
});

describe('classifyInstance', () => {
  it('returns no matches for a healthy, fully tagged, current-generation instance', () => {
    const matches = classifyInstance(baseInstance(), DEFAULT_COST_INTELLIGENCE_CONFIG);
    assert.deepEqual(matches, []);
  });

  it('can return multiple matches for one instance', () => {
    const matches = classifyInstance(
      baseInstance({ instanceType: 'm4.large', tags: {} }),
      DEFAULT_COST_INTELLIGENCE_CONFIG,
    );
    const types = matches.map((match) => match.findingType).sort();
    assert.deepEqual(types, [
      COST_FINDING_TYPES.PREVIOUS_GENERATION_TYPE,
      COST_FINDING_TYPES.UNTAGGED_COST_OWNERSHIP_GAP,
    ].sort());
  });
});
