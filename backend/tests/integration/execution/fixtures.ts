import type { SisumRole } from '../../../auth';
import { createDefaultExecutionAdapterRegistry } from '../../../execution/adapters/adapter-registry';
import type { AwsExecutionClientFactory } from '../../../execution/adapters/aws-clients';
import { EXECUTION_MODES, type AdapterExecutionContext } from '../../../execution/adapters/types';
import { createExecutionOrchestrator } from '../../../execution/execution-orchestrator';
import { initialApprovalStatus } from '../../../repositories/contracts/execution-plan-repository';
import type { CreateExecutionPlanInput } from '../../../repositories/contracts';
import { MockExecutionHistoryRepository } from '../../../repositories/mock/mock-execution-history-repository';
import { MockExecutionPlanRepository } from '../../../repositories/mock/mock-execution-plan-repository';
import { MockExecutionRunRepository } from '../../../repositories/mock/mock-execution-run-repository';

export const TENANT_A = 'tenant-exec-a';
export const TENANT_B = 'tenant-exec-b';
export const ACTOR_A = 'actor-exec-a';

export function buildPlanInput(
  overrides: Partial<CreateExecutionPlanInput> = {},
): CreateExecutionPlanInput {
  const executionId = overrides.executionId ?? `exec-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  return {
    executionId,
    tenantId: TENANT_A,
    workflowId: 'wf-validation-1',
    recommendationId: 'rec-1',
    planStatus: 'DRAFT',
    createdBy: ACTOR_A,
    executionSteps: [
      {
        stepId: 'step-1',
        order: 0,
        actionType: 'START_INSTANCE',
        resourceType: 'EC2',
        resourceId: 'i-test',
        description: 'Start instance',
      },
    ],
    rollbackPlan: {
      strategy: 'REVERSE',
      steps: [],
      automatic: true,
    },
    riskLevel: 'LOW',
    approvalRequired: false,
    approvalStatus: initialApprovalStatus(false),
    ...overrides,
  };
}

export function createInMemoryExecutionStores() {
  return {
    plans: new MockExecutionPlanRepository(),
    history: new MockExecutionHistoryRepository(),
    runs: new MockExecutionRunRepository(),
  };
}

export function buildOrchestratorContext(
  overrides: Partial<AdapterExecutionContext> = {},
): AdapterExecutionContext {
  return {
    tenantId: TENANT_A,
    actorId: ACTOR_A,
    actor: {
      authenticated: true,
      userId: ACTOR_A,
      email: `${ACTOR_A}@example.com`,
      roles: ['admin'] as SisumRole[],
    },
    correlationId: 'corr-validation',
    requestId: 'req-validation',
    region: 'us-east-1',
    mode: EXECUTION_MODES.PRODUCTION,
    ...overrides,
  };
}

export function createTestOrchestrator(
  clientFactory: AwsExecutionClientFactory = () => ({}),
) {
  const runs = new MockExecutionRunRepository();
  const orchestrator = createExecutionOrchestrator({
    registry: createDefaultExecutionAdapterRegistry(clientFactory),
    runs,
  });
  return { orchestrator, runs };
}
