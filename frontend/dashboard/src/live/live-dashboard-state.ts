export type LiveEc2SessionState =
  | 'signed_out'
  | 'loading'
  | 'ready'
  | 'session_expired'
  | 'account_required'
  | 'error';

export interface LiveEc2DashboardUiState {
  session: LiveEc2SessionState;
  selectedAccountId?: string;
  selectedRegion: string;
  lastErrorMessage?: string;
}

export function initialLiveEc2DashboardUiState(): LiveEc2DashboardUiState {
  return {
    session: 'loading',
    selectedRegion: 'us-east-1',
  };
}
