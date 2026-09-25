import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '@/src/core/ui/Screen';
import { borderRadius, COLORS, fontFamily, fontSize, spacing } from '@/src/core/theme';
import { AUDITS } from './constants';

export function KarenFlowerAuditHubScreen() {
  return (
    <Screen title="Flower Audit">
      <ScrollView contentContainerStyle={{ paddingBottom: spacing.xxl }} showsVerticalScrollIndicator={false}>
        <Text style={s.subtitle}>Pick an audit to record samples.</Text>
        <View style={s.grid}>
          {AUDITS.map((a) => (
            <Pressable
              key={a.slug}
              onPress={() => router.push(`/flower-audit-entry?audit=${a.slug}` as never)}
              style={({ pressed }) => [s.tile, pressed && { opacity: 0.7 }]}
            >
              <View style={s.tileIcon}>
                <Ionicons name={a.icon} size={22} color={COLORS.text} />
              </View>
              <Text style={s.tileLabel}>{a.type}</Text>
              <Text style={s.tileHint} numberOfLines={2}>
                {a.hint}
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
