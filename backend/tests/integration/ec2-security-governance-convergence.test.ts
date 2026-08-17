import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Ec2SecurityAnalysisOrchestrator } from '../../cloud-intelligence/ec2-security/ec2-security-analysis-orchestrator';
import { buildEc2SecurityFindingKey, EC2_SECURITY_RULE_VERSION } from '../../database';
import { buildGovernanceConvergenceFindingKey } from '../../database/cloud-resources/governance-convergence-keys';
import { GOVERNANCE_TRACKED_CHECKS } from '../../governance-convergence/governance-evidence-reuse';
import { GOVERNANCE_CONVERGENCE_REASON } from '../../governance-convergence/reason-codes';
import { MockEc2CloudResourceRepository } from '../../repositories/mock/mock-ec2-cloud-resource-repository';
import { MockEc2SecurityRepository } from '../../repositories/mock/mock-ec2-security-repository';
import { MockGovernanceConvergenceRepository } from '../../repositories/mock/mock-governance-convergence-repository';
import { GovernanceConvergenceService } from '../../services/governance-convergence-service';

const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';
const ACCOUNT_A = '111122223333';
const ACCOUNT_B = '444455556666';
const REGION = 'us-east-1';

async function seedCompliantInstance(
  resources: MockEc2CloudResourceRepository,
  params: { tenantId: string; accountId: string; instanceId?: string },
): Promise<string> {
  const instanceId = params.instanceId ?? 'i-safe';
  await resources.upsertDiscoveredResource({
    tenantId: params.tenantId,
    accountId: params.accountId,
    region: REGION,
    resourceType: 'INSTANCE',
    resourceId: instanceId,
    tags: [
      { key: 'Name', value: 'web-server-01' },
      { key: 'Environment', value: 'production' },
      { key: 'Owner', value: 'platform' },
    ],
    status: 'ACTIVE',
    metadata: {
      instanceType: 't3.large',
      metadataOptions: { httpTokens: 'required' },
      monitoringState: 'enabled',
      iamInstanceProfileArn: 'arn:aws:iam::123456789012:instance-profile/ec2',
      securityGroups: [
        {
          groupId: 'sg-safe',
          inboundRules: [
            { protocol: 'tcp', fromPort: 443, toPort: 443, ipv4Ranges: ['10.0.0.0/8'] },
          ],
        },
      ],
      backupPolicy: { enabled: true },
    },
    discoveredAt: '2026-01-01T00:00:00.000Z',
  });
  await resources.upsertDiscoveredResource({
    tenantId: params.tenantId,
    accountId: params.accountId,
    region: REGION,
    resourceType: 'VOLUME',
    resourceId: `vol-${instanceId}`,
    tags: [],
    status: 'ACTIVE',
    metadata: {
      encrypted: true,
      attachments: [{ instanceId, state: 'attached' }],
    },
    discoveredAt: '2026-01-01T00:00:00.000Z',
  });
  return instanceId;
}

async function seedSshViolationInstance(
  resources: MockEc2CloudResourceRepository,
  params: { tenantId: string; accountId: string; instanceId?: string },
): Promise<string> {
  const instanceId = params.instanceId ?? 'i-ssh-open';
  await resources.upsertDiscoveredResource({
    tenantId: params.tenantId,
    accountId: params.accountId,
    region: REGION,
    resourceType: 'INSTANCE',
    resourceId: instanceId,
    tags: [
      { key: 'Name', value: 'web-server-01' },
      { key: 'Environment', value: 'production' },
      { key: 'Owner', value: 'platform' },
    ],
    status: 'ACTIVE',
    metadata: {
      instanceType: 't3.large',
      metadataOptions: { httpTokens: 'required' },
      monitoringState: 'enabled',
      iamInstanceProfileArn: 'arn:aws:iam::123456789012:instance-profile/ec2',
      securityGroups: [
        {
          groupId: 'sg-open',
          inboundRules: [
            { protocol: 'tcp', fromPort: 22, toPort: 22, ipv4Ranges: ['0.0.0.0/0'] },
          ],
        },
      ],
      backupPolicy: { enabled: true },
    },
    discoveredAt: '2026-01-01T00:00:00.000Z',
  });
  await resources.upsertDiscoveredResource({
    tenantId: params.tenantId,
    accountId: params.accountId,
    region: REGION,
    resourceType: 'VOLUME',
    resourceId: `vol-${instanceId}`,
    tags: [],
    status: 'ACTIVE',
    metadata: {
      encrypted: true,
      attachments: [{ instanceId, state: 'attached' }],
    },
    discoveredAt: '2026-01-01T00:00:00.000Z',
  });
  return instanceId;
}

async function seedInsufficientSecurityGroupInstance(
  resources: MockEc2CloudResourceRepository,
  params: { tenantId: string; accountId: string; instanceId?: string },
): Promise<string> {
  const instanceId = params.instanceId ?? 'i-insufficient-sg';
  await resources.upsertDiscoveredResource({
    tenantId: params.tenantId,
    accountId: params.accountId,
    region: REGION,
    resourceType: 'INSTANCE',
    resourceId: instanceId,
    tags: [
      { key: 'Name', value: 'web-server-01' },
      { key: 'Environment', value: 'production' },
      { key: 'Owner', value: 'platform' },
    ],
    status: 'ACTIVE',
    metadata: {
      instanceType: 't3.micro',
      metadataOptions: { httpTokens: 'required' },
      monitoringState: 'enabled',
      securityGroupIds: ['sg-1'],
      securityGroups: [{ groupId: 'sg-1', inboundRules: [] }],
    },
    discoveredAt: '2026-01-01T00:00:00.000Z',
  });
  await resources.upsertDiscoveredResource({
    tenantId: params.tenantId,
    accountId: params.accountId,
    region: REGION,
    resourceType: 'VOLUME',
    resourceId: `vol-${instanceId}`,
    tags: [],
    status: 'ACTIVE',
    metadata: {
      encrypted: true,
      attachments: [{ instanceId, state: 'attached' }],
    },
    discoveredAt: '2026-01-01T00:00:00.000Z',
  });
  return instanceId;
}

function sshFindingKey(tenantId: string, accountId: string, instanceId: string): string {
  return buildGovernanceConvergenceFindingKey({
    tenantId,
    accountId,
    region: REGION,
    resourceId: instanceId,
    check: GOVERNANCE_TRACKED_CHECKS.SSH_EXPOSURE,
  });
}

async function seedSuccessfulDiscoveryRun(
  resources: MockEc2CloudResourceRepository,
  params: { tenantId: string; accountId: string; regions: string[] },
): Promise<void> {
  const run = await resources.createRun({
    runId: `discovery-${params.regions.join('-')}`,
    tenantId: params.tenantId,
    accountId: params.accountId,
    requestedRegions: params.regions,
    startedAt: '2026-01-01T00:00:00.000Z',
  });
  await resources.completeRun({
    tenantId: params.tenantId,
    accountId: params.accountId,
    runId: run.runId,
    expectedVersion: run.version,
    status: 'SUCCEEDED',
    completedAt: '2026-01-01T00:05:00.000Z',
    resourceCounts: { INSTANCE: 1 },
    regionsSucceeded: params.regions,
    regionsFailed: [],
    warnings: [],
  });
}

class AbsentObservationGovernanceService extends GovernanceConvergenceService {
  constructor(
    repository: MockGovernanceConvergenceRepository,
    resources: MockEc2CloudResourceRepository,
    private readonly suppressFindingKey: string,
  ) {
    super(repository, resources);
  }

  protected override shouldRecordCurrentObservation(findingKey: string): boolean {
    return findingKey !== this.suppressFindingKey;
  }
}

function createOrchestrator(
  resources: MockEc2CloudResourceRepository,
  security: MockEc2SecurityRepository,
  convergenceRepo: MockGovernanceConvergenceRepository,
  convergence?: GovernanceConvergenceService,
): Ec2SecurityAnalysisOrchestrator {
  const service = convergence ?? new GovernanceConvergenceService(convergenceRepo, resources);
  return new Ec2SecurityAnalysisOrchestrator(
    resources,
    security,
    security,
    security,
    service,
  );
}

describe('EC2 security governance convergence integration', () => {
  it('records PRESERVED when the same compliant control is analyzed twice', async () => {
    const resources = new MockEc2CloudResourceRepository();
    const security = new MockEc2SecurityRepository();
    const convergenceRepo = new MockGovernanceConvergenceRepository();
    const instanceId = await seedCompliantInstance(resources, { tenantId: TENANT_A, accountId: ACCOUNT_A });
    await seedSuccessfulDiscoveryRun(resources, {
      tenantId: TENANT_A,
      accountId: ACCOUNT_A,
      regions: [REGION],
    });
    const orchestrator = createOrchestrator(resources, security, convergenceRepo);

    await orchestrator.runAnalysis({ tenantId: TENANT_A, accountId: ACCOUNT_A, regions: [REGION] });
    await orchestrator.runAnalysis({ tenantId: TENANT_A, accountId: ACCOUNT_A, regions: [REGION] });

    const findingKey = sshFindingKey(TENANT_A, ACCOUNT_A, instanceId);
    const results = await convergenceRepo.listResultsForFinding({
      tenantId: TENANT_A,
      accountId: ACCOUNT_A,
      findingKey,
    });
    assert.deepEqual(results.items.map((item) => item.state), ['PRESERVED']);
  });

  it('records IMPROVED when SSH is corrected between runs', async () => {
    const resources = new MockEc2CloudResourceRepository();
    const security = new MockEc2SecurityRepository();
    const convergenceRepo = new MockGovernanceConvergenceRepository();
    const instanceId = await seedSshViolationInstance(resources, { tenantId: TENANT_A, accountId: ACCOUNT_A });
    const orchestrator = createOrchestrator(resources, security, convergenceRepo);

    await orchestrator.runAnalysis({ tenantId: TENANT_A, accountId: ACCOUNT_A, regions: [REGION] });

    await resources.upsertDiscoveredResource({
      tenantId: TENANT_A,
      accountId: ACCOUNT_A,
      region: REGION,
      resourceType: 'INSTANCE',
      resourceId: instanceId,
      tags: [
        { key: 'Name', value: 'web-server-01' },
        { key: 'Environment', value: 'production' },
        { key: 'Owner', value: 'platform' },
      ],
      status: 'ACTIVE',
      metadata: {
        instanceType: 't3.large',
        metadataOptions: { httpTokens: 'required' },
        monitoringState: 'enabled',
        iamInstanceProfileArn: 'arn:aws:iam::123456789012:instance-profile/ec2',
        securityGroups: [
          {
            groupId: 'sg-safe',
            inboundRules: [
              { protocol: 'tcp', fromPort: 443, toPort: 443, ipv4Ranges: ['10.0.0.0/8'] },
            ],
          },
        ],
        backupPolicy: { enabled: true },
      },
      discoveredAt: '2026-01-01T00:00:00.000Z',
    });

    await orchestrator.runAnalysis({ tenantId: TENANT_A, accountId: ACCOUNT_A, regions: [REGION] });

    const findingKey = sshFindingKey(TENANT_A, ACCOUNT_A, instanceId);
    const results = await convergenceRepo.listResultsForFinding({
      tenantId: TENANT_A,
      accountId: ACCOUNT_A,
      findingKey,
    });
    assert.equal(results.items[0]?.state, 'IMPROVED');
    assert.ok(results.items[0]?.reasonCodes.includes(GOVERNANCE_CONVERGENCE_REASON.VIOLATION_RESOLVED));
  });

  it('records REPLACED with CONTROL_REGRESSED when a compliant control regresses', async () => {
    const resources = new MockEc2CloudResourceRepository();
    const security = new MockEc2SecurityRepository();
    const convergenceRepo = new MockGovernanceConvergenceRepository();
    const instanceId = await seedCompliantInstance(resources, { tenantId: TENANT_A, accountId: ACCOUNT_A });
    const orchestrator = createOrchestrator(resources, security, convergenceRepo);

    await orchestrator.runAnalysis({ tenantId: TENANT_A, accountId: ACCOUNT_A, regions: [REGION] });

    await resources.upsertDiscoveredResource({
      tenantId: TENANT_A,
      accountId: ACCOUNT_A,
      region: REGION,
      resourceType: 'INSTANCE',
      resourceId: instanceId,
      tags: [
        { key: 'Name', value: 'web-server-01' },
        { key: 'Environment', value: 'production' },
        { key: 'Owner', value: 'platform' },
      ],
      status: 'ACTIVE',
      metadata: {
        instanceType: 't3.large',
        metadataOptions: { httpTokens: 'required' },
        monitoringState: 'enabled',
        iamInstanceProfileArn: 'arn:aws:iam::123456789012:instance-profile/ec2',
        securityGroups: [
          {
            groupId: 'sg-open',
            inboundRules: [
              { protocol: 'tcp', fromPort: 22, toPort: 22, ipv4Ranges: ['0.0.0.0/0'] },
            ],
          },
        ],
        backupPolicy: { enabled: true },
      },
      discoveredAt: '2026-01-01T00:00:00.000Z',
    });

    await orchestrator.runAnalysis({ tenantId: TENANT_A, accountId: ACCOUNT_A, regions: [REGION] });

    const findingKey = sshFindingKey(TENANT_A, ACCOUNT_A, instanceId);
    const latest = await convergenceRepo.getLatestResult(TENANT_A, ACCOUNT_A, findingKey);
    assert.equal(latest?.state, 'REPLACED');
    assert.ok(latest?.reasonCodes.includes(GOVERNANCE_CONVERGENCE_REASON.CONTROL_REGRESSED));
  });

  it('emits MISSING via reconciliation machinery when test seam skips one expected observation', async () => {
    const resources = new MockEc2CloudResourceRepository();
    const security = new MockEc2SecurityRepository();
    const convergenceRepo = new MockGovernanceConvergenceRepository();
    const instanceId = await seedCompliantInstance(resources, { tenantId: TENANT_A, accountId: ACCOUNT_A });
    await seedSuccessfulDiscoveryRun(resources, {
      tenantId: TENANT_A,
      accountId: ACCOUNT_A,
      regions: [REGION],
    });

    const baselineOrchestrator = createOrchestrator(resources, security, convergenceRepo);
    await baselineOrchestrator.runAnalysis({ tenantId: TENANT_A, accountId: ACCOUNT_A, regions: [REGION] });

    const findingKey = sshFindingKey(TENANT_A, ACCOUNT_A, instanceId);
    const missingOrchestrator = createOrchestrator(
      resources,
      security,
      convergenceRepo,
      new AbsentObservationGovernanceService(convergenceRepo, resources, findingKey),
    );
    await missingOrchestrator.runAnalysis({ tenantId: TENANT_A, accountId: ACCOUNT_A, regions: [REGION] });

    const latest = await convergenceRepo.getLatestResult(TENANT_A, ACCOUNT_A, findingKey);
    assert.equal(latest?.state, 'MISSING');
    assert.ok(latest?.reasonCodes.includes(GOVERNANCE_CONVERGENCE_REASON.CURRENT_EVIDENCE_ABSENT));
    assert.ok(latest?.previousEvidenceId);
    assert.equal(latest?.currentEvidenceId, undefined);
  });

  it('records satisfied undefined for insufficient security-group evidence and does not emit MISSING', async () => {
    const resources = new MockEc2CloudResourceRepository();
    const security = new MockEc2SecurityRepository();
    const convergenceRepo = new MockGovernanceConvergenceRepository();
    const instanceId = await seedInsufficientSecurityGroupInstance(resources, {
      tenantId: TENANT_A,
      accountId: ACCOUNT_A,
    });
    const orchestrator = createOrchestrator(resources, security, convergenceRepo);

    await orchestrator.runAnalysis({ tenantId: TENANT_A, accountId: ACCOUNT_A, regions: [REGION] });

    const findingKey = sshFindingKey(TENANT_A, ACCOUNT_A, instanceId);
    const observations = await convergenceRepo.listObservationsForFinding({
      tenantId: TENANT_A,
      accountId: ACCOUNT_A,
      findingKey,
    });
    assert.equal(observations.items[0]?.evidence.satisfied, undefined);

    const results = await convergenceRepo.listResultsForFinding({
      tenantId: TENANT_A,
      accountId: ACCOUNT_A,
      findingKey,
    });
    assert.equal(results.items.some((item) => item.state === 'MISSING'), false);
  });

  it('preserves security finding lifecycle while convergence tracks governance transitions', async () => {
    const resources = new MockEc2CloudResourceRepository();
    const security = new MockEc2SecurityRepository();
    const convergenceRepo = new MockGovernanceConvergenceRepository();
    const instanceId = await seedSshViolationInstance(resources, { tenantId: TENANT_A, accountId: ACCOUNT_A });
    const orchestrator = createOrchestrator(resources, security, convergenceRepo);
    const securityFindingKey = buildEc2SecurityFindingKey({
      tenantId: TENANT_A,
      accountId: ACCOUNT_A,
      region: REGION,
      resourceId: instanceId,
      check: GOVERNANCE_TRACKED_CHECKS.SSH_EXPOSURE,
      ruleVersion: EC2_SECURITY_RULE_VERSION,
    });

    await orchestrator.runAnalysis({ tenantId: TENANT_A, accountId: ACCOUNT_A, regions: [REGION] });
    const opened = await security.getFindingByKey(TENANT_A, ACCOUNT_A, securityFindingKey);
    assert.equal(opened?.status, 'OPEN');

    await resources.upsertDiscoveredResource({
      tenantId: TENANT_A,
      accountId: ACCOUNT_A,
      region: REGION,
      resourceType: 'INSTANCE',
      resourceId: instanceId,
      tags: [
        { key: 'Name', value: 'web-server-01' },
        { key: 'Environment', value: 'production' },
        { key: 'Owner', value: 'platform' },
      ],
      status: 'ACTIVE',
      metadata: {
        instanceType: 't3.large',
        metadataOptions: { httpTokens: 'required' },
        monitoringState: 'enabled',
        iamInstanceProfileArn: 'arn:aws:iam::123456789012:instance-profile/ec2',
        securityGroups: [
          {
            groupId: 'sg-safe',
            inboundRules: [
              { protocol: 'tcp', fromPort: 443, toPort: 443, ipv4Ranges: ['10.0.0.0/8'] },
            ],
          },
        ],
        backupPolicy: { enabled: true },
      },
      discoveredAt: '2026-01-01T00:00:00.000Z',
    });
    await orchestrator.runAnalysis({ tenantId: TENANT_A, accountId: ACCOUNT_A, regions: [REGION] });
    const resolved = await security.getFindingByKey(TENANT_A, ACCOUNT_A, securityFindingKey);
    assert.equal(resolved?.status, 'RESOLVED');

    await orchestrator.runAnalysis({ tenantId: TENANT_A, accountId: ACCOUNT_A, regions: [REGION] });
    const stillResolved = await security.getFindingByKey(TENANT_A, ACCOUNT_A, securityFindingKey);
    assert.equal(stillResolved?.status, 'RESOLVED');

    await resources.upsertDiscoveredResource({
      tenantId: TENANT_A,
      accountId: ACCOUNT_A,
      region: REGION,
      resourceType: 'INSTANCE',
      resourceId: instanceId,
      tags: [
        { key: 'Name', value: 'web-server-01' },
        { key: 'Environment', value: 'production' },
        { key: 'Owner', value: 'platform' },
      ],
      status: 'ACTIVE',
      metadata: {
        instanceType: 't3.large',
        metadataOptions: { httpTokens: 'required' },
        monitoringState: 'enabled',
        iamInstanceProfileArn: 'arn:aws:iam::123456789012:instance-profile/ec2',
        securityGroups: [
          {
            groupId: 'sg-open',
            inboundRules: [
              { protocol: 'tcp', fromPort: 22, toPort: 22, ipv4Ranges: ['0.0.0.0/0'] },
            ],
          },
        ],
        backupPolicy: { enabled: true },
      },
      discoveredAt: '2026-01-01T00:00:00.000Z',
    });
    await orchestrator.runAnalysis({ tenantId: TENANT_A, accountId: ACCOUNT_A, regions: [REGION] });
    const reopened = await security.getFindingByKey(TENANT_A, ACCOUNT_A, securityFindingKey);
    assert.equal(reopened?.status, 'OPEN');

    const findingKey = sshFindingKey(TENANT_A, ACCOUNT_A, instanceId);
    const convergenceStates = (
      await convergenceRepo.listResultsForFinding({
        tenantId: TENANT_A,
        accountId: ACCOUNT_A,
        findingKey,
      })
    ).items.map((item) => item.state);
    assert.deepEqual(convergenceStates, ['IMPROVED', 'PRESERVED', 'REPLACED']);
  });

  it('isolates tenant and account convergence history', async () => {
    const resources = new MockEc2CloudResourceRepository();
    const securityA = new MockEc2SecurityRepository();
    const securityB = new MockEc2SecurityRepository();
    const convergenceRepo = new MockGovernanceConvergenceRepository();

    const instanceA = await seedSshViolationInstance(resources, { tenantId: TENANT_A, accountId: ACCOUNT_A });
    await seedSshViolationInstance(resources, { tenantId: TENANT_B, accountId: ACCOUNT_A, instanceId: 'i-other-tenant' });
    await seedSshViolationInstance(resources, { tenantId: TENANT_A, accountId: ACCOUNT_B, instanceId: 'i-other-account' });

    const orchestratorA = createOrchestrator(resources, securityA, convergenceRepo);
    await orchestratorA.runAnalysis({ tenantId: TENANT_A, accountId: ACCOUNT_A, regions: [REGION] });
    await orchestratorA.runAnalysis({ tenantId: TENANT_A, accountId: ACCOUNT_A, regions: [REGION] });

    const orchestratorB = createOrchestrator(resources, securityB, convergenceRepo);
    await orchestratorB.runAnalysis({ tenantId: TENANT_B, accountId: ACCOUNT_A, regions: [REGION] });

    const tenantKey = sshFindingKey(TENANT_A, ACCOUNT_A, instanceA);
    const tenantResults = await convergenceRepo.listResultsForFinding({
      tenantId: TENANT_A,
      accountId: ACCOUNT_A,
      findingKey: tenantKey,
    });
    assert.equal(tenantResults.items.length, 1);

    const crossTenant = await convergenceRepo.listResultsForFinding({
      tenantId: TENANT_A,
      accountId: ACCOUNT_A,
      findingKey: sshFindingKey(TENANT_B, ACCOUNT_A, 'i-other-tenant'),
    });
    assert.equal(crossTenant.items.length, 0);

    const crossAccount = await convergenceRepo.listResultsForFinding({
      tenantId: TENANT_A,
      accountId: ACCOUNT_B,
      findingKey: sshFindingKey(TENANT_A, ACCOUNT_B, 'i-other-account'),
    });
    assert.equal(crossAccount.items.length, 0);
  });

  it('preserves security findings when governance convergence persistence fails', async () => {
    const resources = new MockEc2CloudResourceRepository();
    const security = new MockEc2SecurityRepository();
    class FailingGovernanceRepository extends MockGovernanceConvergenceRepository {
      override async recordObservation(): Promise<never> {
        throw new Error('convergence persist failed');
      }
    }
    const convergence = new GovernanceConvergenceService(new FailingGovernanceRepository(), resources);
    const orchestrator = new Ec2SecurityAnalysisOrchestrator(
      resources,
      security,
      security,
      security,
      convergence,
    );
    await seedSshViolationInstance(resources, { tenantId: TENANT_A, accountId: ACCOUNT_A });

    const result = await orchestrator.runAnalysis({
      tenantId: TENANT_A,
      accountId: ACCOUNT_A,
      regions: [REGION],
    });
    assert.ok(result.summary.warnings.some((warning) => warning.includes('Governance convergence failed')));
    const openFindings = await security.listFindings({
      tenantId: TENANT_A,
      accountId: ACCOUNT_A,
      status: 'OPEN',
    });
    assert.ok(openFindings.items.length > 0);
  });
});
