import type { Ec2PerformanceEvidence } from './ec2-cost-models';

export interface Ec2MetricsCollectionTarget {
  region: string;
  instanceId: string;
  instanceType?: string;
}

export interface Ec2MetricsCollectionRequest {
  region: string;
  targets: Ec2MetricsCollectionTarget[];
  observationDays: number;
  periodSeconds: number;
  endTime: Date;
}

export interface Ec2PerformanceMetricsClientPort {
  collectMetrics(
    request: Ec2MetricsCollectionRequest,
  ): Promise<Ec2PerformanceEvidence[]>;
}

export type Ec2PerformanceMetricsClientFactory = (
  region: string,
) => Ec2PerformanceMetricsClientPort;
