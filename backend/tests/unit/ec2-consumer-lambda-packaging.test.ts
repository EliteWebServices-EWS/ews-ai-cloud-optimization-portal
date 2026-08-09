import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

const backendRoot = path.join(__dirname, '../..');
const tsconfigPath = path.join(backendRoot, 'tsconfig.json');
const templatePath = path.join(backendRoot, 'template.yaml');

describe('EC2 consumer Lambda packaging', () => {
  it('includes consumer entrypoint in TypeScript build', () => {
    const tsconfig = readFileSync(tsconfigPath, 'utf8');
    assert.match(tsconfig, /lambda-ec2-analysis-consumer\.ts/);
    assert.match(tsconfig, /ec2-analysis-consumer\/\*\*\/\*\.ts/);
    assert.match(tsconfig, /services\/\*\*\/\*\.ts/);
  });

  it('emits dist handler module after npm run build', () => {
    const handlerJs = path.join(backendRoot, 'dist/lambda-ec2-analysis-consumer.js');
    assert.equal(
      existsSync(handlerJs),
      true,
      'dist/lambda-ec2-analysis-consumer.js must exist after tsc (run npm run build before tests in CI)',
    );
    const source = readFileSync(handlerJs, 'utf8');
    assert.match(source, /exports\.handler/);
  });

  it('matches backend API Lambda packaging pattern (CodeUri . + dist handler)', () => {
    const template = readFileSync(templatePath, 'utf8');
    const backendSection = template.slice(
      template.indexOf('SisumBackendFunction:'),
      template.indexOf('SisumEc2AnalysisConsumerLogGroup'),
    );
    const consumerSection = template.slice(
      template.indexOf('SisumEc2AnalysisConsumerFunction:'),
      template.indexOf('Outputs:'),
    );
    assert.match(backendSection, /Handler: dist\/lambda\.handler/);
    assert.match(consumerSection, /Handler: dist\/lambda-ec2-analysis-consumer\.handler/);
  });
});
