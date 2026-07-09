/**
 * State message component — loading, empty, error, and success banners.
 */

import { escapeHtml } from '../utils/format';
import type { DashboardState } from '../types';

export interface StateMessageProps {
  state: DashboardState;
  message?: string;
  title?: string;
}

export function renderStateMessage(container: HTMLElement, props: StateMessageProps): void {
  if (props.state === 'idle') {
    container.innerHTML = '';
    container.hidden = true;
    return;
  }

  container.hidden = false;
  const titles: Record<Exclude<DashboardState, 'idle' | 'success'>, string> = {
    loading: 'Running optimization analysis...',
    empty: 'No optimization candidates found.',
    error: 'Analysis failed.',
  };

  const title = props.title ?? titles[props.state as keyof typeof titles] ?? 'Status';
  const icon = props.state === 'loading' ? '⏳' : props.state === 'error' ? '⚠' : 'ℹ';

  container.innerHTML = `
    <div class="state-message state-${escapeHtml(props.state)}" role="status" aria-live="polite">
      <span class="state-icon">${icon}</span>
      <div>
        <strong>${escapeHtml(title)}</strong>
        ${props.message ? `<p>${escapeHtml(props.message)}</p>` : ''}
      </div>
    </div>
  `;
}
