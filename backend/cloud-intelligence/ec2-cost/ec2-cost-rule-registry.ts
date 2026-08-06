import type { Ec2CostAnalysisRule } from './ec2-cost-models';

export class Ec2CostRuleRegistry {
  private readonly rules = new Map<string, Ec2CostAnalysisRule>();

  register(rule: Ec2CostAnalysisRule): void {
    if (this.rules.has(rule.ruleId)) {
      throw new Error(`EC2 cost rule already registered: ${rule.ruleId}`);
    }
    this.rules.set(rule.ruleId, rule);
  }

  get(ruleId: string): Ec2CostAnalysisRule {
    const rule = this.rules.get(ruleId);
    if (!rule) {
      throw new Error(`Unsupported EC2 cost rule: ${ruleId}`);
    }
    return rule;
  }

  list(): Ec2CostAnalysisRule[] {
    return [...this.rules.values()];
  }
}

export function createEc2CostRuleRegistry(rules: Ec2CostAnalysisRule[]): Ec2CostRuleRegistry {
  const registry = new Ec2CostRuleRegistry();
  for (const rule of rules) {
    registry.register(rule);
  }
  return registry;
}
