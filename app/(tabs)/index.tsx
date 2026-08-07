import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '@/src/core/ui/Screen';
import { Card } from '@/src/core/ui/Card';
import { useAuthStore } from '@/src/core/auth/store';
import { useDrawerItems } from '@/src/core/ui/drawer-items-context';
import { borderRadius, COLORS, fontFamily, fontSize, spacing } from '@/src/core/theme';
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
  'solution-mixing': 'flask-outline',
  'temperature-log': 'thermometer-outline',
  'cleaning-record': 'sparkles-outline',
  'inspection-log': 'checkbox-outline',
  discards: 'trash-outline',
  'intake-qc': 'checkmark-done-outline',
  'coldroom-qc': 'snow-outline',
  'packhouse-qc': 'cube-outline',
  'packhouse-checks': 'sparkles-outline',
};

const ROUTE_HINTS: Record<string, string> = {
  traceability: 'Scan a bucket or bunch to see its full journey',
  replacement: 'Swap buckets, move bunches, replace stems',
  'edit-details': 'Correct variety or stem length',
  'pending-reshelving': 'Bunches waiting for a destination',
  receiving: 'Daily receiving entry',
  shelving: 'Scan shelf then buckets',
  'bucket-requests': 'Build trolleys from the daily pick list',
  'solution-mixing': 'Log post-harvest chemical mixes',
  'temperature-log': 'Cold store temperatures throughout the day',
  'cleaning-record': 'Cleaning + disinfection of cold rooms',
  'inspection-log': 'Daily coldroom condition rounds',
  discards: 'Discard old or rejected buckets',
  'intake-qc': 'Inspect arriving batches',
  'coldroom-qc': 'Quality checks in the coldroom',
  'packhouse-qc': 'Quality checks in the packhouse',
  'packhouse-checks': 'Inspection, cleaning & glass checklists',
};

export default function HomeScreen() {
  const fullName = useAuthStore((s) => s.fullName);
  const email = useAuthStore((s) => s.email);
  const items = useDrawerItems();

  return (
    <Screen title="Upande Quality">
      <ScrollView
        contentContainerStyle={s.scroll}
        showsVerticalScrollIndicator={false}
      >
        <Card>
          <Text style={s.greeting}>Welcome,</Text>
          <Text style={s.name}>{fullName || email || 'Quality user'}</Text>
        </Card>

        <View style={s.grid}>
          {items.map((it: DrawerItem) => (
            <Pressable
              key={it.route}
              onPress={() => {
                if (it.comingSoon) return;
                router.push(`/${it.route}` as never);
              }}
              style={({ pressed }) => [
                s.tile,
                it.comingSoon && s.tileMuted,
                pressed && !it.comingSoon && { opacity: 0.7 },
              ]}
            >
              <View style={s.tileIcon}>
                <Ionicons
                  name={ROUTE_ICONS[it.route] ?? 'apps-outline'}
                  size={22}
                  color={it.comingSoon ? COLORS.textMuted : COLORS.text}
                />
              </View>
              <Text style={[s.tileLabel, it.comingSoon && s.tileLabelMuted]}>
                {it.label}
              </Text>
              {it.comingSoon ? (
                <Text style={s.tileComingSoon}>Coming soon</Text>
              ) : (
                <Text style={s.tileHint} numberOfLines={2}>
                  {ROUTE_HINTS[it.route] ?? ''}
                </Text>
              )}
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </Screen>
  );
}

const s = StyleSheet.create({
  scroll: { paddingBottom: spacing.xxl },
  greeting: { fontFamily: fontFamily.regular, fontSize: fontSize.sm, color: COLORS.textSecondary },
  name: { fontFamily: fontFamily.bold, fontSize: fontSize.lg, color: COLORS.text, marginTop: 2 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, marginTop: spacing.xs },
  tile: {
    flexBasis: '48%',
    flexGrow: 0,
    backgroundColor: COLORS.surface,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.border,
    gap: spacing.xs,
  },
  tileIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: COLORS.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  tileLabel: { fontFamily: fontFamily.semiBold, fontSize: fontSize.md, color: COLORS.text },
  tileLabelMuted: { color: COLORS.textMuted },
  tileMuted: { opacity: 0.65 },
  tileHint: { fontFamily: fontFamily.regular, fontSize: fontSize.xs, color: COLORS.textMuted, lineHeight: 16 },
  tileComingSoon: {
    fontFamily: fontFamily.medium,
    fontSize: 10,
    color: COLORS.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
});
