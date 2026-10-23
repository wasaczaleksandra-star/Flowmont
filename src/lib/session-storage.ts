// Native: persistent localStorage backed by SQLite (recommended by the Expo Supabase guide).
import 'expo-sqlite/localStorage/install';

export const sessionStorage = globalThis.localStorage;
