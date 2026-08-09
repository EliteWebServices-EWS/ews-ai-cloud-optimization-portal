/**
 * Maps backend EC2 async job status/stage to user-facing progress labels.
 */

import type { Ec2AsyncJobStage, Ec2AsyncJobStatus } from '../api/ec2-async-job-types';

export type Ec2AsyncJobProgressLabel =
  | 'Queued'
  | 'Starting'
  | 'Discovering Resources'
  | 'Running Cost Analysis'
  | 'Running Security Analysis'
  | 'Running Governance Analysis'
  | 'Generating Recommendations'
  | 'Completed'
  | 'Failed'
  | 'Processing';

export interface Ec2AsyncJobDisplayState {
  label: Ec2AsyncJobProgressLabel;
  /** Approximate milestone for progress bar; reflects stage order, not real work %. */
  milestonePercent: number;
  terminal: boolean;
  failed: boolean;
  succeeded: boolean;
}

const MILESTONES: Record<Ec2AsyncJobProgressLabel, number> = {
  Queued: 5,
  Starting: 10,
  'Discovering Resources': 25,
  'Running Cost Analysis': 45,
  'Running Security Analysis': 65,
  'Running Governance Analysis': 80,
  'Generating Recommendations': 90,
  Completed: 100,
  Failed: 100,
  Processing: 15,
};

export function mapEc2AsyncJobToDisplayState(
  status: Ec2AsyncJobStatus,
  stage: Ec2AsyncJobStage,
  options?: { localStarting?: boolean },
): Ec2AsyncJobDisplayState {
  if (options?.localStarting && status === 'QUEUED') {
    return {
      label: 'Starting',
      milestonePercent: MILESTONES.Starting,
      terminal: false,
      failed: false,
      succeeded: false,
    };
  }

  if (status === 'FAILED') {
    return {
      label: 'Failed',
      milestonePercent: MILESTONES.Failed,
      terminal: true,
      failed: true,
      succeeded: false,
    };
  }

  if (status === 'SUCCEEDED' || (status === 'PARTIAL' && stage === 'COMPLETE')) {
    return {
      label: 'Completed',
      milestonePercent: MILESTONES.Completed,
      terminal: true,
      failed: false,
      succeeded: true,
    };
  }

  if (status === 'QUEUED') {
    return {
      label: 'Queued',
      milestonePercent: MILESTONES.Queued,
      terminal: false,
      failed: false,
      succeeded: false,
    };
  }

  if (status === 'RUNNING') {
    switch (stage) {
      case 'DISCOVERY':
        return step('Discovering Resources');
      case 'COST_ANALYSIS':
        return step('Running Cost Analysis');
      case 'SECURITY_ANALYSIS':
        return step('Running Security Analysis');
      case 'GOVERNANCE_ANALYSIS':
        return step('Running Governance Analysis');
      case 'FINALIZING':
        return step('Generating Recommendations');
      case 'ENQUEUE':
        return step('Starting');
      case 'COMPLETE':
        return step('Generating Recommendations');
      default:
        return step('Processing');
    }
  }

  return {
    label: 'Processing',
    milestonePercent: MILESTONES.Processing,
    terminal: false,
    failed: false,
    succeeded: false,
  };
}

function step(label: Ec2AsyncJobProgressLabel): Ec2AsyncJobDisplayState {
  return {
    label,
    milestonePercent: MILESTONES[label] ?? MILESTONES.Processing,
    terminal: false,
    failed: false,
    succeeded: false,
  };
}

export const EC2_ASYNC_PROGRESS_STEPS: Ec2AsyncJobProgressLabel[] = [
  'Queued',
  'Starting',
  'Discovering Resources',
  'Running Cost Analysis',
  'Running Security Analysis',
  'Running Governance Analysis',
  'Generating Recommendations',
  'Completed',
];

export function isTerminalJobStatus(status: Ec2AsyncJobStatus, stage: Ec2AsyncJobStage): boolean {
  return mapEc2AsyncJobToDisplayState(status, stage).terminal;
}
