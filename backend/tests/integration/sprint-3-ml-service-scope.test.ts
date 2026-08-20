import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { MlDecisionScopeError } from '../../ml-decision/errors';
import { MockMlInferenceAdapter } from '../../ml-decision/adapters/mock-ml-inference-adapter';
import { MlDecisionService } from '../../ml-decision/ml-decision-service';
import {
  ACCOUNT_A,
  ACCOUNT_B,
  TENANT_A,
  TENANT_B,
} from '../fixtures/evidence/identities';
import { buildMlDecisionEvaluateInput } from '../fixtures/evidence/ml-fixtures';

describe('Sprint 3 ML service tenant/account scope', () => {
  it('rejects Tenant A request with Tenant B feature/model context before MLDecision', async () => {
    const service = new MlDecisionService(new MockMlInferenceAdapter({ confidence: 0.91 }));

    await assert.rejects(
      () =>
        service.evaluate(
          buildMlDecisionEvaluateInput({
            tenantId: TENANT_A,
            accountId: ACCOUNT_A,
            featureContextScope: { tenantId: TENANT_B, accountId: ACCOUNT_B },
            modelContextScope: { tenantId: TENANT_B, accountId: ACCOUNT_B },
          }),
        ),
      MlDecisionScopeError,
    );
  });

  it('rejects Tenant A / Account A request with Account B model context before MLDecision', async () => {
    const service = new MlDecisionService(new MockMlInferenceAdapter({ confidence: 0.91 }));

    await assert.rejects(
      () =>
        service.evaluate(
          buildMlDecisionEvaluateInput({
            tenantId: TENANT_A,
            accountId: ACCOUNT_A,
            featureContextScope: { tenantId: TENANT_A, accountId: ACCOUNT_A },
            modelContextScope: { tenantId: TENANT_A, accountId: ACCOUNT_B },
          }),
        ),
      MlDecisionScopeError,
    );
  });

  it('accepts matching trusted request and context scope', async () => {
    const service = new MlDecisionService(new MockMlInferenceAdapter({ confidence: 0.91 }));
    const input = buildMlDecisionEvaluateInput({
      tenantId: TENANT_A,
      accountId: ACCOUNT_A,
      featureContextScope: { tenantId: TENANT_A, accountId: ACCOUNT_A },
      modelContextScope: { tenantId: TENANT_A, accountId: ACCOUNT_A },
    });

    const { decision } = await service.evaluate(input);

    assert.equal(decision.outcome, 'EXECUTED');
    assert.equal(decision.eligibility, 'ML_ELIGIBLE');
  });
});
