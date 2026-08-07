import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '@/src/core/ui/Screen';
import { borderRadius, COLORS, fontFamily, fontSize, spacing } from '@/src/core/theme';

const TILES: { route: string; label: string; hint: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  {
    route: 'packhouse-inspection',
    label: 'Inspection Log',
    hint: 'Area conditions — tables, floor, lights, trolleys…',
    icon: 'clipboard-outline',
  },
  {
    route: 'packhouse-cleaning',
    label: 'Cleaning Checklist',
    hint: 'Mode of cleaning, detergent & disinfectant used',
    icon: 'sparkles-outline',
  },
  {
    route: 'packhouse-glass',
    label: 'Glass Inspection',
    hint: 'Glass & fragile items — window glass, lamps, screens…',
    icon: 'scan-outline',
  },
];

export function PackhouseCleaningHubScreen() {
  return (
    <Screen title="Packhouse Cleaning">
      <ScrollView contentContainerStyle={{ paddingBottom: spacing.xxl }} showsVerticalScrollIndicator={false}>
        <Text style={s.subtitle}>Pick a checklist to fill in.</Text>
        <View style={s.grid}>
          {TILES.map((t) => (
            <Pressable
              key={t.route}
              onPress={() => router.push(`/${t.route}` as never)}
              style={({ pressed }) => [s.tile, pressed && { opacity: 0.7 }]}
            >
              <View style={s.tileIcon}>
                <Ionicons name={t.icon} size={22} color={COLORS.text} />
              </View>
              <Text style={s.tileLabel}>{t.label}</Text>
              <Text style={s.tileHint} numberOfLines={2}>
                {t.hint}
              </Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </Screen>
  );
}

const s = StyleSheet.create({
  subtitle: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.sm,
    color: COLORS.textMuted,
    marginBottom: spacing.md,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
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
  tileHint: { fontFamily: fontFamily.regular, fontSize: fontSize.xs, color: COLORS.textMuted, lineHeight: 16 },
});
