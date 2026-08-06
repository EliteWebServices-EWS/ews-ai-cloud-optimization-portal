import type { Ec2NormalizedInboundRule } from '../plugins/ec2/ec2-discovery-security-group-normalizer';

export function ruleCoversPort(
  rule: Pick<Ec2NormalizedInboundRule, 'protocol' | 'fromPort' | 'toPort'>,
  port: number,
): boolean {
  const protocol = rule.protocol?.toLowerCase();
  if (protocol !== 'tcp' && protocol !== '-1' && protocol !== 'all') {
    return false;
  }
  if (protocol === '-1' || protocol === 'all') {
    return true;
  }
  const from = rule.fromPort ?? 0;
  const to = rule.toPort ?? 65_535;
  return from <= port && to >= port;
}

export function ruleCoversSensitiveExposure(
  rule: Ec2NormalizedInboundRule,
): 'ssh' | 'rdp' | 'all_traffic' | null {
  const protocol = rule.protocol?.toLowerCase();
  if (protocol === '-1' || protocol === 'all') {
    return 'all_traffic';
  }
  if (ruleCoversPort(rule, 22)) {
    return 'ssh';
  }
  if (ruleCoversPort(rule, 3389)) {
    return 'rdp';
  }
  return null;
}

export function hasResolvableCidrSource(rule: Ec2NormalizedInboundRule): boolean {
  if ((rule.ipv4Ranges?.length ?? 0) > 0 || (rule.ipv6Ranges?.length ?? 0) > 0) {
    return true;
  }
  const legacy = rule as Ec2NormalizedInboundRule & { cidr?: string };
  return typeof legacy.cidr === 'string' && legacy.cidr.length > 0;
}

export function isPrefixListOnlyRule(rule: Ec2NormalizedInboundRule): boolean {
  return (
    (rule.prefixListIds?.length ?? 0) > 0 &&
    !hasResolvableCidrSource(rule)
  );
}

export function findPrefixListOnlySensitiveRules(
  inboundRules: Ec2NormalizedInboundRule[] | undefined,
): Array<'ssh' | 'rdp' | 'all_traffic'> {
  if (!inboundRules?.length) {
    return [];
  }
  const kinds = new Set<'ssh' | 'rdp' | 'all_traffic'>();
  for (const rule of inboundRules) {
    if (!isPrefixListOnlyRule(rule)) {
      continue;
    }
    const exposure = ruleCoversSensitiveExposure(rule);
    if (exposure) {
      kinds.add(exposure);
    }
  }
  return [...kinds];
}

export function metadataHasPrefixListOnlySensitiveRules(
  metadata: Record<string, unknown>,
): boolean {
  const groups = metadata.securityGroups;
  if (!Array.isArray(groups)) {
    return false;
  }
  for (const group of groups) {
    if (typeof group !== 'object' || group === null) {
      continue;
    }
    const inboundRules = (group as { inboundRules?: unknown }).inboundRules;
    if (!Array.isArray(inboundRules)) {
      continue;
    }
    const normalized = inboundRules.filter(
      (rule): rule is Ec2NormalizedInboundRule =>
        typeof rule === 'object' && rule !== null,
    );
    if (findPrefixListOnlySensitiveRules(normalized).length > 0) {
      return true;
    }
  }
  return false;
}
