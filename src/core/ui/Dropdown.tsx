import { useMemo, useState } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { borderRadius, COLORS, fontFamily, fontSize, spacing } from '@/src/core/theme';

type Option = {
  label: string;
  value: string;
  sublabel?: string;
  /** The label in pieces, some bold (e.g. the varieties and team of an OPL).
   *  `label` is still what search matches. */
  labelParts?: { text: string; bold?: boolean }[];
};

function OptionLabel({ option }: { option: Option }) {
  if (!option.labelParts?.length) return <>{option.label}</>;
  return (
    <>
      {option.labelParts.map((p, i) => (
        <Text key={i} style={p.bold ? s.bold : undefined}>
          {p.text}
        </Text>
      ))}
    </>
  );
}

type Props = {
  label: string;
  value: string | null;
  options: Option[];
  placeholder?: string;
  /** MCI glyph name — kept on MaterialCommunityIcons for backwards-compat. */
  iconName?: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  searchable?: boolean;
  disabled?: boolean;
  /** Small inline field (a header or banner): no label above it — `label` only
   *  titles the picker sheet. */
  compact?: boolean;
  onChange: (value: string) => void;
};

export function Dropdown({
  label,
  value,
  options,
  placeholder,
  iconName,
  searchable = true,
  disabled,
  compact,
  onChange,
}: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const insets = useSafeAreaInsets();
  const selected = options.find((o) => o.value === value);

  const filtered = useMemo(() => {
    if (!searchable || !search.trim()) return options;
    const q = search.toLowerCase();
    return options.filter(
      (o) => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q),
    );
  }, [options, search, searchable]);

  return (
    <View style={compact ? s.wrapCompact : s.wrap}>
      {label && !compact ? <Text style={s.label}>{label}</Text> : null}
      <Pressable
        onPress={() => !disabled && setOpen(true)}
        style={[s.field, compact && s.fieldCompact, disabled && s.fieldDisabled]}
      >
        {iconName ? (
          <MaterialCommunityIcons
            name={iconName}
            size={compact ? 15 : 18}
            color={COLORS.textMuted}
            style={{ marginLeft: compact ? spacing.sm : spacing.md }}
          />
        ) : null}
        <Text
          style={[
            s.value,
            compact && s.valueCompact,
            !selected && s.placeholder,
            !iconName && { paddingLeft: compact ? spacing.sm : spacing.md },
          ]}
          numberOfLines={1}
        >
          {selected ? <OptionLabel option={selected} /> : placeholder ?? 'Select…'}
        </Text>
        <Ionicons
          name="chevron-down"
          size={compact ? 14 : 18}
          color={COLORS.textMuted}
          style={{ marginRight: compact ? spacing.sm : spacing.md }}
        />
      </Pressable>

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)} statusBarTranslucent>
        <View style={s.overlay}>
          {/* Tapping the dimmed area above the sheet closes it, like the ✕. */}
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => {
              setSearch('');
              setOpen(false);
            }}
            accessibilityLabel="Close"
          />
          <View style={[s.sheet, { paddingBottom: insets.bottom }]}>
            <View style={s.sheetHandle} />
            <View style={s.sheetHeader}>
              <Text style={s.sheetTitle} numberOfLines={1}>
                {label || 'Select'}
              </Text>
              <TouchableOpacity onPress={() => setOpen(false)} style={s.closeBtn} activeOpacity={0.7}>
                <Ionicons name="close" size={20} color={COLORS.textSecondary} />
              </TouchableOpacity>
            </View>

            {searchable ? (
              <View style={s.searchWrap}>
                <Ionicons name="search" size={16} color={COLORS.textMuted} />
                <TextInput
                  value={search}
                  onChangeText={setSearch}
                  placeholder="Search…"
                  placeholderTextColor={COLORS.textMuted}
                  style={s.search}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>
            ) : null}

            <FlatList
              data={filtered}
              keyExtractor={(it) => it.value}
              ItemSeparatorComponent={() => <View style={s.sep} />}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => {
                const isSelected = item.value === value;
                return (
                  <TouchableOpacity
                    onPress={() => {
                      onChange(item.value);
                      setSearch('');
                      setOpen(false);
                    }}
                    activeOpacity={0.7}
                    style={s.row}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[s.rowText, isSelected && { fontFamily: fontFamily.semiBold }]}>
                        <OptionLabel option={item} />
                      </Text>
                      {item.sublabel ? <Text style={s.rowSub}>{item.sublabel}</Text> : null}
                    </View>
                    {isSelected ? <Ionicons name="checkmark" size={18} color={COLORS.text} /> : null}
                  </TouchableOpacity>
                );
              }}
              ListEmptyComponent={
                <View style={s.empty}>
                  <Text style={s.emptyText}>No matches.</Text>
                </View>
              }
            />
          </View>
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  bold: { fontFamily: fontFamily.bold, color: COLORS.text },
  wrap: { marginBottom: spacing.md },
  wrapCompact: { marginBottom: 0 },
  fieldCompact: { minHeight: 30 },
  valueCompact: { fontFamily: fontFamily.regular, fontSize: fontSize.sm, paddingHorizontal: spacing.xs, paddingVertical: spacing.xs },
  label: {
    fontFamily: fontFamily.semiBold,
    fontSize: fontSize.sm,
    color: COLORS.text,
    marginBottom: spacing.sm,
  },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: COLORS.bg,
    borderRadius: borderRadius.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
    minHeight: 48,
  },
  fieldDisabled: { opacity: 0.55 },
  value: {
    flex: 1,
    fontFamily: fontFamily.regular,
    fontSize: fontSize.md,
    color: COLORS.text,
    paddingVertical: spacing.md,
  },
  placeholder: { color: COLORS.textMuted },

  overlay: { flex: 1, backgroundColor: COLORS.overlay, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: COLORS.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '75%',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: COLORS.border,
    marginBottom: spacing.sm,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: spacing.md,
    marginBottom: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  sheetTitle: { flex: 1, fontFamily: fontFamily.bold, fontSize: fontSize.lg, color: COLORS.text, marginRight: spacing.md },
  closeBtn: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: COLORS.surfaceAlt,
    justifyContent: 'center', alignItems: 'center',
  },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: COLORS.surfaceAlt,
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.md,
  },
  search: { flex: 1, fontFamily: fontFamily.regular, fontSize: fontSize.md, color: COLORS.text, padding: 0 },

  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.md },
  rowText: { fontFamily: fontFamily.regular, fontSize: fontSize.md, color: COLORS.text },
  rowSub: { fontFamily: fontFamily.regular, fontSize: fontSize.xs, color: COLORS.textMuted, marginTop: 2 },
  sep: { height: StyleSheet.hairlineWidth, backgroundColor: COLORS.border },
  empty: { padding: spacing.xl, alignItems: 'center' },
  emptyText: { fontFamily: fontFamily.regular, fontSize: fontSize.sm, color: COLORS.textMuted },
});
