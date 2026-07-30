import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { EXECUTION_MODES } from '../../execution/adapters/types';
import {
  formatStats,
  resolveIterationCount,
  summarizeLatencies,
} from '../helpers/execution-metrics';
import {
  buildOrchestratorContext,
  buildPlanInput,
  createInMemoryExecutionStores,
  createTestOrchestrator,
  TENANT_A,
} from '../integration/execution/fixtures';

describe('Execution performance validation (informational)', () => {
  it('records orchestrator and repository latencies with mocked AWS', async () => {
    const iterations = resolveIterationCount();
    const ec2 = {
      send: async () => ({
        Reservations: [
          { Instances: [{ InstanceId: 'i-perf', State: { Name: 'running' }, Tags: [] }] },
        ],
      }),
    };

    const { orchestrator } = createTestOrchestrator(() => ({
      ec2: ec2 as never,
    }));
    const { plans, history } = createInMemoryExecutionStores();

    const validationSamples: number[] = [];
    const planCreateSamples: number[] = [];
    const historySamples: number[] = [];
    let failures = 0;

    for (let index = 0; index < iterations; index += 1) {
      const validationStart = performance.now();
      try {
        await orchestrator.run(
          buildOrchestratorContext({ mode: EXECUTION_MODES.VALIDATION }),
          { service: 'ec2', action: 'START_INSTANCE', resourceId: 'i-perf' },
        );
        validationSamples.push(performance.now() - validationStart);
      } catch {
        failures += 1;
      }

      const createStart = performance.now();
      await plans.create(
        buildPlanInput({ executionId: `exec-perf-${index}`, tenantId: TENANT_A }),
      );
      planCreateSamples.push(performance.now() - createStart);

      const historyStart = performance.now();
      await history.append({
        tenantId: TENANT_A,
        historyId: `hist-${index}`,
        executionId: `exec-perf-${index}`,
        workflowId: 'wf-validation-1',
        eventType: 'PLAN_CREATED',
        actorId: 'actor',
        createdAt: new Date().toISOString(),
      });
      historySamples.push(performance.now() - historyStart);
    }

    const validationStats = summarizeLatencies(validationSamples, failures);
    const planStats = summarizeLatencies(planCreateSamples);
    const historyStats = summarizeLatencies(historySamples);

    process.stdout.write(`${formatStats('validation', validationStats)}\n`);
    process.stdout.write(`${formatStats('plan-create', planStats)}\n`);
    process.stdout.write(`${formatStats('history-append', historyStats)}\n`);

    assert.equal(validationStats.sampleCount, iterations);
    assert.ok(planStats.p95Ms >= planStats.p50Ms);
    assert.ok(historyStats.meanMs >= 0);
  });
});
