import assert from 'node:assert/strict';
import test from 'node:test';

import {
  EXECUTION_PLAN_SK_PREFIX,
  EXECUTION_RUN_SK_PREFIX,
  actionLogCanonicalSortKeyPrefix,
  actionLogCorrelationSortKeyPrefix,
  actionLogDecisionSortKeyPrefix,
  actionLogExecutionSortKeyPrefix,
  actionLogResourceSortKeyPrefix,
  executionHistorySortKeyPrefix,
} from '../../database';

test('ActionLog prefixes do not collide with execution plan/history/run prefixes', () => {
  assert.equal(actionLogCanonicalSortKeyPrefix(), 'ACTION_LOG#LOG#');
  assert.notEqual(actionLogCanonicalSortKeyPrefix(), EXECUTION_PLAN_SK_PREFIX);
  assert.notEqual(actionLogCanonicalSortKeyPrefix(), EXECUTION_RUN_SK_PREFIX);
  assert.doesNotMatch(actionLogCanonicalSortKeyPrefix(), /^EXECUTION_HIST#/);

  assert.match(actionLogCorrelationSortKeyPrefix('corr-1'), /^ACTION_LOG#CORR#/);
  assert.match(actionLogDecisionSortKeyPrefix('dec-1'), /^ACTION_LOG#DEC#/);
  assert.match(actionLogExecutionSortKeyPrefix('exec-1'), /^ACTION_LOG#EXEC#/);
  assert.match(
    actionLogResourceSortKeyPrefix('111', 'i-abc'),
    /^ACTION_LOG#RES#111#i-abc#/,
  );

  assert.match(executionHistorySortKeyPrefix('exec-1'), /^EXECUTION_HIST#exec-1#/);
});

test('execution and ActionLog query prefixes are mutually exclusive', () => {
  const actionPrefixes = [
    actionLogCanonicalSortKeyPrefix(),
    actionLogCorrelationSortKeyPrefix('corr'),
    actionLogDecisionSortKeyPrefix('dec'),
    actionLogExecutionSortKeyPrefix('exec'),
    actionLogResourceSortKeyPrefix('acct', 'i-1'),
  ];
  const executionPrefixes = [
    EXECUTION_PLAN_SK_PREFIX,
    executionHistorySortKeyPrefix('exec'),
    EXECUTION_RUN_SK_PREFIX,
  ];

  for (const actionPrefix of actionPrefixes) {
    for (const executionPrefix of executionPrefixes) {
      assert.ok(
        !actionPrefix.startsWith(executionPrefix) &&
          !executionPrefix.startsWith(actionPrefix),
        `prefix collision: ${actionPrefix} vs ${executionPrefix}`,
      );
    }
  }
});
