/** Input inventory accepted by the EC2 security and governance analyzer. */
export interface Ec2SecurityInventoryItem {
  instanceId: string;
  instanceType: string;
  state?: string;
  region?: string;
  launchTime?: string;
  tags?: Record<string, string>;
  publicIpAddress?: string;
  securityGroups?: Array<{
    groupId?: string;
    groupName?: string;
    inboundRules?: Array<{ protocol?: string; fromPort?: number; toPort?: number; cidr?: string }>;
  }>;
  ebsVolumes?: Array<{ volumeId?: string; encrypted?: boolean }>;
  iamInstanceProfileArn?: string;
  metadataHttpTokens?: 'required' | 'optional' | 'disabled' | string;
  cloudWatchMonitoring?: boolean;
  backupPolicy?: { enabled?: boolean; lastBackupAt?: string };
}

export interface Ec2GovernancePolicy {
  requiredTags?: string[];
  approvedInstanceFamilies?: string[];
  maxInstanceAgeDays?: number;
}

export interface Ec2SecurityFinding {
  check: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  message: string;
  remediation: string;
}

export interface Ec2GovernanceFinding {
  check: string;
  severity: 'high' | 'medium' | 'low';
  message: string;
  remediation: string;
}

export interface Ec2SecurityAnalysisResult {
  instanceId: string;
  securityScore: number;
  governanceScore: number;
  riskLevel: 'critical' | 'high' | 'medium' | 'low';
  securityFindings: Ec2SecurityFinding[];
  governanceFindings: Ec2GovernanceFinding[];
  recommendations: Array<{ category: 'security' | 'governance'; riskLevel: string; remediation: string }>;
}

export interface Ec2SecurityAnalysisResponse {
  analyzedAt: string;
  policy: Required<Ec2GovernancePolicy>;
  summary: { instancesAnalyzed: number; securityScore: number; governanceScore: number; riskLevel: Ec2SecurityAnalysisResult['riskLevel'] };
  results: Ec2SecurityAnalysisResult[];
}
