import '../src/mobile-kit';
import { useEffect, useMemo } from 'react';
import { DefaultTheme, Stack, ThemeProvider, useRouter, useSegments } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
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
import { useUserStation } from '@/src/core/tenant/user-station';
import { useFarmSendsBuckets } from '@/src/core/tenant/transfer-hub';
import { rolesInclude, useAuthStore } from '@/src/core/auth/store';
import { useNetworkStore } from '@/src/core/network/store';
import { getDrawerFor } from '@/src/composition/drawer-resolver';
import { refreshTransferFarms } from '@/src/tenants/karen/state/karen-transfer-farms';
import { setUnsentCounter } from '@/src/core/offline/unsent';
import { countUnsentWork } from '@/src/composition/unsent-work';
import { COLORS } from '@/src/core/theme';
import { MobileKitProvider } from '@upande/mobile-kit';

// Hold the native splash until fonts + auth hydrated.
SplashScreen.preventAutoHideAsync().catch(() => {});

function TenantScopedDrawer({ children }: { children: React.ReactNode }) {
  const { tenant } = useTenant();
  const roles = useAuthStore((s) => s.roles);
  const { station } = useUserStation();
  const sends = useFarmSendsBuckets(station?.userFarm);
  const hasSession = useAuthStore((s) => s.hasSession);
  const online = useNetworkStore((s) => s.online);
  const farm = station?.userFarm ?? '';
  const hasBucketRequests = useMemo(
    () => getDrawerFor(tenant).some((it) => it.route === 'bucket-requests'),
    [tenant],
  );
  // Signed in, online, at a station: whether it sends buckets now, so a hidden Bucket Requests comes back.
  useEffect(() => {
    if (hasSession && online && farm && hasBucketRequests) void refreshTransferFarms(farm);
  }, [hasSession, online, farm, hasBucketRequests]);

  // Role-gated entries stay out of the drawer AND the home grid, since both
  // render from this same list. Recomputes when roles arrive after login.
  // A station at a farm that never sends buckets (a sales farm packing only its own
  // orders) doesn't get Bucket Requests. A sales farm whose buckets go to another sales
  // farm's orders keeps it.
  const atHub = sends === false;
  const items = useMemo(
    () =>
      getDrawerFor(tenant).filter(
        (it) => (!it.role || rolesInclude(roles, it.role)) && !(atHub && it.route === 'bucket-requests'),
      ),
    [tenant, roles, atHub],
  );

  return <DrawerItemsProvider items={items}>{children}</DrawerItemsProvider>;
}

// Light navigation theme in the app's colours, whatever the phone's dark mode: the
// screens draw behind the phone's own (see-through) button bar, and a dark theme
// left that strip black on every page but the menu.
const NAV_THEME = {
  ...DefaultTheme,
  colors: { ...DefaultTheme.colors, background: COLORS.bgMuted, card: COLORS.surface },
};

// The window behind every screen (and behind the phone's own navigation bar, now
// that the app draws edge to edge) is the app's light grey, not black.
SystemUI.setBackgroundColorAsync(COLORS.bgMuted).catch(() => {});

// A server change (long press, or the login screen) asks first while scans for
// this server are still queued.
setUnsentCounter(countUnsentWork);

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
  const email = useAuthStore((s) => s.email);
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
    <MobileKitProvider>
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
          <TenantProvider>
            <TenantScopedDrawer>
              <ToastProvider>
                <StatusBar style="dark" />
                <ThemeProvider value={NAV_THEME}>
                <Stack
                  screenOptions={{
                    headerShown: false,
                    contentStyle: { backgroundColor: COLORS.bgMuted },
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
                </ThemeProvider>
                {/* Sticky offline indicator across every screen. */}
                <OfflineBanner />
                {/* App-styled confirms / notices (showDialog), above every screen. */}
                <DialogHost />
              </ToastProvider>
            </TenantScopedDrawer>
          </TenantProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
    </MobileKitProvider>
  );
}
