import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { normalizeEc2RegionalInventory } from '../../cloud-intelligence/plugins/ec2/ec2-discovery-normalizer';
import {
  findPrefixListOnlySensitiveRules,
  isPrefixListOnlyRule,
  metadataHasPrefixListOnlySensitiveRules,
} from '../../cloud-intelligence/ec2-security/ec2-security-prefix-list-evidence';
import {
  assessInstanceSecurityEvidence,
  supplementAnalysisForInsufficientEvidence,
} from '../../cloud-intelligence/ec2-security/ec2-security-evidence';
import { analyzeEc2Security } from '../../engines/ec2-security';

describe('ec2-security prefix list evidence', () => {
  it('prefix-list-only SSH rule produces insufficient evidence', () => {
    const metadata = {
      securityGroups: [
        {
          groupId: 'sg-ssh',
          inboundRules: [
            {
              protocol: 'tcp',
              fromPort: 22,
              toPort: 22,
              prefixListIds: ['pl-abc'],
            },
          ],
        },
      ],
    };
    assert.deepEqual(findPrefixListOnlySensitiveRules(metadata.securityGroups[0].inboundRules), [
      'ssh',
    ]);
    const item = {
      instanceId: 'i-1',
      instanceType: 't3.micro',
      securityGroups: [{ groupId: 'sg-ssh', inboundRules: [{ protocol: 'tcp', fromPort: 22, toPort: 22 }] }],
      metadataHttpTokens: 'required',
      ebsVolumes: [{ encrypted: true }],
      cloudWatchMonitoring: true,
    };
    const evidence = assessInstanceSecurityEvidence(item, metadata);
    assert.equal(evidence.securityGroups, 'INSUFFICIENT');
    const base = analyzeEc2Security([item]);
    assert.equal(
      base.results[0]?.securityFindings.some((finding) => finding.check === 'unrestricted_ssh'),
      false,
    );
    const { analysis } = supplementAnalysisForInsufficientEvidence(
      [item],
      base,
      new Map([['i-1', metadata]]),
    );
    assert.ok(
      analysis.results[0]?.securityFindings.some(
        (finding) => finding.check === 'insufficient_security_group_evidence',
      ),
    );
  });

  it('prefix-list-only RDP and all-traffic rules produce insufficient evidence', () => {
    assert.deepEqual(
      findPrefixListOnlySensitiveRules([
        { protocol: 'tcp', fromPort: 3389, toPort: 3389, prefixListIds: ['pl-rdp'] },
      ]),
      ['rdp'],
    );
    assert.deepEqual(
      findPrefixListOnlySensitiveRules([{ protocol: '-1', prefixListIds: ['pl-all'] }]),
      ['all_traffic'],
    );
  });

  it('preserves prefixListIds in normalized persistence metadata', () => {
    const normalized = normalizeEc2RegionalInventory(
      {
        instances: [
          {
            instanceId: 'i-1',
            securityGroupIds: ['sg-1'],
            securityGroupNames: ['web'],
            securityGroups: [
              {
                groupId: 'sg-1',
                groupName: 'web',
                inboundRules: [
                  {
                    protocol: 'tcp',
                    fromPort: 22,
                    toPort: 22,
                    prefixListIds: ['pl-ssh'],
                  },
                ],
              },
            ],
            tags: [],
          },
        ],
        images: [],
        volumes: [],
        elasticIps: [],
        networkInterfaces: [],
        placementGroups: [],
        launchTemplates: [],
      },
      'us-east-1',
    );
    const metadata = normalized[0]?.metadata as {
      securityGroups?: Array<{ inboundRules?: Array<{ prefixListIds?: string[] }> }>;
    };
    assert.deepEqual(metadata.securityGroups?.[0]?.inboundRules?.[0]?.prefixListIds, ['pl-ssh']);
  });

  it('unresolved prefix list does not count as secure pass and closed CIDR stays clean', () => {
    assert.equal(
      metadataHasPrefixListOnlySensitiveRules({
        securityGroups: [
          {
            groupId: 'sg-1',
            inboundRules: [{ protocol: 'tcp', fromPort: 443, toPort: 443, ipv4Ranges: ['10.0.0.0/8'] }],
          },
        ],
      }),
      false,
    );
    const closed = {
      instanceId: 'i-closed',
      instanceType: 't3.micro',
      securityGroups: [
        {
          groupId: 'sg-1',
          inboundRules: [{ protocol: 'tcp', fromPort: 443, toPort: 443, cidr: '10.0.0.0/8' }],
        },
      ],
      metadataHttpTokens: 'required',
      ebsVolumes: [{ encrypted: true }],
    };
    const checks =
      analyzeEc2Security([closed]).results[0]?.securityFindings.map((finding) => finding.check) ?? [];
    assert.equal(checks.includes('unrestricted_ssh'), false);
    assert.equal(checks.includes('insufficient_security_group_evidence'), false);
    assert.equal(isPrefixListOnlyRule({ protocol: 'tcp', prefixListIds: ['pl-1'] }), true);
  });
});
