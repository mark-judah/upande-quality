import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { Screen } from '@/src/core/ui/Screen';
import { Card } from '@/src/core/ui/Card';
import { useAuthStore } from '@/src/core/auth/store';
import { useDrawerItems } from '@/src/core/ui/drawer-items-context';
import { borderRadius, COLORS, fontFamily, fontSize, spacing, scaleFont } from '@/src/core/theme';
import type { DrawerItem } from '@/src/core/tenant/types';

/** Map each known drawer route to a stable Ionicon. Kept in sync with the
 *  side drawer (src/core/ui/SideMenu.tsx) and the bottom tab bar
 *  (app/(tabs)/_layout.tsx) so users see the same glyph everywhere. */
const ROUTE_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  traceability: 'search-outline',
  replacement: 'swap-horizontal-outline',
  'edit-details': 'create-outline',
  'pending-reshelving': 'time-outline',
  receiving: 'download-outline',
  shelving: 'albums-outline',
  'bucket-requests': 'cart-outline',
  'free-shelves': 'file-tray-outline',
  'solution-mixing': 'flask-outline',
  'temperature-log': 'thermometer-outline',
  'product-temperature': 'snow-outline',
  'freight-dispatch': 'airplane-outline',
  'cleaning-record': 'sparkles-outline',
  'inspection-log': 'checkbox-outline',
  discards: 'trash-outline',
  'intake-qc': 'checkmark-done-outline',
  'coldroom-qc': 'snow-outline',
  'packhouse-qc': 'cube-outline',
  'packhouse-checks': 'sparkles-outline',
  vaselife: 'flower-outline',
  'flower-audit': 'leaf-outline',
};

const ROUTE_HINTS: Record<string, string> = {
  traceability: 'Scan a bucket or bunch to see its full journey',
  replacement: 'Swap buckets, move bunches, replace stems',
  'edit-details': 'Correct variety or stem length',
  'pending-reshelving': 'Bunches waiting for a destination',
  receiving: 'Daily receiving entry',
  shelving: 'Scan shelf then buckets',
  'bucket-requests': 'Build trolleys from the daily pick list',
  'free-shelves': 'Shelves with room, and how many buckets each can take',
  'solution-mixing': 'Log post-harvest chemical mixes',
  'temperature-log': 'Cold store temperatures throughout the day',
  'product-temperature': 'Box temperatures with photos at each control point',
  'freight-dispatch': 'Depart, arrive & offload — one trip at a time',
  'cleaning-record': 'Cleaning + disinfection of cold rooms',
  'inspection-log': 'Daily coldroom condition rounds',
  discards: 'Discard old or rejected buckets',
  'intake-qc': 'Inspect arriving batches',
  'coldroom-qc': 'Quality checks in the coldroom',
  'packhouse-qc': 'Quality checks in the packhouse',
  'packhouse-checks': 'Inspection, cleaning & glass checklists',
  vaselife: 'Vase life sampling & observations',
  'flower-audit': 'Bud count, head size, stem weight & spray diameter',
};

export default function HomeScreen() {
  const { tenant } = useTenant();
  const fullName = useAuthStore((s) => s.fullName);
  const email = useAuthStore((s) => s.email);

  // The KPI home reads upande_quality's getQualityDashboardData, which only
  // the Karen sites serve.
  if (tenant === 'Karen' || tenant === 'Demo') return <KarenHomeScreen />;

  return (
    <Screen title="Upande Quality">
      <Card>
        <Text style={s.greeting}>Welcome,</Text>
        <Text style={s.name}>{fullName || email || 'Quality user'}</Text>
      </Card>
    </Screen>
  );
}

const s = StyleSheet.create({
  greeting: { fontFamily: fontFamily.regular, fontSize: fontSize.sm, color: COLORS.textSecondary },
  name: { fontFamily: fontFamily.bold, fontSize: fontSize.lg, color: COLORS.text, marginTop: 2 },
});
