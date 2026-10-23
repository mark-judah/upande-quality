import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { borderRadius, COLORS, fontFamily, fontSize, spacing } from '@/src/core/theme';

/** What was just scanned, shown the moment it is scanned — before its details load —
 *  so the operator sees at once which bucket / bunch the screen is working on. */
export function ScannedStamp({ kind, id, loading }: { kind: string; id: string; loading?: boolean }) {
  return (
    <View style={s.stamp}>
      <Ionicons name={kind === 'bunch' ? 'flower-outline' : 'cube-outline'} size={18} color={COLORS.text} />
      <View style={s.text}>
        <Text style={s.kind}>{kind.toUpperCase()}</Text>
        <Text style={s.id} numberOfLines={1}>
          {id.toUpperCase()}
        </Text>
      </View>
      {loading ? <ActivityIndicator size="small" color={COLORS.textMuted} /> : null}
    </View>
  );
}

const s = StyleSheet.create({
  stamp: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.md,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
  },
  text: { flex: 1, minWidth: 0 },
  kind: { fontFamily: fontFamily.medium, fontSize: fontSize.xs, color: COLORS.textMuted, letterSpacing: 0.4 },
  id: { fontFamily: fontFamily.bold, fontSize: fontSize.lg, color: COLORS.text },
});
