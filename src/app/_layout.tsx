import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AppText, Banner, LoadingState, Screen, ToastProvider } from '@/components/ui';
import { SessionProvider, useSession } from '@/features/session';
import { isConfigured } from '@/lib/env';
import { colors } from '@/theme/tokens';

SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <ToastProvider>
        {isConfigured ? (
          <SessionProvider>
            <RootNavigator />
          </SessionProvider>
        ) : (
          <NotConfigured />
        )}
      </ToastProvider>
    </SafeAreaProvider>
  );
}

function RootNavigator() {
  const { loading, authReady, session, active, companiesError, isPlatformOwner } = useSession();
  const signedIn = !!session;
  const hasCompany = !!active;

  useEffect(() => {
    if (!loading) SplashScreen.hideAsync().catch(() => {});
  }, [loading]);

  // Route guards must not be evaluated before the stored session is known, otherwise a deep
  // link (e.g. /jobs/123 after a page refresh) would first be redirected to the sign-in screen.
  if (!authReady) {
    return (
      <View style={[StyleSheet.absoluteFill, styles.overlay]}>
        <LoadingState label="Wczytywanie Flowmont…" />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
        <Stack.Protected guard={signedIn && (hasCompany || loading)}>
          <Stack.Screen name="(app)" />
        </Stack.Protected>
        <Stack.Protected guard={signedIn && !loading && !hasCompany}>
          <Stack.Screen name="onboarding" />
        </Stack.Protected>
        <Stack.Protected guard={signedIn && (loading || isPlatformOwner)}>
          <Stack.Screen name="platform" />
        </Stack.Protected>
        <Stack.Protected guard={!signedIn}>
          <Stack.Screen name="sign-in" />
          <Stack.Screen name="sign-up" />
          <Stack.Screen name="forgot-password" />
        </Stack.Protected>
        <Stack.Screen name="auth/callback" />
        <Stack.Screen name="auth/reset" />
        <Stack.Screen name="invite/[token]" />
      </Stack>
      {loading ? (
        <View style={[StyleSheet.absoluteFill, styles.overlay]}>
          <LoadingState label="Wczytywanie Flowmont…" />
        </View>
      ) : null}
      {!loading && signedIn && companiesError ? (
        <View style={styles.errorBar}>
          <Banner tone="danger">{companiesError}</Banner>
        </View>
      ) : null}
    </View>
  );
}

function NotConfigured() {
  useEffect(() => {
    SplashScreen.hideAsync().catch(() => {});
  }, []);
  return (
    <Screen maxWidth={640}>
      <AppText variant="title">Flowmont</AppText>
      <Banner tone="warning" title="Aplikacja nie jest jeszcze połączona z serwerem">
        Uzupełnij plik .env.local zgodnie z instrukcją w README (adres i klucz publiczny Supabase), a następnie uruchom aplikację ponownie.
      </Banner>
    </Screen>
  );
}

const styles = StyleSheet.create({
  overlay: { backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
  errorBar: { position: 'absolute', left: 16, right: 16, top: 16 },
});
