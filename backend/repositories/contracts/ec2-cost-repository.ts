import type { PageResult } from './repository-types';
import type {
  Ec2CostAnalysisRunRecord,
  Ec2CostRecommendationRecord,
} from '../../cloud-intelligence/ec2-cost/ec2-cost-models';

export interface Ec2CostRecommendationListQuery {
  tenantId: string;
  accountId: string;
  region?: string;
  category?: string;
  severity?: string;
  confidenceLevel?: string;
  lifecycleStatus?: string;
  resourceId?: string;
  limit?: number;
  nextToken?: string;
}

export interface UpsertEc2CostRecommendationInput {
  findingKey: string;
  recommendation: Omit<
    Ec2CostRecommendationRecord,
    | 'recommendationId'
    | 'version'
    | 'createdAt'
    | 'updatedAt'
    | 'firstDetectedAt'
    | 'lastDetectedAt'
    | 'lifecycleStatus'
  > & {
    recommendationId?: string;
    firstDetectedAt?: string;
    lastDetectedAt?: string;
    lifecycleStatus?: Ec2CostRecommendationRecord['lifecycleStatus'];
  };
}

export interface Ec2CostRecommendationRepository {
  upsertRecommendation(input: UpsertEc2CostRecommendationInput): Promise<Ec2CostRecommendationRecord>;
  getRecommendation(
    tenantId: string,
    accountId: string,
    recommendationId: string,
  ): Promise<Ec2CostRecommendationRecord | null>;
  listRecommendations(query: Ec2CostRecommendationListQuery): Promise<PageResult<Ec2CostRecommendationRecord>>;
  listOpenFindingKeys(
    tenantId: string,
    accountId: string,
    analysisRunId: string,
  ): Promise<string[]>;
  markResolved(input: {
    tenantId: string;
    accountId: string;
    findingKey: string;
    expectedVersion: number;
    resolvedAt: string;
  }): Promise<Ec2CostRecommendationRecord>;
}

export interface CreateEc2CostAnalysisRunInput {
  runId: string;
  tenantId: string;
  accountId: string;
  regions: string[];
  observationDays: number;
  periodSeconds: number;
  requestedAt: string;
  startedAt: string;
}

export interface CompleteEc2CostAnalysisRunInput {
  tenantId: string;
  accountId: string;
  runId: string;
  expectedVersion: number;
  status: Ec2CostAnalysisRunRecord['status'];
  completedAt: string;
  instancesFound: number;
  instancesEvaluated: number;
  recommendationsCreated: number;
  recommendationsUpdated: number;
  recommendationsResolved: number;
  insufficientDataCount: number;
  regionsSucceeded: string[];
  regionsFailed: string[];
  warnings: string[];
}

export interface Ec2CostAnalysisRunRepository {
  createRun(input: CreateEc2CostAnalysisRunInput): Promise<Ec2CostAnalysisRunRecord>;
  completeRun(input: CompleteEc2CostAnalysisRunInput): Promise<Ec2CostAnalysisRunRecord>;
  getRun(tenantId: string, accountId: string, runId: string): Promise<Ec2CostAnalysisRunRecord | null>;
}
