import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { addDays, format, parseISO } from 'date-fns';
import { borderRadius, COLORS, fontFamily, fontSize, spacing } from '@/src/core/theme';
import { todayISO } from '@/src/tenants/karen/state/karen-dashboard-store';

/** One day back or forward (never past today); tapping the label returns to today. */
export function DayStepper({ value, onChange }: { value: string; onChange: (date: string) => void }) {
  const today = todayISO();
  const isToday = value >= today;
  const step = (days: number) => onChange(format(addDays(parseISO(value), days), 'yyyy-MM-dd'));
  return (
    <View style={s.stepper}>
      <Pressable hitSlop={8} style={s.stepperBtn} onPress={() => step(-1)}>
        <Ionicons name="chevron-back" size={18} color={COLORS.text} />
      </Pressable>
      <Pressable hitSlop={8} onPress={() => !isToday && onChange(today)}>
        <Text style={s.stepperLabel}>{isToday ? 'Today' : format(parseISO(value), 'EEE d MMM yyyy')}</Text>
      </Pressable>
      <Pressable hitSlop={8} style={s.stepperBtn} disabled={isToday} onPress={() => step(1)}>
        <Ionicons name="chevron-forward" size={18} color={isToday ? COLORS.border : COLORS.text} />
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: COLORS.surface,
    borderRadius: borderRadius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.border,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    marginBottom: spacing.md,
  },
  stepperBtn: { padding: spacing.xs },
  stepperLabel: { fontFamily: fontFamily.semiBold, fontSize: fontSize.sm, color: COLORS.text },
});
