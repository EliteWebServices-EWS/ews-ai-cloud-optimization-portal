import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

import { createCloudDiscoveryPluginRegistry } from '../../cloud-intelligence/registry/cloud-discovery-plugin-registry';
import { createEc2CloudDiscoveryPlugin } from '../../cloud-intelligence/plugins/ec2/ec2-cloud-discovery-plugin';
import type { CloudResourceDiscoveryPlugin } from '../../cloud-intelligence/plugins/cloud-resource-discovery-plugin';

describe('EC2 cloud discovery plugin registry', () => {
  it('registers EC2 once and rejects duplicate registration', () => {
    const plugin = createEc2CloudDiscoveryPlugin(() => ({
      discoverRegionalInventory: async () => ({
        instances: [],
        images: [],
        volumes: [],
        elasticIps: [],
        networkInterfaces: [],
        placementGroups: [],
        launchTemplates: [],
      }),
    }));
    const registry = createCloudDiscoveryPluginRegistry([plugin]);
    assert.equal(registry.get('ec2').service, 'ec2');
    assert.throws(() => registry.register(plugin), /already registered/);
  });

  it('fails safely for unsupported service lookup', () => {
    const stub: CloudResourceDiscoveryPlugin = {
      service: 'ec2',
      async discover() {
        return { resources: [], warnings: [], completedScopes: [] };
      },
    };
    const registry = createCloudDiscoveryPluginRegistry([stub]);
    assert.throws(() => registry.get('rds'), /Unsupported cloud discovery service/);
  });

  it('plugin interface does not require AWS SDK EC2 types on registry surface', () => {
    const registrySource = readFileSync(
      path.resolve(process.cwd(), 'cloud-intelligence/registry/cloud-discovery-plugin-registry.ts'),
      'utf8',
    );
    assert.doesNotMatch(registrySource, /@aws-sdk\/client-ec2/);
  });
});

describe('EC2 cloud resources SAM template', () => {
  const template = readFileSync(path.join(process.cwd(), 'template.yaml'), 'utf8');

  it('defines SisumCloudResourcesTable with PAY_PER_REQUEST and env var', () => {
    assert.match(template, /SisumCloudResourcesTable:/);
    assert.match(template, /sisum-cloud-resources-\$\{Environment\}/);
    assert.match(template, /BillingMode: PAY_PER_REQUEST/);
    assert.match(template, /CLOUD_RESOURCES_TABLE_NAME/);
  });

  it('scopes Lambda persistence to cloud resources table without ec2 IAM actions', () => {
    const policySection = template.slice(
      template.indexOf('SisumBusinessPersistencePolicy'),
      template.indexOf('SisumStsAssumeRolePolicy'),
    );
    assert.match(policySection, /SisumCloudResourcesTable/);
    assert.doesNotMatch(policySection, /ec2:Describe/);
    const stsSection = template.slice(template.indexOf('SisumStsAssumeRolePolicy'));
    assert.match(stsSection, /sts:AssumeRole/);
  });

  it('deployment dynamodb policy includes cloud resources table pattern', () => {
    const policy = readFileSync(
      path.resolve(process.cwd(), '../infrastructure/iam/sisum-backend-deploy-dynamodb-policy.json'),
      'utf8',
    );
    assert.match(policy, /sisum-cloud-resources/);
  });
});
