import type {
  Ec2GovernanceFinding,
  Ec2GovernancePolicy,
  Ec2SecurityAnalysisResponse,
  Ec2SecurityAnalysisResult,
  Ec2SecurityFinding,
  Ec2SecurityInventoryItem,
} from './ec2-security.types';

export const DEFAULT_EC2_GOVERNANCE_POLICY: Required<Ec2GovernancePolicy> = {
  requiredTags: ['Name', 'Environment', 'Owner'],
  approvedInstanceFamilies: ['t3', 't3a', 'm5', 'm6i', 'c5', 'c6i', 'r5', 'r6i'],
  maxInstanceAgeDays: 365,
};

const severityWeight = { critical: 30, high: 20, medium: 10, low: 5 } as const;
// This standard is intentionally fixed in code. Do not compile caller-supplied
// patterns: arbitrary regexes can be vulnerable to catastrophic backtracking.
const EC2_NAME_STANDARD = /^[a-z][a-z0-9-]{2,62}$/;
const EC2_NAME_STANDARD_DESCRIPTION = 'a lowercase, hyphenated value beginning with a letter (3–63 characters)';

function score(findings: Array<{ severity: keyof typeof severityWeight }>): number {
  return Math.max(0, 100 - findings.reduce((total, finding) => total + severityWeight[finding.severity], 0));
}

function unrestrictedPort(instance: Ec2SecurityInventoryItem, port: number): boolean {
  return instance.securityGroups?.some((group) => group.inboundRules?.some((rule) =>
    (rule.protocol === 'tcp' || rule.protocol === '-1') &&
    (rule.fromPort ?? 0) <= port && (rule.toPort ?? 65535) >= port &&
    (rule.cidr === '0.0.0.0/0' || rule.cidr === '::/0'),
  )) ?? false;
}

function analyzeOne(instance: Ec2SecurityInventoryItem, policy: Required<Ec2GovernancePolicy>): Ec2SecurityAnalysisResult {
  const securityFindings: Ec2SecurityFinding[] = [];
  const governanceFindings: Ec2GovernanceFinding[] = [];
  const tags = instance.tags ?? {};
  const name = tags.Name;

  if (instance.publicIpAddress) securityFindings.push({ check: 'public_ip_exposure', severity: 'medium', message: `Public IP ${instance.publicIpAddress} is attached.`, remediation: 'Remove the public IP or document a protected, required internet-facing use case.' });
  if (unrestrictedPort(instance, 22)) securityFindings.push({ check: 'unrestricted_ssh', severity: 'critical', message: 'A security group permits SSH (22) from the internet.', remediation: 'Restrict SSH to approved CIDRs or use Systems Manager Session Manager.' });
  if (unrestrictedPort(instance, 3389)) securityFindings.push({ check: 'unrestricted_rdp', severity: 'critical', message: 'A security group permits RDP (3389) from the internet.', remediation: 'Restrict RDP to approved CIDRs or use a managed access solution.' });
  if (!instance.ebsVolumes?.length || instance.ebsVolumes.some((volume) => volume.encrypted !== true)) securityFindings.push({ check: 'ebs_encryption', severity: 'high', message: 'One or more attached EBS volumes are not confirmed encrypted.', remediation: 'Enable default EBS encryption and migrate unencrypted volumes to encrypted replacements.' });
  if (!instance.iamInstanceProfileArn) securityFindings.push({ check: 'iam_instance_profile', severity: 'medium', message: 'No IAM instance profile is attached.', remediation: 'Attach a least-privilege IAM role if the workload needs AWS access.' });
  if (instance.metadataHttpTokens !== undefined && instance.metadataHttpTokens !== 'required') securityFindings.push({ check: 'imdsv2_enforcement', severity: 'high', message: 'IMDSv2 is not enforced.', remediation: 'Set HttpTokens to required and validate application compatibility.' });
  if (instance.cloudWatchMonitoring !== true) securityFindings.push({ check: 'cloudwatch_monitoring', severity: 'low', message: 'Detailed CloudWatch monitoring is not enabled.', remediation: 'Enable detailed monitoring and configure workload-appropriate alarms.' });

  for (const tag of policy.requiredTags) if (!tags[tag]?.trim()) governanceFindings.push({ check: 'required_tags', severity: 'medium', message: `Required tag ${tag} is missing.`, remediation: `Apply the ${tag} tag through provisioning policy.` });
  if (!name || !EC2_NAME_STANDARD.test(name)) governanceFindings.push({ check: 'naming_standard', severity: 'low', message: 'The Name tag does not meet the naming standard.', remediation: `Rename or retag the instance to use ${EC2_NAME_STANDARD_DESCRIPTION}.` });
  if (!instance.backupPolicy?.enabled) governanceFindings.push({ check: 'backup_policy', severity: 'high', message: 'No enabled backup policy indicator was supplied.', remediation: 'Enroll the instance volumes in an approved AWS Backup policy.' });
  const family = instance.instanceType.split('.')[0];
  if (!policy.approvedInstanceFamilies.includes(family)) governanceFindings.push({ check: 'approved_instance_family', severity: 'medium', message: `${family} is not an approved instance family.`, remediation: 'Migrate to an approved family or record a policy exception.' });
  if (instance.launchTime && (Date.now() - Date.parse(instance.launchTime)) / 86_400_000 > policy.maxInstanceAgeDays) governanceFindings.push({ check: 'lifecycle_compliance', severity: 'low', message: 'Instance age exceeds the lifecycle review threshold.', remediation: 'Review owner, patch posture, and retirement or renewal plan.' });

  const securityScore = score(securityFindings);
  const governanceScore = score(governanceFindings);
  const worst = [...securityFindings, ...governanceFindings].reduce<'critical' | 'high' | 'medium' | 'low'>((current, finding) => severityWeight[finding.severity] > severityWeight[current] ? finding.severity : current, 'low');
  return { instanceId: instance.instanceId, securityScore, governanceScore, riskLevel: worst, securityFindings, governanceFindings, recommendations: [...securityFindings.map((finding) => ({ category: 'security' as const, riskLevel: finding.severity, remediation: finding.remediation })), ...governanceFindings.map((finding) => ({ category: 'governance' as const, riskLevel: finding.severity, remediation: finding.remediation }))] };
}

export function analyzeEc2Security(inventory: Ec2SecurityInventoryItem[], overrides: Ec2GovernancePolicy = {}): Ec2SecurityAnalysisResponse {
  // Select policy fields explicitly so unknown API properties cannot influence
  // analysis behavior or leak back into the response.
  const policy: Required<Ec2GovernancePolicy> = {
    requiredTags: overrides.requiredTags ?? DEFAULT_EC2_GOVERNANCE_POLICY.requiredTags,
    approvedInstanceFamilies: overrides.approvedInstanceFamilies ?? DEFAULT_EC2_GOVERNANCE_POLICY.approvedInstanceFamilies,
    maxInstanceAgeDays: overrides.maxInstanceAgeDays ?? DEFAULT_EC2_GOVERNANCE_POLICY.maxInstanceAgeDays,
  };
  const results = inventory.map((instance) => analyzeOne(instance, policy));
  const average = (key: 'securityScore' | 'governanceScore') => results.length ? Math.round(results.reduce((sum, result) => sum + result[key], 0) / results.length) : 100;
  const riskLevel = results.reduce<Ec2SecurityAnalysisResult['riskLevel']>((worst, result) => severityWeight[result.riskLevel] > severityWeight[worst] ? result.riskLevel : worst, 'low');
  return { analyzedAt: new Date().toISOString(), policy, summary: { instancesAnalyzed: results.length, securityScore: average('securityScore'), governanceScore: average('governanceScore'), riskLevel }, results };
}
