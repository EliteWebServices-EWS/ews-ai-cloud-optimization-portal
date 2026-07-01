const { STSClient, AssumeRoleCommand }               = require("@aws-sdk/client-sts");
const { CostExplorerClient, GetCostAndUsageCommand }  = require("@aws-sdk/client-cost-explorer");
const { EC2Client, DescribeInstancesCommand }         = require("@aws-sdk/client-ec2");

async function syncFromAws(tenant) {

  // ── STEP 1: Assume the client's read-only IAM role via STS ──────────────
  let cfg;
  try {
    const sts   = new STSClient({});
    const creds = await sts.send(new AssumeRoleCommand({
      RoleArn:         tenant.roleArn,
      RoleSessionName: `ews-sync-${tenant.id}`,
      ExternalId:      tenant.externalId
    }));

    cfg = {
      credentials: {
        accessKeyId:     creds.Credentials.AccessKeyId,
        secretAccessKey: creds.Credentials.SecretAccessKey,
        sessionToken:    creds.Credentials.SessionToken
      },
      region: tenant.primaryRegion || "us-east-1"
    };
  } catch (err) {
    throw new Error(
      `STS AssumeRole failed for tenant ${tenant.id}: ${err.message}`
    );
  }

  // ── STEP 2: Pull month-to-date spend from Cost Explorer ─────────────────
  // FIX: Advance end date by 1 day so the range is inclusive of today.
  // This also prevents a ValidationException crash on the 1st of the
  // month when start and end would otherwise be the same date.
  let monthlySpend = 0;
  let breakdown    = [];
  try {
    const now      = new Date();
    const start    = new Date(now.getFullYear(), now.getMonth(), 1)
                       .toISOString().split("T")[0];

    const tomorrow = new Date(now);
    tomorrow.setDate(now.getDate() + 1);
    const end      = tomorrow.toISOString().split("T")[0];

    const ce   = new CostExplorerClient({ ...cfg, region: "us-east-1" });
    const cost = await ce.send(new GetCostAndUsageCommand({
      TimePeriod:  { Start: start, End: end },
      Granularity: "MONTHLY",
      Metrics:     ["UnblendedCost"],
      GroupBy:     [{ Type: "DIMENSION", Key: "SERVICE" }]
    }));

    const groups = cost.ResultsByTime?.[0]?.Groups || [];
    monthlySpend = groups.reduce(
      (sum, g) => sum + parseFloat(g.Metrics?.UnblendedCost?.Amount || "0"), 0
    );

    breakdown = groups
      .map(g => ({
        service: g.Keys?.[0] || "Unknown",
        amount:  parseFloat(g.Metrics?.UnblendedCost?.Amount || "0"),
        percent: 0
      }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 5)
      .map(item => ({
        ...item,
        percent: monthlySpend > 0
          ? Math.round((item.amount / monthlySpend) * 100)
          : 0
      }));

  } catch (err) {
    console.error(
      `Cost Explorer failed for tenant ${tenant.id}: ${err.message}`
    );
  }

  // ── STEP 3: Count running EC2 instances ──────────────────────────────────
  let activeEc2 = 0;
  try {
    const ec2       = new EC2Client(cfg);
    const instances = await ec2.send(new DescribeInstancesCommand({
      Filters: [{ Name: "instance-state-name", Values: ["running"] }]
    }));

    activeEc2 = instances.Reservations?.reduce(
      (sum, r) => sum + (r.Instances?.length || 0), 0
    ) || 0;

  } catch (err) {
    console.error(
      `EC2 DescribeInstances failed for tenant ${tenant.id}: ${err.message}`
    );
  }

  // ── STEP 4: Return the full dashboard snapshot ───────────────────────────
  return {
    clientId:     tenant.id,
    clientName:   tenant.name,
    awsAccountId: tenant.awsAccountId,
    lastSync:     new Date().toISOString(),
    dataSource:   "aws",
    cost: {
      monthlySpend:      parseFloat(monthlySpend.toFixed(2)),
      forecastedSpend:   parseFloat((monthlySpend * 1.05).toFixed(2)),
      estimatedSavings:  parseFloat((monthlySpend * 0.15).toFixed(2)),
      spendDeltaPercent: 0,
      breakdown
    },
    security: {
      healthScore: 80,
      openAlerts:  0,
      alerts:      []
    },
    resources: {
      activeEc2,
      s3StorageTb:   0,
      uptimePercent: 99.9
    },
    insights: {
      executiveSummary: `Live data synced for ${tenant.name}. Review recommendations below.`,
      recommendations:  []
    }
  };
}

module.exports = { syncFromAws };
