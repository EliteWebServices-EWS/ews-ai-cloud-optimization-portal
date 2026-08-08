import type { Ec2AsyncJobStage } from '../async-jobs/ec2-async-job-models';

export const EC2_ASYNC_JOB_STAGE_SEQUENCE: readonly Ec2AsyncJobStage[] = [
  'ENQUEUE',
  'DISCOVERY',
  'COST_ANALYSIS',
  'SECURITY_ANALYSIS',
  'GOVERNANCE_ANALYSIS',
  'FINALIZING',
  'COMPLETE',
] as const;

export function stageRank(stage: Ec2AsyncJobStage): number {
  return EC2_ASYNC_JOB_STAGE_SEQUENCE.indexOf(stage);
}

export function isStageAtOrBeyond(
  current: Ec2AsyncJobStage,
  boundary: Ec2AsyncJobStage,
): boolean {
  return stageRank(current) >= stageRank(boundary);
}

export function nextStage(stage: Ec2AsyncJobStage): Ec2AsyncJobStage | undefined {
  const index = stageRank(stage);
  if (index < 0 || index >= EC2_ASYNC_JOB_STAGE_SEQUENCE.length - 1) {
    return undefined;
  }
  return EC2_ASYNC_JOB_STAGE_SEQUENCE[index + 1];
}

export function regionsEqual(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  const a = [...left].sort();
  const b = [...right].sort();
  return a.every((value, index) => value === b[index]);
}
