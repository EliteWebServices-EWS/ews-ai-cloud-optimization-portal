export interface Client {
  id: string;
  name: string;
  awsAccountId: string;
  status: 'Active' | 'Pending';
  lastSync: string;
}

export const mockClients: Client[] = [
  {
    id: 'client-001',
    name: 'TechCorp Inc',
    awsAccountId: '123456789012',
    status: 'Active',
    lastSync: '2026-06-24 14:30',
  },
  {
    id: 'client-002',
    name: 'Global Finance Ltd',
    awsAccountId: '210987654321',
    status: 'Active',
    lastSync: '2026-06-25 09:15',
  },
  {
    id: 'client-003',
    name: 'StartUp Innovations',
    awsAccountId: '345678901234',
    status: 'Pending',
    lastSync: '2026-06-22 16:45',
  },
  {
    id: 'client-004',
    name: 'Enterprise Solutions',
    awsAccountId: '456789012345',
    status: 'Active',
    lastSync: '2026-06-20 11:05',
  },
  {
    id: 'client-005',
    name: 'BrightApps Co',
    awsAccountId: '567890123456',
    status: 'Active',
    lastSync: '2026-06-26 08:00',
  }
];
export const mockData = {
  monthlySpend: 4200,
  ec2Instances: 12,
  securityFindings: 3,
  spendTrend: [3800, 4000, 4200],
};
