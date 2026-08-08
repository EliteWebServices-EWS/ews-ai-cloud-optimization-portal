import type { PageResult } from './repository-types';
import type {
  Ec2SecurityAnalysisRunRecord,
  Ec2SecurityFindingRecord,
  Ec2SecuritySummaryRecord,
} from '../../cloud-intelligence/ec2-security/ec2-security-models';

export interface Ec2SecurityFindingListQuery {
  tenantId: string;
  accountId: string;
  region?: string;
  severity?: string;
  category?: string;
  status?: string;
  resourceId?: string;
  limit?: number;
  nextToken?: string;
}

export interface UpsertEc2SecurityFindingInput {
  findingKey: string;
  finding: Omit<
    Ec2SecurityFindingRecord,
    | 'findingId'
    | 'findingKey'
    | 'version'
    | 'createdAt'
    | 'updatedAt'
    | 'firstDetectedAt'
    | 'lastDetectedAt'
    | 'status'
  > & {
    findingId?: string;
    status?: Ec2SecurityFindingRecord['status'];
    firstDetectedAt?: string;
    lastDetectedAt?: string;
  };
}

export interface Ec2SecurityFindingRepository {
  upsertFinding(input: UpsertEc2SecurityFindingInput): Promise<Ec2SecurityFindingRecord>;
  getFinding(
    tenantId: string,
    accountId: string,
    findingId: string,
  ): Promise<Ec2SecurityFindingRecord | null>;
  getFindingByKey(
    tenantId: string,
    accountId: string,
    findingKey: string,
  ): Promise<Ec2SecurityFindingRecord | null>;
  listFindings(query: Ec2SecurityFindingListQuery): Promise<PageResult<Ec2SecurityFindingRecord>>;
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
  }): Promise<Ec2SecurityFindingRecord>;
}

export interface Ec2SecuritySummaryRepository {
  upsertSummary(input: Ec2SecuritySummaryRecord): Promise<Ec2SecuritySummaryRecord>;
  getLatestSummary(
    tenantId: string,
    accountId: string,
    region: string,
  ): Promise<Ec2SecuritySummaryRecord | null>;
  listSummariesForAccount(
    tenantId: string,
    accountId: string,
  ): Promise<Ec2SecuritySummaryRecord[]>;
}

export interface CreateEc2SecurityAnalysisRunInput {
  runId: string;
  tenantId: string;
  accountId: string;
  regions: string[];
  startedAt: string;
  executionOwnerId?: string;
  leaseExpiresAt?: string;
  attemptCount?: number;
}

export interface CompleteEc2SecurityAnalysisRunInput {
  tenantId: string;
  accountId: string;
  runId: string;
  expectedVersion: number;
  status: Ec2SecurityAnalysisRunRecord['status'];
  completedAt: string;
  instancesFound: number;
  instancesAnalyzed: number;
  findingsCreated: number;
  findingsUpdated: number;
  findingsResolved: number;
  failureRetryable?: boolean;
}

export interface ClaimEc2SecurityAnalysisRunExecutionInput {
  runId: string;
  tenantId: string;
  accountId: string;
  regions: string[];
  startedAt: string;
  nowMs: number;
  executionOwnerIdForAttempt: (attemptCount: number) => string;
}

export interface Ec2SecurityAnalysisRunRepository {
  createRun(input: CreateEc2SecurityAnalysisRunInput): Promise<Ec2SecurityAnalysisRunRecord>;
  claimExecution(input: ClaimEc2SecurityAnalysisRunExecutionInput): Promise<Ec2SecurityAnalysisRunRecord>;
  completeRun(input: CompleteEc2SecurityAnalysisRunInput): Promise<Ec2SecurityAnalysisRunRecord>;
  getRun(tenantId: string, accountId: string, runId: string): Promise<Ec2SecurityAnalysisRunRecord | null>;
}
