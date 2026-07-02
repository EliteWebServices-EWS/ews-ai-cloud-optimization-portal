// mock-data.js — Florence, Week 1 Day 2
// Fallback data used when no live API is available (dataSource: mock)
// Shape matches backend/src/mock-data.js exactly so swapping to live API
// requires zero changes to the dashboard rendering code.

const EWS_MOCK_CLIENTS = [
  { id: 'client-001', name: 'TechCorp Inc',    awsAccountId: '123456789012', status: 'Active' },
  { id: 'client-002', name: 'FinServ LLC',     awsAccountId: '234567890123', status: 'Active' },
  { id: 'client-003', name: 'HealthPlus Co',   awsAccountId: '345678901234', status: 'Active' }
];

function EWS_MOCK_DASHBOARD(clientId, clientName) {
  return {
    clientId,
    clientName,
    lastSync: new Date().toISOString(),
    dataSource: 'mock',
    cost: {
      monthlySpend:       1240.50,
      forecastedSpend:    1310.00,
      estimatedSavings:    210.00,
      spendDeltaPercent:    -4.2,
      breakdown: [
        { service: 'Amazon EC2',  amount: 520.30, percent: 42 },
        { service: 'Amazon S3',   amount: 310.10, percent: 25 },
        { service: 'AWS Lambda',  amount: 190.00, percent: 15 }
      ]
    },
    security: {
      healthScore: 82,
      openAlerts:   3,
      alerts: [
        { id: 'a1', message: 'S3 bucket open to public read', severity: 'critical' },
        { id: 'a2', message: 'IAM user without MFA',          severity: 'high'     },
        { id: 'a3', message: 'Unused security group',         severity: 'low'      }
      ]
    },
    resources: {
      activeEc2:      14,
      s3StorageTb:   3.2,
      uptimePercent: 99.95
    },
    insights: {
      executiveSummary: 'Infrastructure is stable with moderate optimization opportunities.',
      recommendations: [
        { title: 'Right-size idle EC2',           impact: 'High',   estimatedSavings: 145 },
        { title: 'Enable S3 Intelligent-Tiering', impact: 'Medium', estimatedSavings: 65  }
      ]
    }
  };
}
