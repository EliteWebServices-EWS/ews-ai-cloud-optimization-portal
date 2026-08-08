export type Ec2SecurityFindingCategory = 'security' | 'governance';
export type Ec2SecurityFindingSeverity = 'critical' | 'high' | 'medium' | 'low';
export type Ec2SecurityFindingStatus = 'OPEN' | 'RESOLVED' | 'ACKNOWLEDGED' | 'DISMISSED';
export type Ec2SecurityAnalysisRunStatus = 'RUNNING' | 'SUCCEEDED' | 'PARTIAL' | 'FAILED';

export interface Ec2SecurityFindingRecord {
  findingId: string;
  findingKey: string;
  tenantId: string;
  accountId: string;
  region: string;
  resourceId: string;
  resourceType: 'INSTANCE';
  category: Ec2SecurityFindingCategory;
  check: string;
  ruleVersion: string;
  severity: Ec2SecurityFindingSeverity;
  status: Ec2SecurityFindingStatus;
  message: string;
  recommendation: string;
  analysisRunId: string;
  firstDetectedAt: string;
  lastDetectedAt: string;
  resolvedAt?: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface Ec2SecuritySummaryRecord {
  tenantId: string;
  accountId: string;
  region: string;
  securityScore: number;
  governanceScore: number;
  complianceScore: number;
  riskLevel: 'critical' | 'high' | 'medium' | 'low';
  instancesAnalyzed: number;
  openFindingCount: number;
  analyzedAt: string;
  analysisRunId: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface Ec2SecurityAnalysisRunRecord {
  runId: string;
  tenantId: string;
  accountId: string;
  regions: string[];
  status: Ec2SecurityAnalysisRunStatus;
  startedAt: string;
  completedAt?: string;
  instancesFound: number;
  instancesAnalyzed: number;
  findingsCreated: number;
  findingsUpdated: number;
  findingsResolved: number;
  version: number;
  createdAt: string;
  updatedAt: string;
  executionOwnerId?: string;
  leaseExpiresAt?: string;
  attemptCount?: number;
  failureRetryable?: boolean;
}
