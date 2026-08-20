import type { ExecutionPlanRecord } from '../repositories/models/execution-persistence-models';
import { AppError } from '../shared/utils';
import {
  evaluateProductionExecutionEligibility,
} from './evaluate-action-policy';
import { readPolicySnapshot } from './plan-metadata';
import type { ActionPolicyResult } from './types';

export function assertPolicyAllowsPlanCreation(policy: ActionPolicyResult): void {
  if (policy.approval !== 'BLOCKED') {
    return;
  }

  throw new AppError(
    'ACTION_POLICY_BLOCKED',
    `Action policy blocked plan creation: ${policy.reasonCodes.join(', ')}`,
    422,
    'action-policy',
  );
}

export function deriveApprovalRequiredFromPolicy(
  policy: ActionPolicyResult,
): boolean {
  return policy.approval === 'REQUIRED';
}

export function assertProductionExecutionEligible(
  plan: ExecutionPlanRecord,
): ActionPolicyResult {
  const snapshot = readPolicySnapshot(plan.metadata);
  if (!snapshot) {
    throw new AppError(
      'ACTION_POLICY_MISSING',
      'Execution plan is missing an action policy snapshot required for production execution.',
      422,
      'action-policy',
    );
  }

  if (snapshot.actionMode === 'SIMULATION') {
    throw new AppError(
      'ACTION_POLICY_SIMULATION_ONLY',
      'Execution plan action mode is SIMULATION; use simulation execution instead of production mutation.',
      409,
      'action-policy',
    );
  }

  const eligibility = evaluateProductionExecutionEligibility({
    policy: snapshot,
    approvalRequired: plan.approvalRequired,
    approvalStatus: plan.approvalStatus,
    planStatus: plan.planStatus,
  });

  if (eligibility.executionEligibility !== 'ELIGIBLE') {
    throw new AppError(
      'ACTION_POLICY_NOT_ELIGIBLE',
      `Execution plan is not eligible for production execution: ${eligibility.reasonCodes.join(', ')}`,
      409,
      'action-policy',
    );
  }

  return eligibility;
}

export function assertSimulationExecutionEligible(
  plan: ExecutionPlanRecord,
): ActionPolicyResult {
  const snapshot = readPolicySnapshot(plan.metadata);
  if (!snapshot) {
    throw new AppError(
      'ACTION_POLICY_MISSING',
      'Execution plan is missing an action policy snapshot required for simulation.',
      422,
      'action-policy',
    );
  }

  if (snapshot.actionMode !== 'SIMULATION') {
    throw new AppError(
      'ACTION_POLICY_PRODUCTION_PLAN',
      'Execution plan action mode is PRODUCTION; simulation path cannot mutate production.',
      409,
      'action-policy',
    );
  }

  if (snapshot.executionEligibility !== 'ELIGIBLE') {
    throw new AppError(
      'ACTION_POLICY_NOT_ELIGIBLE',
      `Execution plan is not eligible for simulation: ${snapshot.reasonCodes.join(', ')}`,
      409,
      'action-policy',
    );
  }

  return snapshot;
}
