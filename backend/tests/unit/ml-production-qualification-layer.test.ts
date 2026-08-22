import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { MockMlInferenceAdapter } from '../../ml-decision/adapters/mock-ml-inference-adapter';
import { MlDecisionService } from '../../ml-decision/ml-decision-service';
import {
  qualifyMlProductionBoundary,
  ML_PRODUCTION_QUALIFICATION_REASON,
} from '../../ml-production-qualification';
import { FIXED_ML_EVALUATED_AT } from '../fixtures/evidence/ml-fixtures';
import { ML_PRODUCTION_QUALIFICATION_VECTORS } from '../fixtures/sprint-4-ml/ml-production-qualification-vectors';

describe('Sprint 4 ML production qualification layer', () => {
  it('classifies a complete Sprint 3 boundary snapshot as PRODUCTION_QUALIFIED', async () => {
    const decisions = [];
    for (const vector of ML_PRODUCTION_QUALIFICATION_VECTORS) {
      const service = new MlDecisionService(new MockMlInferenceAdapter(vector.adapter));
      const { decision } = await service.evaluate(vector.input);
      decisions.push(decision);
    }

    const result = qualifyMlProductionBoundary({
      evaluatedAt: FIXED_ML_EVALUATED_AT,
      decisions,
      liveExternalProviderIntegrated: false,
    });

    assert.equal(result.result, 'PRODUCTION_QUALIFIED');
    assert.deepEqual(result.reasonCodes, [
      ML_PRODUCTION_QUALIFICATION_REASON.ML_QUAL_PRODUCTION_QUALIFIED,
    ]);
  });

  it('defers live external model/provider integration', () => {
    const result = qualifyMlProductionBoundary({
      evaluatedAt: FIXED_ML_EVALUATED_AT,
      decisions: [],
      liveExternalProviderIntegrated: true,
    });
    assert.equal(result.result, 'DEFERRED');
    assert.ok(
      result.reasonCodes.includes(
        ML_PRODUCTION_QUALIFICATION_REASON.ML_QUAL_DEFERRED_LIVE_PROVIDER,
      ),
    );
  });

  it('does not qualify empty snapshots or authority claims', () => {
    const empty = qualifyMlProductionBoundary({
      evaluatedAt: FIXED_ML_EVALUATED_AT,
      decisions: [],
      liveExternalProviderIntegrated: false,
    });
    assert.equal(empty.result, 'NOT_QUALIFIED');

    const authority = qualifyMlProductionBoundary({
      evaluatedAt: FIXED_ML_EVALUATED_AT,
      decisions: [
        {
          eligibility: 'ML_ELIGIBLE',
          outcome: 'EXECUTED',
          modelId: 'mock-model',
          modelVersion: 'mock-v1',
          reasonCodes: ['ML_ELIGIBLE'],
          fallback: 'NONE',
          evaluatedAt: FIXED_ML_EVALUATED_AT,
          eligibilityPolicyVersion: 'ml-eligibility-v1',
          validatedOutput: { modelConfidence: 0.9 },
          evaluationId: 'eval-authority',
        },
      ],
      liveExternalProviderIntegrated: false,
      claimsMlAuthority: true,
    });
    assert.equal(authority.result, 'NOT_QUALIFIED');
    assert.ok(
      authority.reasonCodes.includes(
        ML_PRODUCTION_QUALIFICATION_REASON.ML_QUAL_NOT_QUALIFIED_AUTHORITY_CLAIM,
      ),
    );
  });

  it('does not qualify EXECUTED without validated output', () => {
    const result = qualifyMlProductionBoundary({
      evaluatedAt: FIXED_ML_EVALUATED_AT,
      liveExternalProviderIntegrated: false,
      decisions: [
        {
          eligibility: 'ML_ELIGIBLE',
          outcome: 'EXECUTED',
          modelId: 'mock-model',
          modelVersion: 'mock-v1',
          reasonCodes: ['ML_ELIGIBLE'],
          fallback: 'NONE',
          evaluatedAt: FIXED_ML_EVALUATED_AT,
          eligibilityPolicyVersion: 'ml-eligibility-v1',
          validatedOutput: null,
          evaluationId: 'eval-missing-output',
        },
      ],
    });
    assert.equal(result.result, 'NOT_QUALIFIED');
    assert.ok(
      result.reasonCodes.includes(
        ML_PRODUCTION_QUALIFICATION_REASON.ML_QUAL_NOT_QUALIFIED_EXECUTED_WITHOUT_OUTPUT,
      ),
    );
  });
});
