/**
 * Deterministic mock EBS volumes for Demo Mode.
 */

import type { ProviderVolume } from '../../../shared/types';
import { DEFAULT_REGION } from '../../../shared/constants';

export const MOCK_VOLUMES: ProviderVolume[] = [
  {
    volumeId: 'vol-mock-001',
    sizeGb: 100,
    volumeType: 'gp3',
    state: 'in-use',
    region: DEFAULT_REGION,
    attachedTo: 'i-mock-001',
  },
  {
    volumeId: 'vol-mock-002',
    sizeGb: 250,
    volumeType: 'gp2',
    state: 'in-use',
    region: DEFAULT_REGION,
    attachedTo: 'i-mock-002',
  },
  {
    volumeId: 'vol-mock-003',
    sizeGb: 50,
    volumeType: 'gp3',
    state: 'available',
    region: DEFAULT_REGION,
  },
];
