import React from 'react';
import { StyleSheet } from 'react-native';
import { Tabs } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, fontFamily, fontSize } from '@/src/core/theme';
import { AnimatedTabIcon } from '@/src/core/ui/AnimatedTabIcon';

type TabIconPair = {
  outline: keyof typeof Ionicons.glyphMap;
  filled: keyof typeof Ionicons.glyphMap;
};

// Icons mirror the drawer (src/core/ui/SideMenu.tsx). Outlined when unfocused,
// filled when focused — AnimatedTabIcon crossfades between the pair.
const ICONS: Record<string, TabIconPair> = {
  index:                { outline: 'home-outline',              filled: 'home' },
  traceability:         { outline: 'search-outline',            filled: 'search' },
  replacement:          { outline: 'swap-horizontal-outline',   filled: 'swap-horizontal' },
  'edit-details':       { outline: 'create-outline',            filled: 'create' },
  'pending-reshelving': { outline: 'time-outline',              filled: 'time' },
  receiving:            { outline: 'download-outline',          filled: 'download' },
  shelving:             { outline: 'albums-outline',            filled: 'albums' },
  'bucket-requests':    { outline: 'cart-outline',               filled: 'cart' },
  'bucket-transfers':   { outline: 'car-outline',                filled: 'car' },
  'solution-mixing':    { outline: 'flask-outline',              filled: 'flask' },
  'temperature-log':    { outline: 'thermometer-outline',        filled: 'thermometer' },
  'cleaning-record':    { outline: 'sparkles-outline',           filled: 'sparkles' },
  'inspection-log':     { outline: 'checkbox-outline',           filled: 'checkbox' },
  discards:             { outline: 'trash-outline',             filled: 'trash' },
  'intake-qc':          { outline: 'checkmark-done-outline',    filled: 'checkmark-done' },
  'coldroom-qc':        { outline: 'snow-outline',              filled: 'snow' },
  'packhouse-qc':       { outline: 'cube-outline',              filled: 'cube' },
  'packhouse-checks':   { outline: 'sparkles-outline',          filled: 'sparkles' },
  'packhouse-inspection': { outline: 'clipboard-outline',       filled: 'clipboard' },
  'packhouse-cleaning': { outline: 'sparkles-outline',          filled: 'sparkles' },
  'packhouse-glass':    { outline: 'scan-outline',              filled: 'scan' },
};

export default function TabLayout() {
  const insets = useSafeAreaInsets();

  return (
    <Tabs
      screenOptions={({ route }) => ({
        // Each tab's screen renders its own <Screen> with header + hamburger,
        // so the Tabs navigator itself doesn't draw a header.
        headerShown: false,
        tabBarShowLabel: false,
        tabBarStyle: {
          backgroundColor: COLORS.surface,
          borderTopColor: COLORS.border,
          height: 64 + insets.bottom,
          paddingTop: 10,
          paddingBottom: insets.bottom,
        },
        tabBarItemStyle: { paddingTop: 4 },
        tabBarLabelStyle: { fontFamily: fontFamily.medium, fontSize: fontSize.xs },
        tabBarIcon: ({ focused, size }) => {
          const pair = ICONS[route.name];
          // No fallback icon — every visible tab is expected to have an entry
          // in ICONS above. Drawer-only routes use `href: null` and won't hit
          // this path.
          if (!pair) return null;
          return (
            <AnimatedTabIcon outline={pair.outline} filled={pair.filled} focused={focused} size={size} />
          );
        },
      })}
    >
      <Tabs.Screen name="index" options={{ title: 'Home' }} />
      <Tabs.Screen name="traceability" options={{ title: 'Traceability' }} />
      <Tabs.Screen name="replacement" options={{ title: 'Replacement' }} />
      <Tabs.Screen name="receiving" options={{ title: 'Receiving' }} />
      <Tabs.Screen name="shelving" options={{ title: 'Shelving' }} />
      <Tabs.Screen name="intake-qc" options={{ title: 'Intake QC' }} />
      <Tabs.Screen name="discards" options={{ title: 'Discards' }} />

      {/* Drawer-only — hide from bottom bar */}
      <Tabs.Screen name="edit-details" options={{ title: 'Edit Details', href: null }} />
      <Tabs.Screen name="pending-reshelving" options={{ title: 'Pending Reshelving', href: null }} />
      <Tabs.Screen name="bucket-requests" options={{ title: 'Bucket Requests', href: null }} />
      <Tabs.Screen name="bucket-transfers" options={{ title: 'Bucket Transfers', href: null }} />
      <Tabs.Screen name="solution-mixing" options={{ title: 'Solution Mixing', href: null }} />
      <Tabs.Screen name="temperature-log" options={{ title: 'Temperature Log', href: null }} />
      <Tabs.Screen name="cleaning-record" options={{ title: 'Cleaning Record', href: null }} />
      <Tabs.Screen name="inspection-log"  options={{ title: 'Inspection Log',  href: null }} />
      <Tabs.Screen name="coldroom-qc" options={{ title: 'Coldroom QC', href: null }} />
      <Tabs.Screen name="packhouse-qc" options={{ title: 'Packhouse QC', href: null }} />
      <Tabs.Screen name="packhouse-checks" options={{ title: 'Packhouse Cleaning', href: null }} />
      <Tabs.Screen name="packhouse-inspection" options={{ title: 'Packhouse Inspection', href: null }} />
      <Tabs.Screen name="packhouse-cleaning" options={{ title: 'Packhouse Cleaning', href: null }} />
      <Tabs.Screen name="packhouse-glass" options={{ title: 'Glass Inspection', href: null }} />
      <Tabs.Screen name="configure-station" options={{ title: 'Configure Station', href: null }} />
      <Tabs.Screen name="settings" options={{ title: 'Settings', href: null }} />
    </Tabs>
  );
}

// Keep this around for downstream wiring even though Tabs reads it inline.
export const _styles = StyleSheet.create({});
