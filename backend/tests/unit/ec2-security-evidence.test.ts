import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { analyzeEc2Security } from '../../engines/ec2-security';
import {
  assessInstanceSecurityEvidence,
  supplementAnalysisForInsufficientEvidence,
} from '../../cloud-intelligence/ec2-security/ec2-security-evidence';

describe('ec2-security-evidence', () => {
  it('treats missing security group ingress as insufficient rather than secure', () => {
    const inventory = [
      {
        instanceId: 'i-1',
        instanceType: 't3.micro',
        securityGroups: [{ groupId: 'sg-1', inboundRules: [] }],
        ebsVolumes: [{ volumeId: 'vol-1', encrypted: true }],
        metadataHttpTokens: 'required',
        cloudWatchMonitoring: true,
      },
    ];
    const base = analyzeEc2Security(inventory);
    assert.equal(
      base.results[0]?.securityFindings.some((f) => f.check === 'unrestricted_ssh'),
      false,
    );
    const { analysis } = supplementAnalysisForInsufficientEvidence(
      inventory,
      base,
      new Map([['i-1', { securityGroupIds: ['sg-1'], securityGroups: [{ groupId: 'sg-1' }] }]]),
    );
    assert.ok(
      analysis.results[0]?.securityFindings.some(
        (f) => f.check === 'insufficient_security_group_evidence',
      ),
    );
  });

  it('maps metadata options and missing IMDS to insufficient evidence', () => {
    const item = {
      instanceId: 'i-2',
      instanceType: 't3.micro',
      ebsVolumes: [{ encrypted: true }],
      cloudWatchMonitoring: true,
    };
    const evidence = assessInstanceSecurityEvidence(item, { securityGroupIds: [] });
    assert.equal(evidence.imds, 'INSUFFICIENT');
  });

  it('does not treat verified ingress as insufficient', () => {
    const item = {
      instanceId: 'i-3',
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
    const evidence = assessInstanceSecurityEvidence(item, {
      securityGroups: [{ groupId: 'sg-1', inboundRules: [{ ipv4Ranges: ['10.0.0.0/8'] }] }],
    });
    assert.equal(evidence.securityGroups, 'VERIFIED');
  });
});
