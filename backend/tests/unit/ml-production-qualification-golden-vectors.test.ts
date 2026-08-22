import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { MockMlInferenceAdapter } from '../../ml-decision/adapters/mock-ml-inference-adapter';
import { MlDecisionService } from '../../ml-decision/ml-decision-service';
import {
  ML_PRODUCTION_QUALIFICATION_VECTORS,
  ML_PRODUCTION_VECTOR_IDS,
  assertVectorDecision,
} from '../fixtures/sprint-4-ml/ml-production-qualification-vectors';

describe('Sprint 4 ML golden production qualification vectors', () => {
  it('includes the required Sprint 4 vector catalogue', () => {
    const ids = ML_PRODUCTION_QUALIFICATION_VECTORS.map((vector) => vector.id);
    for (const required of ML_PRODUCTION_VECTOR_IDS) {
      assert.ok(ids.includes(required), `missing vector ${required}`);
    }
  });

  for (const vector of ML_PRODUCTION_QUALIFICATION_VECTORS) {
    it(`${vector.id} asserts structured outcome and stable reason codes`, async () => {
      const service = new MlDecisionService(new MockMlInferenceAdapter(vector.adapter));
      const { decision } = await service.evaluate(vector.input);
      assert.doesNotThrow(() => assertVectorDecision(decision, vector.expected));
      assert.ok(decision.reasonCodes.length > 0);
      assert.ok(decision.outcome === 'EXECUTED' || decision.outcome === 'SKIPPED' || decision.outcome === 'FAILED_SAFE');
    });
  }
});
