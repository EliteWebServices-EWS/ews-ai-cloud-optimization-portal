import { EC2_COST_LONG_RUNNING_MIN_AGE_DAYS } from './ec2-cost-limits';
import {
  defaultPricingAssumptions,
  monthlyEbsStorageCost,
  monthlyInstanceCost,
  suggestFamilyUpgrade,
  isSupportedForFamilyUpgrade,
  computeSavings,
} from './ec2-on-demand-pricing-catalog';
import { scoreConfidence } from './ec2-cost-confidence';
import type {
  Ec2CostAnalysisRule,
  Ec2CostRuleInput,
  Ec2CostRuleResult,
} from './ec2-cost-models';
import {
  volumesAttachedToInstance,
  volumesInUseWithoutAttachmentMetadata,
} from './ec2-volume-attachment';

function volumesForInstance(input: Ec2CostRuleInput) {
  return volumesAttachedToInstance(input.volumes, input.instance.resourceId);
}

function instanceState(input: Ec2CostRuleInput): string {
  return String(input.instance.metadata.state ?? '').toLowerCase();
}

function instanceType(input: Ec2CostRuleInput): string | undefined {
  const t = input.instance.metadata.instanceType;
  return typeof t === 'string' ? t : undefined;
}

function launchAgeDays(input: Ec2CostRuleInput): number | undefined {
  const launchTime = input.instance.metadata.launchTime;
  if (typeof launchTime !== 'string') {
    return undefined;
  }
  const ms = Date.parse(launchTime);
  if (Number.isNaN(ms)) {
    return undefined;
  }
  return (Date.now() - ms) / (24 * 60 * 60 * 1000);
}

function hasSufficientEvidence(input: Ec2CostRuleInput): boolean {
  const e = input.evidence;
  return Boolean(
    e &&
      e.dataCompleteness !== 'NO_DATA' &&
      e.dataCompleteness !== 'INSUFFICIENT' &&
      (e.actualSampleCount ?? 0) > 0,
  );
}

export const stoppedWithStorageRule: Ec2CostAnalysisRule = {
  ruleId: 'ec2.cost.stopped_with_storage',
  ruleVersion: '1.0.0',
  category: 'STOPPED_WITH_STORAGE',
  evaluate(input): Ec2CostRuleResult[] {
    if (input.instance.status !== 'ACTIVE') {
      return [];
    }
    if (instanceState(input) !== 'stopped') {
      return [];
    }
    const attached = volumesForInstance(input);
    if (attached.length === 0) {
      const ambiguous = volumesInUseWithoutAttachmentMetadata(input.volumes);
      if (ambiguous.length > 0) {
        return [
          {
            category: 'INSUFFICIENT_DATA',
            severity: 'LOW',
            confidenceScore: 0.2,
            confidenceLevel: 'LOW',
            title: 'Stopped instance — volume attachment metadata unavailable',
            summary:
              'EBS volumes are in-use but attachment instance IDs are not in inventory; rerun EC2 discovery to refresh volume attachments.',
            businessJustification:
              'Cost analysis cannot link volumes to instances without persisted attachment metadata.',
            recommendedAction:
              'Run EC2 discovery again, then rerun cost analysis after attachment metadata is populated.',
            evidenceSummary: `${ambiguous.length} in-use volume(s) without attachment metadata.`,
            observedValues: { inUseVolumesWithoutAttachmentMetadata: ambiguous.length },
            thresholds: { requiresAttachmentMetadata: true },
            pricingStatus: 'UNAVAILABLE',
            resourceType: 'INSTANCE',
            resourceId: input.instance.resourceId,
          },
        ];
      }
      return [];
    }
    let storageCost = 0;
    let pricingOk = true;
    for (const vol of attached) {
      const size = Number(vol.metadata.sizeGiB ?? 0);
      const type = String(vol.metadata.volumeType ?? 'gp3');
      const cost = monthlyEbsStorageCost(input.region, type, size);
      if (cost === undefined) {
        pricingOk = false;
      } else {
        storageCost += cost;
      }
    }
    const { score, level } = scoreConfidence({ pricingAvailable: pricingOk, launchTimeAvailable: true });
    return [
      {
        category: 'STOPPED_WITH_STORAGE',
        severity: 'MEDIUM',
        confidenceScore: score,
        confidenceLevel: level,
        title: 'Stopped instance with attached EBS storage',
        summary:
          'The instance is stopped (no compute charges) but attached EBS volumes may still incur storage costs.',
        businessJustification:
          'Stopped EC2 instances do not incur compute charges; attached EBS volumes continue storage billing until removed after approved review.',
        recommendedAction:
          'Review ownership and backups; snapshot if required; detach or delete unused volumes only after approval.',
        evidenceSummary: `${attached.length} attached volume(s) on stopped instance.`,
        observedValues: { volumeCount: attached.length, stoppedState: true },
        thresholds: { requiresStopped: true },
        currentMonthlyCost: pricingOk ? 0 : undefined,
        projectedMonthlyCost: pricingOk ? storageCost : undefined,
        estimatedMonthlySavings: pricingOk ? computeSavings(0, storageCost).monthly : undefined,
        estimatedAnnualSavings: pricingOk ? computeSavings(0, storageCost).annual : undefined,
        pricingStatus: pricingOk ? 'CONTROLLED_CATALOG_SAMPLE' : 'UNAVAILABLE',
        pricingAssumptions: defaultPricingAssumptions(input.region),
        resourceType: 'INSTANCE',
        resourceId: input.instance.resourceId,
      },
    ];
  },
};

export const idleInstanceRule: Ec2CostAnalysisRule = {
  ruleId: 'ec2.cost.idle_instance',
  ruleVersion: '1.0.0',
  category: 'RUNNING_IDLE_CANDIDATE',
  evaluate(input): Ec2CostRuleResult[] {
    if (instanceState(input) !== 'running' || input.instance.status !== 'ACTIVE') {
      return [];
    }
    const e = input.evidence;
    if (!e || e.dataCompleteness === 'NO_DATA') {
      return [
        {
          category: 'INSUFFICIENT_DATA',
          severity: 'LOW',
          confidenceScore: 0.2,
          confidenceLevel: 'LOW',
          title: 'Insufficient metrics for idle analysis',
          summary: 'CloudWatch did not return usable CPU samples for this instance.',
          businessJustification: 'Missing metrics cannot be treated as zero utilization.',
          recommendedAction: 'Retry analysis after metrics accumulate or verify CloudWatch agent permissions.',
          evidenceSummary: 'No CPU datapoints',
          observedValues: { dataCompleteness: e?.dataCompleteness ?? 'NO_DATA' },
          thresholds: { cpuAverageMax: 5, cpuMaximumMax: 15 },
          pricingStatus: 'UNAVAILABLE',
          resourceType: 'INSTANCE',
          resourceId: input.instance.resourceId,
        },
      ];
    }
    if (!hasSufficientEvidence(input)) {
      return [];
    }
    const cpuAvg = e.cpuAveragePercent ?? Number.POSITIVE_INFINITY;
    const cpuMax = e.cpuMaximumPercent ?? Number.POSITIVE_INFINITY;
    if (cpuAvg >= 5 || cpuMax >= 15) {
      return [];
    }
    const netIn = e.networkInAverageBytes ?? 0;
    const netOut = e.networkOutAverageBytes ?? 0;
    const networkLow = netIn < 1_000_000 && netOut < 1_000_000;
    const category = networkLow ? 'IDLE_HIGH_CONFIDENCE' : 'IDLE_MEDIUM_CONFIDENCE';
    const itype = instanceType(input);
    const current = itype ? monthlyInstanceCost(input.region, itype) : undefined;
    const { score, level } = scoreConfidence({
      evidence: e,
      pricingAvailable: current !== undefined,
      launchTimeAvailable: Boolean(input.instance.metadata.launchTime),
      networkLow,
    });
    return [
      {
        category,
        severity: networkLow ? 'HIGH' : 'MEDIUM',
        confidenceScore: score,
        confidenceLevel: level,
        title: 'Low utilization running instance',
        summary: `CPU average ${cpuAvg.toFixed(2)}% over ${input.observationDays} days.`,
        businessJustification:
          'Sustained low CPU may indicate idle capacity; memory utilization is not available from standard EC2 metrics.',
        recommendedAction:
          'Investigate workload ownership; consider scheduling or stop after approval; review downsizing after workload validation.',
        evidenceSummary: `CPU avg ${cpuAvg.toFixed(2)}%, max ${cpuMax.toFixed(2)}%`,
        observedValues: { cpuAveragePercent: cpuAvg, cpuMaximumPercent: cpuMax, networkLow },
        thresholds: { cpuAverageMax: 5, cpuMaximumMax: 15 },
        currentInstanceType: itype,
        currentMonthlyCost: current,
        pricingStatus: current !== undefined ? 'CONTROLLED_CATALOG_SAMPLE' : 'UNAVAILABLE',
        pricingAssumptions: defaultPricingAssumptions(input.region),
        resourceType: 'INSTANCE',
        resourceId: input.instance.resourceId,
      },
    ];
  },
};

export const longRunningIdleRule: Ec2CostAnalysisRule = {
  ruleId: 'ec2.cost.long_running_idle',
  ruleVersion: '1.0.0',
  category: 'LONG_RUNNING_IDLE',
  evaluate(input): Ec2CostRuleResult[] {
    const age = launchAgeDays(input);
    if (age === undefined || age < EC2_COST_LONG_RUNNING_MIN_AGE_DAYS) {
      return [];
    }
    if (instanceState(input) !== 'running') {
      return [];
    }
    if (!hasSufficientEvidence(input)) {
      return [];
    }
    const e = input.evidence!;
    if ((e.cpuAveragePercent ?? 100) >= 5) {
      return [];
    }
    const { score, level } = scoreConfidence({
      evidence: e,
      pricingAvailable: false,
      launchTimeAvailable: true,
    });
    return [
      {
        category: 'LONG_RUNNING_IDLE',
        severity: 'MEDIUM',
        confidenceScore: score,
        confidenceLevel: level,
        title: 'Long-running instance with sustained low CPU',
        summary: `Instance age ~${Math.floor(age)} days with low CPU over observation window.`,
        businessJustification: 'Older instances with persistent low CPU may be consolidation candidates.',
        recommendedAction: 'Validate ownership and scheduling; consider stop or resize only after approval.',
        evidenceSummary: `ageDays=${Math.floor(age)}`,
        observedValues: { ageDays: Math.floor(age), cpuAveragePercent: e.cpuAveragePercent },
        thresholds: { minAgeDays: EC2_COST_LONG_RUNNING_MIN_AGE_DAYS },
        pricingStatus: 'UNAVAILABLE',
        resourceType: 'INSTANCE',
        resourceId: input.instance.resourceId,
      },
    ];
  },
};

export const reviewDownsizeRule: Ec2CostAnalysisRule = {
  ruleId: 'ec2.cost.review_downsize',
  ruleVersion: '1.0.0',
  category: 'REVIEW_DOWNSIZE',
  evaluate(input): Ec2CostRuleResult[] {
    if (instanceState(input) !== 'running' || !hasSufficientEvidence(input)) {
      return [];
    }
    const e = input.evidence!;
    const p95 = e.cpuP95Percent ?? 100;
    const max = e.cpuMaximumPercent ?? 100;
    if (p95 >= 40 || max >= 60) {
      return [];
    }
    const itype = instanceType(input);
    if (!itype) {
      return [];
    }
    const { score, level } = scoreConfidence({ evidence: e, pricingAvailable: true, launchTimeAvailable: true });
    return [
      {
        category: 'REVIEW_DOWNSIZE',
        severity: 'LOW',
        confidenceScore: score,
        confidenceLevel: level,
        title: 'Review downsizing (advisory)',
        summary: 'CPU p95 and maximum suggest headroom; memory fit is not proven by CPU alone.',
        businessJustification: 'Conservative rightsizing review only — not an automatic resize.',
        recommendedAction: 'Review instance size with application owners before any change.',
        evidenceSummary: `cpuP95=${p95}`,
        observedValues: { cpuP95Percent: p95, cpuMaximumPercent: max },
        thresholds: { cpuP95Max: 40, cpuMaximumMax: 60 },
        currentInstanceType: itype,
        pricingStatus: 'UNAVAILABLE',
        resourceType: 'INSTANCE',
        resourceId: input.instance.resourceId,
      },
    ];
  },
};

export const reviewUpsizeRule: Ec2CostAnalysisRule = {
  ruleId: 'ec2.cost.review_upsize',
  ruleVersion: '1.0.0',
  category: 'REVIEW_UPSIZE',
  evaluate(input): Ec2CostRuleResult[] {
    if (instanceState(input) !== 'running' || !hasSufficientEvidence(input)) {
      return [];
    }
    const e = input.evidence!;
    const p95 = e.cpuP95Percent ?? 0;
    const max = e.cpuMaximumPercent ?? 0;
    if (p95 < 80 && max < 90) {
      return [];
    }
    if (max < 90 && p95 < 85) {
      return [];
    }
    const { score, level } = scoreConfidence({ evidence: e, pricingAvailable: false, launchTimeAvailable: true });
    return [
      {
        category: 'REVIEW_UPSIZE',
        severity: 'MEDIUM',
        confidenceScore: score,
        confidenceLevel: level,
        title: 'Review upsizing (advisory)',
        summary: 'Sustained high CPU may indicate undersized compute; verify memory and workload patterns.',
        businessJustification: 'CPU pressure alone does not guarantee memory constraints.',
        recommendedAction: 'Review capacity with owners before any instance type change.',
        evidenceSummary: `cpuP95=${p95}, cpuMax=${max}`,
        observedValues: { cpuP95Percent: p95, cpuMaximumPercent: max },
        thresholds: { cpuP95Min: 80 },
        pricingStatus: 'UNAVAILABLE',
        resourceType: 'INSTANCE',
        resourceId: input.instance.resourceId,
      },
    ];
  },
};

export const burstableCreditRule: Ec2CostAnalysisRule = {
  ruleId: 'ec2.cost.burst_credit',
  ruleVersion: '1.0.0',
  category: 'BURSTABLE_CREDIT_PRESSURE',
  evaluate(input): Ec2CostRuleResult[] {
    const itype = instanceType(input);
    if (!itype || !/^t[234]/i.test(itype)) {
      return [];
    }
    const e = input.evidence;
    if (!e) {
      return [];
    }
    const lowBalance = e.cpuCreditBalanceMinimum !== undefined && e.cpuCreditBalanceMinimum < 10;
    const surplus = (e.surplusCreditsChargedTotal ?? 0) > 0;
    if (!lowBalance && !surplus) {
      return [];
    }
    return [
      {
        category: 'BURSTABLE_CREDIT_PRESSURE',
        severity: 'MEDIUM',
        confidenceScore: 0.6,
        confidenceLevel: 'MEDIUM',
        title: 'Burstable credit pressure',
        summary: 'T-family credit balance or surplus charges indicate burst pressure.',
        businessJustification: 'Credit exhaustion can throttle performance; consider non-burstable types after review.',
        recommendedAction: 'Review workload steady-state CPU; consider instance family change after approval.',
        evidenceSummary: `creditMin=${e.cpuCreditBalanceMinimum}, surplus=${e.surplusCreditsChargedTotal}`,
        observedValues: {
          cpuCreditBalanceMinimum: e.cpuCreditBalanceMinimum,
          surplusCreditsChargedTotal: e.surplusCreditsChargedTotal,
        },
        thresholds: { creditBalanceMin: 10 },
        currentInstanceType: itype,
        pricingStatus: 'UNAVAILABLE',
        resourceType: 'INSTANCE',
        resourceId: input.instance.resourceId,
      },
    ];
  },
};

export const instanceFamilyUpgradeRule: Ec2CostAnalysisRule = {
  ruleId: 'ec2.cost.family_upgrade',
  ruleVersion: '1.0.0',
  category: 'INSTANCE_FAMILY_UPGRADE',
  evaluate(input): Ec2CostRuleResult[] {
    const itype = instanceType(input);
    if (!itype || !isSupportedForFamilyUpgrade(itype)) {
      return [];
    }
    const candidate = suggestFamilyUpgrade(itype);
    if (!candidate) {
      return [];
    }
    const current = monthlyInstanceCost(input.region, itype);
    const projected = monthlyInstanceCost(input.region, candidate);
    const savings = computeSavings(current, projected);
    return [
      {
        category: 'INSTANCE_FAMILY_UPGRADE',
        severity: 'LOW',
        confidenceScore: 0.55,
        confidenceLevel: 'MEDIUM',
        title: 'Review instance family upgrade',
        summary: `Catalog suggests reviewing migration from ${itype} toward ${candidate}.`,
        businessJustification: 'Generation upgrades may improve price/performance; licensing and architecture compatibility must be validated.',
        recommendedAction: 'Review migration — do not perform automatic instance family change.',
        evidenceSummary: `candidate=${candidate}`,
        observedValues: { currentInstanceType: itype, candidateInstanceType: candidate },
        thresholds: { catalogVersion: '2026-08-01-ec2-cost-v1' },
        currentInstanceType: itype,
        candidateInstanceType: candidate,
        currentMonthlyCost: current,
        projectedMonthlyCost: projected,
        estimatedMonthlySavings: savings.monthly,
        estimatedAnnualSavings: savings.annual,
        pricingStatus:
          current !== undefined && projected !== undefined
            ? 'CONTROLLED_CATALOG_SAMPLE'
            : 'UNAVAILABLE',
        pricingAssumptions: defaultPricingAssumptions(input.region),
        resourceType: 'INSTANCE',
        resourceId: input.instance.resourceId,
      },
    ];
  },
};

export const ALL_EC2_COST_RULES: Ec2CostAnalysisRule[] = [
  stoppedWithStorageRule,
  idleInstanceRule,
  longRunningIdleRule,
  reviewDownsizeRule,
  reviewUpsizeRule,
  burstableCreditRule,
  instanceFamilyUpgradeRule,
];
