import { useEffect, useMemo } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { NavigationBar } from 'expo-navigation-bar';
import * as SplashScreen from 'expo-splash-screen';
import * as SystemUI from 'expo-system-ui';
import {
  useFonts,
  Poppins_400Regular,
  Poppins_500Medium,
  Poppins_600SemiBold,
  Poppins_700Bold,
} from '@expo-google-fonts/poppins';
import 'react-native-reanimated';
import { TenantProvider, useTenant } from '@/src/core/tenant/tenant-context';
import { ToastProvider } from '@/src/core/ui/Toast';
import { DialogHost } from '@/src/core/ui/DialogHost';
import { OfflineBanner } from '@/src/core/ui/OfflineBanner';
import { DrawerItemsProvider } from '@/src/core/ui/drawer-items-context';
import { rolesInclude, useAuthStore } from '@/src/core/auth/store';
import { useNetworkStore } from '@/src/core/network/store';
import { startTelemetry } from '@/src/core/telemetry/service';
import { useUpdatePrompt } from '@/src/core/version/useUpdatePrompt';
import { getDrawerFor } from '@/src/composition/drawer-resolver';
import { UpdateProvider } from '@/src/core/updates/UpdateProvider';
import { COLORS } from '@/src/core/theme';

// Hold the native splash until fonts + auth hydrated.
SplashScreen.preventAutoHideAsync().catch(() => {});

/** Once the user is past the auth/biometric gate, check GitHub for a newer
 *  release and prompt to update (best-effort, once per session per version).
 *  A component rather than a hook call in RootLayout: it needs UpdateProvider. */
function UpdatePromptGate({ active }: { active: boolean }) {
  useUpdatePrompt(active);
  return null;
}

function TenantScopedDrawer({ children }: { children: React.ReactNode }) {
  const { tenant } = useTenant();
  const roles = useAuthStore((s) => s.roles);

  // Role-gated entries stay out of the drawer AND the home grid, since both
  // render from this same list. Recomputes when roles arrive after login.
  const items = useMemo(
    () => getDrawerFor(tenant).filter((it) => !it.role || rolesInclude(roles, it.role)),
    [tenant, roles],
  );

  return <DrawerItemsProvider items={items}>{children}</DrawerItemsProvider>;
}

// The window behind every screen (and behind the phone's own navigation bar, now
// that the app draws edge to edge) is the app's light grey, not black.
SystemUI.setBackgroundColorAsync(COLORS.bgMuted).catch(() => {});

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Poppins_400Regular,
    Poppins_500Medium,
    Poppins_600SemiBold,
    Poppins_700Bold,
  });

  const hydrate = useAuthStore((s) => s.hydrate);
  const hasSession = useAuthStore((s) => s.hasSession);
  const hydrated = useAuthStore((s) => s.hydrated);
  const biometricLocked = useAuthStore((s) => s.biometricLocked);
  const initNetwork = useNetworkStore((s) => s.init);

  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    hydrate();
    initNetwork();
  }, [hydrate, initNetwork]);

  useEffect(() => {
    if (fontsLoaded && hydrated) SplashScreen.hideAsync().catch(() => {});
  }, [fontsLoaded, hydrated]);

  useEffect(() => {
    if (hydrated && hasSession && !biometricLocked) {
      // Device telemetry (hourly, offline-queued) reports app version + OTA per
      // device, superseding the legacy per-user reportAppVersion call.
      startTelemetry();
    }
  }, [hydrated, hasSession, biometricLocked]);

  // Biometric / auth gate. Routes to login → biometric-lock → tabs based on state.
  useEffect(() => {
    if (!hydrated) return;
    const first = segments[0] as string | undefined;
    const inAuthFlow = first === 'login' || first === 'biometric-lock';

    if (!hasSession) {
      if (first !== 'login') router.replace('/login');
      return;
    }
    if (biometricLocked) {
      if (first !== 'biometric-lock') router.replace('/biometric-lock' as never);
      return;
    }
    if (inAuthFlow) router.replace('/');
  }, [hydrated, hasSession, biometricLocked, segments, router]);

  if (!fontsLoaded || !hydrated) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <UpdateProvider>
          <UpdatePromptGate active={hydrated && hasSession && !biometricLocked} />
          <TenantProvider>
            <TenantScopedDrawer>
              <ToastProvider>
                <StatusBar style="dark" />
                {/* The phone's button bar: light, with dark buttons, over the app's own
                    background (app.json turns Android's dark contrast strip off). */}
                <NavigationBar style="light" />
                <Stack
                  screenOptions={{
                    headerShown: false,
                    // Forward nav slides in from the right; back gesture slides
                    // the screen out to the left. Matches platform conventions.
                    animation: 'slide_from_right',
                    gestureEnabled: true,
                  }}
                >
                  {/* Bottom tab navigator — all main feature screens live inside. */}
                  <Stack.Screen name="(tabs)" />
                  <Stack.Screen name="login" />
                  <Stack.Screen name="biometric-lock" options={{ animation: 'fade' }} />
                  <Stack.Screen
                    name="camera-scanner"
                    options={{ presentation: 'fullScreenModal' }}
                  />
                  <Stack.Screen
                    name="camera-capture"
                    options={{ presentation: 'fullScreenModal' }}
                  />
                </Stack>
                {/* Sticky offline indicator across every screen. */}
                <OfflineBanner />
                {/* App-styled confirms / notices (showDialog), above every screen. */}
                <DialogHost />
              </ToastProvider>
            </TenantScopedDrawer>
          </TenantProvider>
        </UpdateProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
