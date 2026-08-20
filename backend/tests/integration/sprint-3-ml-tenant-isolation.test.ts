import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ActionLogEmitter } from '../../action-log/action-log-emitter';
import { ActionLogValidationError } from '../../action-log/types';
import { UnavailableMlInferenceAdapter } from '../../ml-decision/adapters/mock-ml-inference-adapter';
import { MlDecisionService } from '../../ml-decision/ml-decision-service';
import { MockActionLogRepository } from '../../repositories/mock/mock-action-log-repository';
import { ActionLogService } from '../../services/action-log-service';
import {
  ACCOUNT_A,
  ACCOUNT_B,
  TENANT_A,
  TENANT_B,
} from '../fixtures/evidence/identities';
import { buildMlNoMlGoldenPathInput } from '../fixtures/evidence/ml-fixtures';

describe('Sprint 3 ML tenant/account isolation', () => {
  it('rejects cross-tenant ActionLog emission for ML decision', async () => {
    const emitter = new ActionLogEmitter(new ActionLogService(new MockActionLogRepository()));
    const service = new MlDecisionService(new UnavailableMlInferenceAdapter());
    const input = buildMlNoMlGoldenPathInput({ tenantId: TENANT_A, accountId: ACCOUNT_A });
    const { decision } = await service.evaluate(input);

    await assert.rejects(
      () =>
        emitter.emitAfterMlDecision({
          decision,
          tenantId: TENANT_A,
          accountId: ACCOUNT_A,
          resourceId: input.resourceId,
          findingKey: input.findingKey,
          correlationId: input.correlationId,
          recommendationId: input.recommendationId,
          context: {
            tenantId: TENANT_B,
            accountId: ACCOUNT_B,
            correlationId: input.correlationId,
            recommendationId: input.recommendationId,
          },
        }),
      ActionLogValidationError,
    );
  });

  it('Tenant B cannot read Tenant A ML ActionLog lifecycle by correlation alone', async () => {
    const repository = new MockActionLogRepository();
    const service = new ActionLogService(repository);
    const emitter = new ActionLogEmitter(service);
    const mlService = new MlDecisionService(new UnavailableMlInferenceAdapter());
    const input = buildMlNoMlGoldenPathInput();
    const { decision } = await mlService.evaluate(input);

    await emitter.emitAfterMlDecision({
      decision,
      tenantId: TENANT_A,
      accountId: ACCOUNT_A,
      resourceId: input.resourceId,
      findingKey: input.findingKey,
      correlationId: input.correlationId,
      recommendationId: input.recommendationId,
      context: {
        tenantId: TENANT_A,
        accountId: ACCOUNT_A,
        correlationId: input.correlationId,
        recommendationId: input.recommendationId,
      },
    });

    const tenantBLifecycle = await service.reconstructCorrelationLifecycle(
      TENANT_B,
      input.correlationId,
    );
    assert.equal(tenantBLifecycle.items.length, 0);
  });
});
