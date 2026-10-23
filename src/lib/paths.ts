/** Only same-app relative paths are accepted as post-login destinations (no open redirects). */
export function safeNextPath(next: unknown): string {
  if (typeof next !== 'string' || !next.startsWith('/') || next.startsWith('//') || next.includes('\\') || next.includes('://')) {
    return '/';
  }
  return next;
}
