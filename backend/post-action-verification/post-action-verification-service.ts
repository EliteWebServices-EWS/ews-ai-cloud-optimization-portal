import { compareVerificationOutcome } from '../engines/verification/verification.comparator';
import { VerificationEngine } from '../engines/verification/verification.engine';
import type { VerificationRepository } from '../engines/verification/verification.repository';
import { VERIFICATION_STATUS } from '../shared/constants';
import type {
  ExecutionResult,
  Observation,
  VerificationExpectation,
} from '../shared/types';
import { evaluatePostActionVerification } from './evaluate-post-action-verification';
import type {
  EvaluatePostActionVerificationInput,
  PostActionVerificationAssessment,
} from './types';

export interface PostActionVerificationServiceInput
  extends Omit<EvaluatePostActionVerificationInput, 'comparatorResult'> {
  workflowId: string;
  executionId: string;
  expectation: VerificationExpectation;
  observation: Observation | null;
  executionResult: ExecutionResult;
}

export interface PostActionVerificationServiceResult {
  assessment: PostActionVerificationAssessment;
  persisted: Awaited<ReturnType<VerificationRepository['save']>>;
}

export class PostActionVerificationService {
  constructor(
    _engine: VerificationEngine = new VerificationEngine(),
    private readonly repository: VerificationRepository = new VerificationEngine().getRepository(),
  ) {}

  evaluate(input: PostActionVerificationServiceInput): PostActionVerificationAssessment {
    const comparatorResult = input.observation
      ? compareVerificationOutcome({
          executionResult: input.executionResult,
          observation: input.observation,
          expectation: input.expectation,
        })
      : {
          status: VERIFICATION_STATUS.PENDING,
          expectedSavings: input.expectation.expectedMonthlySavings,
          actualSavings: 0,
          verifiedSavings: 0,
          variance: -input.expectation.expectedMonthlySavings,
          variancePercentage: -100,
          stateMatched: false,
          confidenceScore: 0,
          message: 'Missing post-action observation',
        };

    return evaluatePostActionVerification({
      ...input,
      comparatorResult,
    });
  }

  async evaluateAndPersist(
    input: PostActionVerificationServiceInput,
  ): Promise<PostActionVerificationServiceResult> {
    const assessment = this.evaluate(input);
    const persisted = await this.repository.save({
      tenantId: input.tenantId,
      accountId: input.accountId,
      workflowId: input.workflowId,
      executionId: input.executionId,
      expectation: input.expectation,
      observation: input.observation,
      result: assessment.comparatorResult,
      recordedAt: input.evaluatedAt,
      assessment,
    });

    return { assessment, persisted };
  }
}

export { evaluatePostActionVerification } from './evaluate-post-action-verification';
export { mapLegacyStatusToOutcome } from './evaluate-post-action-verification';
export {
  extractAssessmentFromOutput,
  toVerificationRecordFromOutput,
} from './repository-convergence';
export { buildSprint3LifecycleResult } from './sprint3-lifecycle-result';
export type { Sprint3LifecycleResult } from './sprint3-lifecycle-result';
export { POST_ACTION_VERIFICATION_POLICY_VERSION } from './model-version';
export { POST_ACTION_VERIFICATION_REASON } from './reason-codes';
export { PostActionVerificationScopeError } from './errors';
export type {
  EvaluatePostActionVerificationInput,
  PostActionVerificationAssessment,
  PostActionVerificationOutcome,
  PostActionTrustedScope,
} from './types';
