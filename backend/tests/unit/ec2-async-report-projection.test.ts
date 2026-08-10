import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { MockEc2AsyncJobRepository } from '../../repositories/mock/mock-ec2-async-job-repository';
import { MockEc2CloudResourceRepository } from '../../repositories/mock/mock-ec2-cloud-resource-repository';
import { MockEc2CostRepository } from '../../repositories/mock/mock-ec2-cost-repository';
import { MockEc2SecurityRepository } from '../../repositories/mock/mock-ec2-security-repository';
import { createReportingEngine } from '../../engines/reporting';
import { Ec2AsyncReportProjectionService } from '../../services/ec2-async-report-projection-service';
import {
  ec2AsyncJobCostRunId,
  ec2AsyncJobDiscoveryRunId,
  ec2AsyncJobSecurityRunId,
} from '../../services/ec2-async-job-stage-runs';
import { REPORT_SOURCE } from '../../shared/constants';
import { deriveEc2AsyncReportId } from '../../shared/utils';
import { DynamoDbReportRepository } from '../../engines/reporting/dynamodb-report.repository';
import { createLinkedFakePersistenceTables } from './support/fake-persistence-table';
import type { Ec2AsyncJobRecord } from '../../async-jobs/ec2-async-job-models';
import { Ec2AsyncJobConsumerRetryableError } from '../../services/ec2-async-job-consumer-errors';

const TENANT = 'tenant-report-proj';
const ACCOUNT = '572262081497';

function createProjection(deps?: {
  cloud?: MockEc2CloudResourceRepository;
  cost?: MockEc2CostRepository;
  security?: MockEc2SecurityRepository;
}) {
  const cloud = deps?.cloud ?? new MockEc2CloudResourceRepository();
  const cost = deps?.cost ?? new MockEc2CostRepository();
  const security = deps?.security ?? new MockEc2SecurityRepository();
  const reportingEngine = createReportingEngine();

  return {
    projection: new Ec2AsyncReportProjectionService({
      reportingEngine,
      discoveryRuns: cloud,
      costRuns: cost,
      costRecommendations: cost,
      securityRuns: security,
      securitySummaries: security,
      securityFindings: security,
    }),
    reportingEngine,
    cloud,
    cost,
    security,
  };
}

async function seedCompletedZeroInstanceJob(jobId: string) {
  const jobs = new MockEc2AsyncJobRepository();
  const job = await jobs.createIdempotentJob({
    tenantId: TENANT,
    jobId,
    accountId: ACCOUNT,
    regions: ['us-east-1'],
    jobType: 'EC2_INTELLIGENCE',
    correlationId: 'corr-report',
    idempotencyKey: `idem-${jobId}`,
    requestFingerprint: 'fp',
  });

  const completedAt = new Date().toISOString();
  await jobs.updateJob(
    TENANT,
    jobId,
    {
      status: 'RUNNING',
      stage: 'FINALIZING',
      startedAt: completedAt,
    },
    { expectedVersion: job.version },
  );

  return jobs.getJob(TENANT, jobId);
}

describe('Ec2AsyncReportProjectionService', () => {
  it('projects a truthful zero-instance report exactly once', async () => {
    process.env.WORKFLOW_DEMO_REPORTS_ENABLED = 'false';
    const jobId = 'job-zero-report';
    const { projection, reportingEngine, cloud, cost, security } = createProjection();
    const job = await seedCompletedZeroInstanceJob(jobId);
    assert.ok(job);

    const discoveryRunId = ec2AsyncJobDiscoveryRunId(jobId);
    const costRunId = ec2AsyncJobCostRunId(jobId);
    const securityRunId = ec2AsyncJobSecurityRunId(jobId);
    const startedAt = new Date().toISOString();

    await cloud.createRun({
      runId: discoveryRunId,
      tenantId: TENANT,
      accountId: ACCOUNT,
      requestedRegions: ['us-east-1'],
      startedAt,
    });
    const discoveryRun = await cloud.getRun(TENANT, ACCOUNT, discoveryRunId);
    assert.ok(discoveryRun);
    await cloud.completeRun({
      tenantId: TENANT,
      accountId: ACCOUNT,
      runId: discoveryRunId,
      expectedVersion: discoveryRun.version,
      status: 'SUCCEEDED',
      completedAt: startedAt,
      resourceCounts: { INSTANCE: 0 },
      regionsSucceeded: ['us-east-1'],
      regionsFailed: [],
      warnings: [],
    });

    await cost.createRun({
      runId: costRunId,
      tenantId: TENANT,
      accountId: ACCOUNT,
      regions: ['us-east-1'],
      observationDays: 14,
      periodSeconds: 3600,
      requestedAt: startedAt,
      startedAt,
    });
    const costRun = await cost.getRun(TENANT, ACCOUNT, costRunId);
    assert.ok(costRun);
    await cost.completeRun({
      tenantId: TENANT,
      accountId: ACCOUNT,
      runId: costRunId,
      expectedVersion: costRun.version,
      status: 'SUCCEEDED',
      completedAt: startedAt,
      instancesFound: 0,
      instancesEvaluated: 0,
      recommendationsCreated: 0,
      recommendationsUpdated: 0,
      recommendationsResolved: 0,
      insufficientDataCount: 0,
      regionsSucceeded: ['us-east-1'],
      regionsFailed: [],
      warnings: [],
    });

    await security.createRun({
      runId: securityRunId,
      tenantId: TENANT,
      accountId: ACCOUNT,
      regions: ['us-east-1'],
      startedAt,
    });
    const securityRun = await security.getRun(TENANT, ACCOUNT, securityRunId);
    assert.ok(securityRun);
    await security.completeRun({
      tenantId: TENANT,
      accountId: ACCOUNT,
      runId: securityRunId,
      expectedVersion: securityRun.version,
      status: 'SUCCEEDED',
      completedAt: startedAt,
      instancesFound: 0,
      instancesAnalyzed: 0,
      findingsCreated: 0,
      findingsUpdated: 0,
      findingsResolved: 0,
    });
    await security.upsertSummary({
      tenantId: TENANT,
      accountId: ACCOUNT,
      region: 'us-east-1',
      securityScore: 0,
      governanceScore: 0,
      complianceScore: 0,
      riskLevel: 'low',
      instancesAnalyzed: 0,
      openFindingCount: 0,
      analyzedAt: startedAt,
      analysisRunId: securityRunId,
      version: 1,
      createdAt: startedAt,
      updatedAt: startedAt,
    });

    const report = await projection.projectReportForCompletedJob({
      ...job,
      status: 'RUNNING',
      stage: 'FINALIZING',
    });
    assert.equal(report.reportSource, REPORT_SOURCE.EC2_ASYNC);
    assert.equal(report.ec2AsyncJobId, jobId);
    assert.equal(report.recommendations.length, 0);
    assert.equal(report.summary.opportunityCount, 0);
    assert.equal(report.financialImpact.estimatedMonthlySavings, 0);
    assert.equal(report.status, 'complete');
    assert.equal(report.governance?.readinessStatus, 'NO_ASSESSMENT');
    assert.equal(report.governance?.decision, 'GOVERNANCE_STAGE_COMPLETE');
    assert.equal(report.evidence?.status, 'COMPLETE');
    assert.ok(report.evidence?.warnings.some((w) => w.includes('completed')));
    assert.ok(!report.summary.headline.includes('i-mock-001'));
    assert.ok(!JSON.stringify(report).includes('t3.large'));
    assert.ok(!JSON.stringify(report).includes('100%'));
    assert.ok(!report.recommendations.some((entry) => entry.resourceId.includes('mock')));

    const replay = await projection.projectReportForCompletedJob({
      ...job,
      status: 'RUNNING',
      stage: 'FINALIZING',
    });
    assert.equal(replay.reportId, report.reportId);

    const listed = await reportingEngine.listReports(TENANT);
    assert.equal(listed.filter((item) => item.ec2AsyncJobId === jobId).length, 1);
  });

  it('preserves cost recommendation confidence without fabricating scores', async () => {
    const jobId = 'job-with-rec';
    const { projection, cloud, cost, security } = createProjection();
    const jobs = new MockEc2AsyncJobRepository();
    const seeded = await jobs.createIdempotentJob({
      tenantId: TENANT,
      jobId,
      accountId: ACCOUNT,
      regions: ['us-east-1'],
      jobType: 'EC2_INTELLIGENCE',
      correlationId: 'corr-rec',
      idempotencyKey: 'idem-rec',
      requestFingerprint: 'fp-rec',
    });
    const job = await jobs.getJob(TENANT, jobId);
    assert.ok(job);

    const costRunId = ec2AsyncJobCostRunId(jobId);
    const startedAt = new Date().toISOString();
    await cost.createRun({
      runId: costRunId,
      tenantId: TENANT,
      accountId: ACCOUNT,
      regions: ['us-east-1'],
      observationDays: 14,
      periodSeconds: 3600,
      requestedAt: startedAt,
      startedAt,
    });
    const costRun = await cost.getRun(TENANT, ACCOUNT, costRunId);
    assert.ok(costRun);
    await cost.completeRun({
      tenantId: TENANT,
      accountId: ACCOUNT,
      runId: costRunId,
      expectedVersion: costRun.version,
      status: 'SUCCEEDED',
      completedAt: startedAt,
      instancesFound: 1,
      instancesEvaluated: 1,
      recommendationsCreated: 1,
      recommendationsUpdated: 0,
      recommendationsResolved: 0,
      insufficientDataCount: 0,
      regionsSucceeded: ['us-east-1'],
      regionsFailed: [],
      warnings: [],
    });

    await cost.upsertRecommendation({
      findingKey: 'fk-live-1',
      recommendation: {
        tenantId: TENANT,
        accountId: ACCOUNT,
        region: 'us-east-1',
        service: 'ec2',
        resourceType: 'INSTANCE',
        resourceId: 'i-abc123',
        category: 'REVIEW_DOWNSIZE',
        severity: 'MEDIUM',
        confidenceScore: 72,
        confidenceLevel: 'MEDIUM',
        title: 'Review instance size',
        summary: 'CPU utilization supports downsizing.',
        businessJustification: 'Cost reduction',
        recommendedAction: 'Review resize',
        evidenceSummary: 'Low CPU',
        observedValues: {},
        thresholds: {},
        currentInstanceType: 't3.large',
        candidateInstanceType: 't3.medium',
        estimatedMonthlySavings: 12.5,
        pricingStatus: 'VERIFIED_RATE',
        analysisRunId: costRunId,
        ruleId: 'rule-1',
        ruleVersion: '1',
        findingKey: 'fk-live-1',
      },
    });

    const securityRunId = ec2AsyncJobSecurityRunId(jobId);
    await security.createRun({
      runId: securityRunId,
      tenantId: TENANT,
      accountId: ACCOUNT,
      regions: ['us-east-1'],
      startedAt,
    });
    const securityRun = await security.getRun(TENANT, ACCOUNT, securityRunId);
    assert.ok(securityRun);
    await security.completeRun({
      tenantId: TENANT,
      accountId: ACCOUNT,
      runId: securityRunId,
      expectedVersion: securityRun.version,
      status: 'SUCCEEDED',
      completedAt: startedAt,
      instancesFound: 1,
      instancesAnalyzed: 1,
      findingsCreated: 0,
      findingsUpdated: 0,
      findingsResolved: 0,
    });

    const report = await projection.projectReportForCompletedJob({
      ...job,
      status: 'RUNNING',
      stage: 'FINALIZING',
    });

    assert.equal(report.recommendations.length, 1);
    assert.equal(report.recommendations[0]?.resourceId, 'i-abc123');
    assert.equal(report.recommendations[0]?.decision.confidenceScore, 72);
    assert.equal(report.recommendations[0]?.decision.confidenceStatus, 'MEDIUM');
    assert.notEqual(report.recommendations[0]?.resourceId, 'i-mock-001');
    void seeded;
    void cloud;
  });

  it('retries safely after a transient persistence failure', async () => {
    const jobId = 'job-retry-projection';
    const { projection, reportingEngine, cloud, cost, security } = createProjection();
    let failSave = true;
    const save = reportingEngine.saveEc2AsyncReportIfAbsent.bind(reportingEngine);
    reportingEngine.saveEc2AsyncReportIfAbsent = async (report) => {
      if (failSave) {
        failSave = false;
        throw new Error('simulated persistence failure');
      }
      return save(report);
    };

    const job = await seedCompletedZeroInstanceJob(jobId);
    assert.ok(job);
    await seedMinimalStageSuccess(jobId, cloud, cost, security);

    await assert.rejects(
      () =>
        projection.projectReportForCompletedJob({
          ...job,
          status: 'RUNNING',
          stage: 'FINALIZING',
        }),
      (error: unknown) => error instanceof Ec2AsyncJobConsumerRetryableError,
    );

    const report = await projection.projectReportForCompletedJob({
      ...job,
      status: 'RUNNING',
      stage: 'FINALIZING',
    });
    assert.equal(report.reportId, deriveEc2AsyncReportId(TENANT, jobId));
    const listed = await reportingEngine.listReports(TENANT);
    assert.equal(listed.filter((item) => item.ec2AsyncJobId === jobId).length, 1);
  });

  it('creates only one report under concurrent projection', async () => {
    const jobId = 'job-concurrent-report';
    const { reports, ownership } = createLinkedFakePersistenceTables();
    const repository = new DynamoDbReportRepository(reports, ownership);
    const reportingEngine = createReportingEngine({ repository });
    const cloud = new MockEc2CloudResourceRepository();
    const cost = new MockEc2CostRepository();
    const security = new MockEc2SecurityRepository();
    const projection = new Ec2AsyncReportProjectionService({
      reportingEngine,
      discoveryRuns: cloud,
      costRuns: cost,
      costRecommendations: cost,
      securityRuns: security,
      securitySummaries: security,
      securityFindings: security,
    });

    const job = await seedCompletedZeroInstanceJob(jobId);
    assert.ok(job);
    await seedMinimalStageSuccess(jobId, cloud, cost, security);

    const runnableJob: Ec2AsyncJobRecord = {
      ...job,
      status: 'RUNNING',
      stage: 'FINALIZING',
    };

    const [first, second] = await Promise.all([
      projection.projectReportForCompletedJob(runnableJob),
      projection.projectReportForCompletedJob(runnableJob),
    ]);
    assert.equal(first.reportId, second.reportId);
    assert.equal(first.reportId, deriveEc2AsyncReportId(TENANT, jobId));

    const listed = await reportingEngine.listReports(TENANT);
    assert.equal(listed.filter((item) => item.ec2AsyncJobId === jobId).length, 1);
  });
});

async function seedMinimalStageSuccess(
  jobId: string,
  cloud: MockEc2CloudResourceRepository,
  cost: MockEc2CostRepository,
  security: MockEc2SecurityRepository,
): Promise<void> {
  const discoveryRunId = ec2AsyncJobDiscoveryRunId(jobId);
  const costRunId = ec2AsyncJobCostRunId(jobId);
  const securityRunId = ec2AsyncJobSecurityRunId(jobId);
  const startedAt = new Date().toISOString();

  await cloud.createRun({
    runId: discoveryRunId,
    tenantId: TENANT,
    accountId: ACCOUNT,
    requestedRegions: ['us-east-1'],
    startedAt,
  });
  const discoveryRun = await cloud.getRun(TENANT, ACCOUNT, discoveryRunId);
  assert.ok(discoveryRun);
  await cloud.completeRun({
    tenantId: TENANT,
    accountId: ACCOUNT,
    runId: discoveryRunId,
    expectedVersion: discoveryRun.version,
    status: 'SUCCEEDED',
    completedAt: startedAt,
    resourceCounts: { INSTANCE: 0 },
    regionsSucceeded: ['us-east-1'],
    regionsFailed: [],
    warnings: [],
  });

  await cost.createRun({
    runId: costRunId,
    tenantId: TENANT,
    accountId: ACCOUNT,
    regions: ['us-east-1'],
    observationDays: 14,
    periodSeconds: 3600,
    requestedAt: startedAt,
    startedAt,
  });
  const costRun = await cost.getRun(TENANT, ACCOUNT, costRunId);
  assert.ok(costRun);
  await cost.completeRun({
    tenantId: TENANT,
    accountId: ACCOUNT,
    runId: costRunId,
    expectedVersion: costRun.version,
    status: 'SUCCEEDED',
    completedAt: startedAt,
    instancesFound: 0,
    instancesEvaluated: 0,
    recommendationsCreated: 0,
    recommendationsUpdated: 0,
    recommendationsResolved: 0,
    insufficientDataCount: 0,
    regionsSucceeded: ['us-east-1'],
    regionsFailed: [],
    warnings: [],
  });

  await security.createRun({
    runId: securityRunId,
    tenantId: TENANT,
    accountId: ACCOUNT,
    regions: ['us-east-1'],
    startedAt,
  });
  const securityRun = await security.getRun(TENANT, ACCOUNT, securityRunId);
  assert.ok(securityRun);
  await security.completeRun({
    tenantId: TENANT,
    accountId: ACCOUNT,
    runId: securityRunId,
    expectedVersion: securityRun.version,
    status: 'SUCCEEDED',
    completedAt: startedAt,
    instancesFound: 0,
    instancesAnalyzed: 0,
    findingsCreated: 0,
    findingsUpdated: 0,
    findingsResolved: 0,
  });
  await security.upsertSummary({
    tenantId: TENANT,
    accountId: ACCOUNT,
    region: 'us-east-1',
    securityScore: 0,
    governanceScore: 0,
    complianceScore: 0,
    riskLevel: 'low',
    instancesAnalyzed: 0,
    openFindingCount: 0,
    analyzedAt: startedAt,
    analysisRunId: securityRunId,
    version: 1,
    createdAt: startedAt,
    updatedAt: startedAt,
  });
}
