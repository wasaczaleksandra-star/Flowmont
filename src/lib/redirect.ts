import * as Linking from 'expo-linking';
import { Platform } from 'react-native';

export { safeNextPath } from './paths';

/**
 * Base URL used in auth e-mails (confirmation, magic link, password reset, OAuth).
 * On the web it is the current origin, so preview and production domains each receive
 * links to themselves (each must be allowed in Supabase → Authentication → URL Configuration).
 * Native apps use the flowmont:// scheme (exp:// in Expo Go during development).
 */
export function authRedirectUrl(path: string): string {
  if (Platform.OS === 'web' && typeof window !== 'undefined' && window.location?.origin) {
    return `${window.location.origin}${path}`;
  }
  return Linking.createURL(path);
}
