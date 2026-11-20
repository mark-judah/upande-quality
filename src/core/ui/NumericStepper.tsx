import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { borderRadius, COLORS, fontFamily, fontSize, spacing } from '@/src/core/theme';

/** Non-negative integer field with inline − / + steppers. Clamps to `min`
 *  (default 1) and ignores non-digit input. Reusable across forms. */
export function NumericStepper({
  value,
  onChange,
  min = 1,
  invalid,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  invalid?: boolean;
}) {
  const clamp = (n: number) => (Number.isFinite(n) ? Math.max(min, Math.trunc(n)) : min);

  return (
    <View style={[s.wrap, invalid && s.wrapInvalid]}>
      <Pressable
        onPress={() => onChange(clamp(value - 1))}
        disabled={value <= min}
        style={[s.btn, value <= min && s.btnDisabled]}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityLabel="Decrease"
      >
        <Ionicons name="remove" size={20} color={value <= min ? COLORS.textMuted : COLORS.text} />
      </Pressable>
      <TextInput
        value={String(value)}
        onChangeText={(t) => {
          const digits = t.replace(/[^0-9]/g, '');
          onChange(digits === '' ? min : clamp(Number(digits)));
        }}
        keyboardType="number-pad"
        selectTextOnFocus
        style={s.input}
      />
      <Pressable
        onPress={() => onChange(clamp(value + 1))}
        style={s.btn}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityLabel="Increase"
      >
        <Ionicons name="add" size={20} color={COLORS.text} />
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: COLORS.surface,
    borderRadius: borderRadius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.border,
    overflow: 'hidden',
  },
  wrapInvalid: { borderColor: COLORS.danger },
  btn: {
    width: 46,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.bgMuted,
  },
  btnDisabled: { opacity: 0.5 },
  input: {
    minWidth: 64,
    textAlign: 'center',
    paddingHorizontal: spacing.md,
    fontFamily: fontFamily.semiBold,
    fontSize: fontSize.md,
    color: COLORS.text,
  },
});
