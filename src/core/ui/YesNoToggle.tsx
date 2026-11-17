import { Pressable, StyleSheet, Text, View } from 'react-native';
import { borderRadius, COLORS, fontFamily, fontSize } from '@/src/core/theme';

export type YesNo = 'NO' | 'YES';

/** Full-width segmented control: two equal-width buttons, the active one
 *  highlighted. `yesFirst` (default) puts YES on the left, NO on the right. */
export function YesNoToggle({
  value,
  onChange,
  invalid,
  yesFirst = true,
}: {
  value: YesNo | null;
  onChange: (v: YesNo) => void;
  invalid?: boolean;
  yesFirst?: boolean;
}) {
  const order: YesNo[] = yesFirst ? ['YES', 'NO'] : ['NO', 'YES'];
  return (
    <View style={[s.wrap, invalid && s.wrapInvalid]}>
      {order.map((opt) => {
        const active = value === opt;
        return (
          <Pressable
            key={opt}
            onPress={() => onChange(opt)}
            style={[s.btn, active && s.btnActive]}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
          >
            <Text style={[s.text, active && s.textActive]}>{opt}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    backgroundColor: COLORS.bgMuted,
    borderRadius: borderRadius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.border,
    padding: 3,
    gap: 3,
  },
  wrapInvalid: { borderColor: COLORS.danger },
  btn: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: borderRadius.sm - 2,
  },
  btnActive: { backgroundColor: COLORS.primary },
  text: { fontFamily: fontFamily.semiBold, fontSize: fontSize.sm, color: COLORS.textSecondary },
  textActive: { color: COLORS.textOnPrimary },
});
