import type {
  Ec2SecurityAnalysisResponse,
  Ec2SecurityInventoryItem,
} from '../../engines/ec2-security';
import {
  flattenInboundRulesForAnalyzer,
  type Ec2NormalizedInboundRule,
} from '../plugins/ec2/ec2-discovery-security-group-normalizer';
import { metadataHasPrefixListOnlySensitiveRules } from './ec2-security-prefix-list-evidence';

export type Ec2SecurityEvidenceStatus = 'VERIFIED' | 'INSUFFICIENT' | 'NOT_AVAILABLE';

export interface Ec2SecurityInstanceEvidence {
  securityGroups: Ec2SecurityEvidenceStatus;
  imds: Ec2SecurityEvidenceStatus;
  ebsEncryption: Ec2SecurityEvidenceStatus;
}

function isNormalizedInboundRule(value: unknown): value is Ec2NormalizedInboundRule {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as { cidr?: unknown };
  if (typeof record.cidr === 'string') {
    return true;
  }
  return true;
}

function hasVerifiedInboundRules(groups: Ec2SecurityInventoryItem['securityGroups']): boolean {
  if (!groups?.length) {
    return false;
  }
  return groups.some((group) =>
    group.inboundRules?.some((rule) => {
      const extended = rule as {
        ipv4Ranges?: string[];
        ipv6Ranges?: string[];
        prefixListIds?: string[];
        cidr?: string;
      };
      return (
        (extended.ipv4Ranges?.length ?? 0) > 0 ||
        (extended.ipv6Ranges?.length ?? 0) > 0 ||
        (typeof extended.cidr === 'string' && extended.cidr.length > 0)
      );
    }),
  );
}

export function assessInstanceSecurityEvidence(
  item: Ec2SecurityInventoryItem,
  rawMetadata?: Record<string, unknown>,
): Ec2SecurityInstanceEvidence {
  const metadata = rawMetadata ?? {};
  const groupIds = Array.isArray(metadata.securityGroupIds)
    ? metadata.securityGroupIds.filter((id): id is string => typeof id === 'string')
    : [];
  const persistedGroups = metadata.securityGroups;
  const hasPersistedGroupObjects =
    Array.isArray(persistedGroups) &&
    persistedGroups.some(
      (group) =>
        typeof group === 'object' &&
        group !== null &&
        Array.isArray((group as { inboundRules?: unknown }).inboundRules),
    );

  let securityGroups: Ec2SecurityEvidenceStatus = 'NOT_AVAILABLE';
  const prefixListGap = metadataHasPrefixListOnlySensitiveRules(metadata);
  if (prefixListGap) {
    securityGroups = 'INSUFFICIENT';
  } else if (hasVerifiedInboundRules(item.securityGroups)) {
    securityGroups = 'VERIFIED';
  } else if (groupIds.length > 0 || hasPersistedGroupObjects) {
    securityGroups = 'INSUFFICIENT';
  }

  let imds: Ec2SecurityEvidenceStatus = 'INSUFFICIENT';
  if (item.metadataHttpTokens !== undefined) {
    imds = 'VERIFIED';
  } else if (
    typeof metadata.metadataOptions === 'object' &&
    metadata.metadataOptions !== null &&
    typeof (metadata.metadataOptions as { httpTokens?: unknown }).httpTokens === 'string'
  ) {
    imds = 'VERIFIED';
  } else if (typeof metadata.metadataHttpTokens === 'string') {
    imds = 'VERIFIED';
  }

  let ebsEncryption: Ec2SecurityEvidenceStatus = 'NOT_AVAILABLE';
  if (!item.ebsVolumes?.length) {
    ebsEncryption = 'NOT_AVAILABLE';
  } else if (item.ebsVolumes.every((volume) => volume.encrypted === true)) {
    ebsEncryption = 'VERIFIED';
  } else if (item.ebsVolumes.some((volume) => volume.encrypted === false)) {
    ebsEncryption = 'VERIFIED';
  } else {
    ebsEncryption = 'INSUFFICIENT';
  }

  return { securityGroups, imds, ebsEncryption };
}

export interface Ec2SecurityEvidenceSupplement {
  insufficientEvidenceCount: number;
  warnings: string[];
}

export function supplementAnalysisForInsufficientEvidence(
  inventory: Ec2SecurityInventoryItem[],
  analysis: Ec2SecurityAnalysisResponse,
  metadataByInstanceId: Map<string, Record<string, unknown>>,
): { analysis: Ec2SecurityAnalysisResponse; supplement: Ec2SecurityEvidenceSupplement } {
  const warnings: string[] = [];
  let insufficientEvidenceCount = 0;
  const results = analysis.results.map((result) => {
    const item = inventory.find((entry) => entry.instanceId === result.instanceId);
    if (!item) {
      return result;
    }
    const evidence = assessInstanceSecurityEvidence(
      item,
      metadataByInstanceId.get(item.instanceId),
    );
    const securityFindings = [...result.securityFindings];
    let securityScore = result.securityScore;

    if (evidence.securityGroups === 'INSUFFICIENT') {
      insufficientEvidenceCount += 1;
      const prefixOnly = metadataHasPrefixListOnlySensitiveRules(
        metadataByInstanceId.get(item.instanceId) ?? {},
      );
      securityFindings.push({
        check: 'insufficient_security_group_evidence',
        severity: 'medium',
        message: prefixOnly
          ? 'Security group rules reference managed prefix lists without resolved CIDRs; internet exposure cannot be verified.'
          : 'Security group ingress rules were not available in stored inventory; unrestricted access cannot be ruled out.',
        remediation: prefixOnly
          ? 'Rerun EC2 discovery after prefix-list resolution is available, or review prefix list contents in AWS console.'
          : 'Rerun EC2 discovery to backfill security group ingress evidence.',
      });
      securityScore = Math.min(securityScore, 85);
    }
    if (evidence.imds === 'INSUFFICIENT') {
      insufficientEvidenceCount += 1;
      if (!securityFindings.some((finding) => finding.check === 'imdsv2_enforcement')) {
        securityFindings.push({
          check: 'insufficient_imds_evidence',
          severity: 'medium',
          message:
            'Instance metadata options were not available in stored inventory; IMDSv2 enforcement cannot be verified.',
          remediation: 'Rerun EC2 discovery to backfill IMDS metadata options.',
        });
      }
      securityScore = Math.min(securityScore, 85);
    }
    if (evidence.ebsEncryption === 'INSUFFICIENT') {
      insufficientEvidenceCount += 1;
      const ebsIdx = securityFindings.findIndex((finding) => finding.check === 'ebs_encryption');
      if (ebsIdx >= 0) {
        securityFindings.splice(ebsIdx, 1);
      }
      securityFindings.push({
        check: 'insufficient_ebs_encryption_evidence',
        severity: 'medium',
        message:
          'EBS encryption state was not fully available in stored inventory; encryption posture cannot be verified.',
        remediation: 'Rerun EC2 discovery to refresh attached volume encryption metadata.',
      });
      securityScore = Math.min(securityScore, 85);
    }

    return {
      ...result,
      securityFindings,
      securityScore,
    };
  });

  if (insufficientEvidenceCount > 0) {
    warnings.push(
      `${insufficientEvidenceCount} instance evidence gap(s) detected; scores may be conservative until discovery backfill completes.`,
    );
  }
  if (
    inventory.some((item) =>
      metadataHasPrefixListOnlySensitiveRules(metadataByInstanceId.get(item.instanceId) ?? {}),
    )
  ) {
    warnings.push(
      'Managed prefix list ingress is stored but not resolved; SSH/RDP/all-traffic exposure is not scored as secure.',
    );
  }

  const instancesAnalyzed = results.length;
  const averageSecurity = instancesAnalyzed
    ? Math.round(results.reduce((sum, result) => sum + result.securityScore, 0) / instancesAnalyzed)
    : 0;
  const averageGovernance = instancesAnalyzed
    ? Math.round(
        results.reduce((sum, result) => sum + result.governanceScore, 0) / instancesAnalyzed,
      )
    : 0;

  return {
    analysis: {
      ...analysis,
      results,
      summary: {
        ...analysis.summary,
        instancesAnalyzed,
        securityScore: instancesAnalyzed ? averageSecurity : 0,
        governanceScore: instancesAnalyzed ? averageGovernance : 0,
      },
    },
    supplement: { insufficientEvidenceCount, warnings },
  };
}

export function mapPersistedSecurityGroups(
  metadata: Record<string, unknown>,
): Ec2SecurityInventoryItem['securityGroups'] {
  const persisted = metadata.securityGroups;
  if (Array.isArray(persisted)) {
    return persisted
      .map((group) => {
        if (typeof group !== 'object' || group === null) {
          return undefined;
        }
        const record = group as {
          groupId?: unknown;
          groupName?: unknown;
          inboundRules?: unknown;
        };
        if (typeof record.groupId !== 'string') {
          return undefined;
        }
        const inboundRules = Array.isArray(record.inboundRules)
          ? record.inboundRules.filter(isNormalizedInboundRule)
          : [];
        return {
          groupId: record.groupId,
          groupName: typeof record.groupName === 'string' ? record.groupName : undefined,
          inboundRules,
        };
      })
      .filter((group): group is NonNullable<typeof group> => Boolean(group))
      .map((group) => ({
        groupId: group.groupId,
        groupName: group.groupName,
        inboundRules: flattenInboundRulesForAnalyzer(group.inboundRules),
      }));
  }

  const securityGroupIds = Array.isArray(metadata.securityGroupIds)
    ? metadata.securityGroupIds.filter((id): id is string => typeof id === 'string')
    : [];
  const securityGroupNames = Array.isArray(metadata.securityGroupNames)
    ? metadata.securityGroupNames.filter((name): name is string => typeof name === 'string')
    : [];
  const legacyRules = metadata.securityGroupRules as Record<string, unknown> | undefined;

  if (securityGroupIds.length === 0) {
    return undefined;
  }

  return securityGroupIds.map((groupId, index) => ({
    groupId,
    groupName: securityGroupNames[index],
    inboundRules: Array.isArray(legacyRules?.[groupId])
      ? (legacyRules?.[groupId] as Array<{
          protocol?: string;
          fromPort?: number;
          toPort?: number;
          cidr?: string;
        }>)
      : undefined,
  }));
}

export function resolveMetadataHttpTokens(metadata: Record<string, unknown>): string | undefined {
  const direct = metadata.metadataHttpTokens;
  if (typeof direct === 'string') {
    return direct;
  }
  const options = metadata.metadataOptions;
  if (typeof options === 'object' && options !== null) {
    const httpTokens = (options as { httpTokens?: unknown }).httpTokens;
    if (typeof httpTokens === 'string') {
      return httpTokens;
    }
  }
  return undefined;
}
