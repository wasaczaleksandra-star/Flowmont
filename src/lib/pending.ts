import { safeNextPath } from './paths';
import { sessionStorage } from './session-storage';

// Destination to open after the user signs in (e.g. an invitation link).
const KEY = 'flowmont.pendingNext';

export function setPendingNext(path: string) {
  sessionStorage.setItem(KEY, safeNextPath(path));
}

export function takePendingNext(): string | null {
  const v = sessionStorage.getItem(KEY);
  if (v) sessionStorage.removeItem(KEY);
  return v ? safeNextPath(v) : null;
}
