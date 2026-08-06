/** Normalized ingress rule shape persisted on INSTANCE metadata and consumed by the security mapper. */

export interface Ec2NormalizedInboundRule {
  protocol?: string;
  fromPort?: number;
  toPort?: number;
  ipv4Ranges?: string[];
  ipv6Ranges?: string[];
  prefixListIds?: string[];
}

export interface Ec2NormalizedSecurityGroup {
  groupId: string;
  groupName?: string;
  inboundRules: Ec2NormalizedInboundRule[];
}

/** Flatten normalized ingress into analyzer-compatible rules (one CIDR per rule). */
export function flattenInboundRulesForAnalyzer(
  inboundRules: Ec2NormalizedInboundRule[] | undefined,
): Array<{ protocol?: string; fromPort?: number; toPort?: number; cidr?: string }> | undefined {
  if (!inboundRules?.length) {
    return undefined;
  }
  const flat: Array<{ protocol?: string; fromPort?: number; toPort?: number; cidr?: string }> = [];
  for (const rule of inboundRules) {
    const protocol = rule.protocol?.toLowerCase();
    const base = {
      protocol,
      fromPort: rule.fromPort,
      toPort: rule.toPort,
    };
    for (const cidr of rule.ipv4Ranges ?? []) {
      flat.push({ ...base, cidr });
    }
    for (const cidr of rule.ipv6Ranges ?? []) {
      flat.push({ ...base, cidr });
    }
    if (
      (rule.ipv4Ranges?.length ?? 0) === 0 &&
      (rule.ipv6Ranges?.length ?? 0) === 0 &&
      (rule.prefixListIds?.length ?? 0) > 0
    ) {
      flat.push({ ...base, cidr: undefined });
    }
  }
  return flat.length > 0 ? flat : undefined;
}

export function normalizeAwsSecurityGroupPermission(permission: {
  IpProtocol?: string;
  FromPort?: number;
  ToPort?: number;
  IpRanges?: Array<{ CidrIp?: string }>;
  Ipv6Ranges?: Array<{ CidrIpv6?: string }>;
  PrefixListIds?: Array<{ PrefixListId?: string }>;
}): Ec2NormalizedInboundRule {
  return {
    protocol: permission.IpProtocol?.toLowerCase(),
    fromPort: permission.FromPort,
    toPort: permission.ToPort,
    ipv4Ranges: (permission.IpRanges ?? [])
      .map((r) => r.CidrIp)
      .filter((c): c is string => Boolean(c)),
    ipv6Ranges: (permission.Ipv6Ranges ?? [])
      .map((r) => r.CidrIpv6)
      .filter((c): c is string => Boolean(c)),
    prefixListIds: (permission.PrefixListIds ?? [])
      .map((p) => p.PrefixListId)
      .filter((id): id is string => Boolean(id)),
  };
}
