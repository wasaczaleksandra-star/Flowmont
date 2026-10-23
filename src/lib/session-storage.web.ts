// Web: the browser's localStorage (guarded for private mode / SSR).
const memory = new Map<string, string>();

export const sessionStorage = {
  getItem(key: string) {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return memory.get(key) ?? null;
    }
  },
  setItem(key: string, value: string) {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      memory.set(key, value);
    }
  },
  removeItem(key: string) {
    try {
      window.localStorage.removeItem(key);
    } catch {
      memory.delete(key);
    }
  },
};
