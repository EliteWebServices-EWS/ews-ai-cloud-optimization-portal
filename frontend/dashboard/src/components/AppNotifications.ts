/**
 * Minimal accessible in-app notifications (no browser Notification API).
 */

export type AppNotificationKind = 'info' | 'success' | 'warning' | 'error';

let liveRegion: HTMLElement | null = null;

function ensureLiveRegion(): HTMLElement {
  if (liveRegion && document.body.contains(liveRegion)) {
    return liveRegion;
  }
  liveRegion = document.createElement('div');
  liveRegion.id = 'app-notification-live';
  liveRegion.className = 'app-notification-live sr-only';
  liveRegion.setAttribute('role', 'status');
  liveRegion.setAttribute('aria-live', 'polite');
  liveRegion.setAttribute('aria-atomic', 'true');
  document.body.appendChild(liveRegion);
  return liveRegion;
}

function ensureToastContainer(): HTMLElement {
  let container = document.getElementById('app-notification-toasts');
  if (!container) {
    container = document.createElement('div');
    container.id = 'app-notification-toasts';
    container.className = 'app-notification-toasts';
    container.setAttribute('aria-label', 'Notifications');
    document.body.appendChild(container);
  }
  return container;
}

export function showAppNotification(message: string, kind: AppNotificationKind = 'info'): void {
  const region = ensureLiveRegion();
  region.textContent = message;

  const container = ensureToastContainer();
  const toast = document.createElement('div');
  toast.className = `app-notification app-notification-${kind}`;
  toast.setAttribute('role', 'status');
  toast.textContent = message;
  container.appendChild(toast);

  window.setTimeout(() => {
    toast.remove();
  }, 6000);
}
