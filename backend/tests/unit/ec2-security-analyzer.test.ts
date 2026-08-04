import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { analyzeEc2Security } from '../../engines/ec2-security';

describe('EC2 security analyzer', () => {
  it('identifies security and governance risks and produces scores and remediations', () => {
    const result = analyzeEc2Security([{
      instanceId: 'i-risky', instanceType: 'x1.large', publicIpAddress: '198.51.100.4',
      securityGroups: [{ inboundRules: [{ protocol: 'tcp', fromPort: 22, toPort: 22, cidr: '0.0.0.0/0' }, { protocol: 'tcp', fromPort: 3389, toPort: 3389, cidr: '::/0' }] }],
      ebsVolumes: [{ volumeId: 'vol-1', encrypted: false }], metadataHttpTokens: 'optional', cloudWatchMonitoring: false,
      tags: { Name: 'Bad_Name' }, backupPolicy: { enabled: false }, launchTime: '2020-01-01T00:00:00Z',
    }]);
    const item = result.results[0];
    assert.equal(item.riskLevel, 'critical');
    assert.ok(item.securityFindings.some((finding) => finding.check === 'unrestricted_ssh'));
    assert.ok(item.securityFindings.some((finding) => finding.check === 'unrestricted_rdp'));
    assert.ok(item.governanceFindings.some((finding) => finding.check === 'required_tags'));
    assert.ok(item.securityScore < 100);
    assert.ok(item.governanceScore < 100);
    assert.ok(item.recommendations.length > 0);
  });

  it('gives a compliant inventory full scores', () => {
    const result = analyzeEc2Security([{
      instanceId: 'i-safe', instanceType: 't3.large', metadataHttpTokens: 'required', cloudWatchMonitoring: true,
      iamInstanceProfileArn: 'arn:aws:iam::123456789012:instance-profile/ec2', ebsVolumes: [{ encrypted: true }],
      tags: { Name: 'web-server-01', Environment: 'production', Owner: 'platform' }, backupPolicy: { enabled: true },
    }]);
    assert.equal(result.summary.securityScore, 100);
    assert.equal(result.summary.governanceScore, 100);
    assert.equal(result.results[0].riskLevel, 'low');
  });
});
