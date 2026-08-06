import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { EC2_COST_RECOMMENDATION_TOKEN_MAX_LENGTH } from '../../repositories/ec2-cost-recommendation-pagination';
import { Ec2CostValidationError } from '../../services/ec2-cost-analysis-api-service';
import {
  parseEc2CostAnalysisBody,
  parseEc2CostRecommendationListQuery,
} from '../../api/ec2-cost-api-validation';

describe('EC2 cost API validation', () => {
  it('parseEc2CostAnalysisBody rejects malformed accountId with Ec2CostValidationError', () => {
    assert.throws(
      () => parseEc2CostAnalysisBody({ accountId: 'bad' }),
      (error: unknown) => {
        assert.ok(error instanceof Ec2CostValidationError);
        assert.match((error as Error).message, /accountId/);
        assert.doesNotMatch((error as Error).message, /cloud-resource|DynamoDB|Invalid AWS accountId:/i);
        return true;
      },
    );
  });

  it('parseEc2CostAnalysisBody rejects malformed region with Ec2CostValidationError', () => {
    assert.throws(
      () =>
        parseEc2CostAnalysisBody({
          accountId: '572262081497',
          regions: ['not-a-region'],
        }),
      (error: unknown) => {
        assert.ok(error instanceof Ec2CostValidationError);
        assert.match((error as Error).message, /Invalid AWS region/);
        return true;
      },
    );
  });

  it('parseEc2CostRecommendationListQuery rejects invalid category filter', () => {
    assert.throws(
      () =>
        parseEc2CostRecommendationListQuery('tenant-a', {
          accountId: '572262081497',
          category: 'NOT_A_REAL_CATEGORY',
        }),
      Ec2CostValidationError,
    );
  });

  it('parseEc2CostRecommendationListQuery rejects invalid limit', () => {
    assert.throws(
      () =>
        parseEc2CostRecommendationListQuery('tenant-a', {
          accountId: '572262081497',
          limit: 0,
        }),
      (error: unknown) => {
        assert.ok(error instanceof Ec2CostValidationError);
        assert.match((error as Error).message, /limit/);
        return true;
      },
    );
  });

  it('parseEc2CostRecommendationListQuery rejects oversized nextToken', () => {
    assert.throws(
      () =>
        parseEc2CostRecommendationListQuery('tenant-a', {
          accountId: '572262081497',
          nextToken: 'x'.repeat(EC2_COST_RECOMMENDATION_TOKEN_MAX_LENGTH + 1),
        }),
      (error: unknown) => {
        assert.ok(error instanceof Ec2CostValidationError);
        assert.match((error as Error).message, /Pagination token/);
        return true;
      },
    );
  });
});
