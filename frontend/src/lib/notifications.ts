const STORAGE_KEY = 'pragna-desktop-notifications';

export function isNotificationsSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export function isNotificationsEnabled(): boolean {
  if (!isNotificationsSupported()) return false;
  try {
    return localStorage.getItem(STORAGE_KEY) === 'true' && Notification.permission === 'granted';
  } catch {
    return false;
  }
}

/** Must be called from a user gesture (e.g. a toggle's onClick) -- browsers
 * require that for the permission prompt to appear. */
export async function enableNotifications(): Promise<boolean> {
  if (!isNotificationsSupported()) return false;
  try {
    const permission =
      Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
    const granted = permission === 'granted';
    localStorage.setItem(STORAGE_KEY, granted ? 'true' : 'false');
    return granted;
  } catch {
    return false;
  }
}

export function disableNotifications(): void {
  try {
    localStorage.setItem(STORAGE_KEY, 'false');
  } catch {
    // ignore
  }
}

/** Fires a desktop notification only when enabled+permitted and the tab
 * isn't the one the user is actively looking at -- the in-app toast already
 * covers the foreground case. */
export function notifyIfBackgrounded(title: string, body: string): void {
  if (!isNotificationsEnabled()) return;
  if (!document.hidden && document.hasFocus()) return;
  try {
    new Notification(title, { body });
  } catch {
    // ignore
  }
}
