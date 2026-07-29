import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

const templatePath = path.join(__dirname, '../../template.yaml');

describe('Sprint 12.5 SAM template execution plans table', () => {
  const template = readFileSync(templatePath, 'utf8');

  it('defines SisumExecutionPlansTable with gsi1 and gsi2', () => {
    assert.match(template, /SisumExecutionPlansTable:/);
    assert.match(template, /sisum-execution-plans-\$\{Environment\}/);
    assert.match(template, /EXECUTION_PLANS_TABLE_NAME/);
    assert.match(template, /ExecutionPlansTableName:/);
    assert.match(template, /ExecutionPlansTableArn:/);
  });

  it('does not grant dynamodb:Scan on execution plans table policy', () => {
    const executionSection = template.slice(
      template.indexOf('SisumExecutionPlansTable'),
      template.indexOf('SisumBusinessPersistencePolicy'),
    );
    assert.doesNotMatch(executionSection, /dynamodb:Scan/);
  });
});
