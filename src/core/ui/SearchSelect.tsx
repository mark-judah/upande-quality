import { useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { borderRadius, COLORS, fontFamily, fontSize, spacing } from '@/src/core/theme';

/** Searchable picker. Like the shared Dropdown, but when `allowAdd` is set it
 *  offers a "+ Add '<typed>'" row so a value that isn't in the list (a new
 *  supervisor, or a farm/greenhouse the local master hasn't got yet) can be
 *  entered inline. One component covers the three link-ish fields. */
export function SearchSelect({
  label,
  value,
  options,
  placeholder,
  iconName,
  disabled,
  allowAdd,
  invalid,
  onChange,
}: {
  label: string;
  value: string | null;
  options: string[];
  placeholder?: string;
  iconName?: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  disabled?: boolean;
  allowAdd?: boolean;
  invalid?: boolean;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const insets = useSafeAreaInsets();

  const q = search.trim();
  // Drop blanks + duplicates so each row key is unique (two users can share a
  // full name, which would otherwise collide on `key={item}`).
  const unique = useMemo(() => Array.from(new Set(options.filter(Boolean))), [options]);
  const filtered = useMemo(() => {
    if (!q) return unique;
    const lc = q.toLowerCase();
    return unique.filter((o) => o.toLowerCase().includes(lc));
  }, [unique, q]);

  const canAdd = !!allowAdd && q.length > 0 && !unique.some((o) => o.toLowerCase() === q.toLowerCase());

  const pick = (v: string) => {
    onChange(v);
    setSearch('');
    setOpen(false);
  };

  return (
    <View style={s.wrap}>
      {label ? <Text style={s.label}>{label}</Text> : null}
      <Pressable
        onPress={() => !disabled && setOpen(true)}
        style={[s.field, disabled && s.fieldDisabled, invalid && s.fieldInvalid]}
      >
        {iconName ? (
          <MaterialCommunityIcons name={iconName} size={18} color={COLORS.textMuted} style={{ marginLeft: spacing.md }} />
        ) : null}
        <Text style={[s.fieldText, !value && s.fieldPlaceholder]} numberOfLines={1}>
          {value || placeholder || 'Select'}
        </Text>
        <Ionicons name="chevron-down" size={18} color={COLORS.textMuted} style={{ marginRight: spacing.md }} />
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={s.backdrop} onPress={() => setOpen(false)}>
          <Pressable style={[s.sheet, { paddingBottom: insets.bottom + spacing.md }]} onPress={() => {}}>
            <View style={s.searchBar}>
              <Ionicons name="search" size={18} color={COLORS.textMuted} />
              <TextInput
                value={search}
                onChangeText={setSearch}
                placeholder={allowAdd ? 'Add or search' : 'Search'}
                placeholderTextColor={COLORS.textMuted}
                autoFocus
                style={s.searchInput}
              />
            </View>
            <ScrollView
              style={{ maxHeight: 320 }}
              keyboardShouldPersistTaps="handled"
              nestedScrollEnabled
            >
              {canAdd ? (
                <Pressable style={[s.row, s.addRow]} onPress={() => pick(q)}>
                  <Ionicons name="add-circle-outline" size={18} color={COLORS.primary} />
                  <Text style={[s.rowText, { color: COLORS.primary }]} numberOfLines={1}>
                    Add “{q}”
                  </Text>
                </Pressable>
              ) : null}
              {filtered.length === 0 && !canAdd ? (
                <Text style={s.empty}>No matches</Text>
              ) : null}
              {filtered.map((item) => {
                const active = item === value;
                return (
                  <Pressable key={item} style={s.row} onPress={() => pick(item)}>
                    <Text style={[s.rowText, active && s.rowTextActive]} numberOfLines={1}>{item}</Text>
                    {active ? <Ionicons name="checkmark" size={18} color={COLORS.primary} /> : null}
                  </Pressable>
                );
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { gap: 6 },
  label: { fontFamily: fontFamily.medium, fontSize: fontSize.xs, color: COLORS.textSecondary },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 46,
    backgroundColor: COLORS.surface,
    borderRadius: borderRadius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.border,
  },
  fieldDisabled: { opacity: 0.5 },
  fieldInvalid: { borderColor: COLORS.danger },
  fieldText: { flex: 1, paddingHorizontal: spacing.md, fontFamily: fontFamily.regular, fontSize: fontSize.sm, color: COLORS.text },
  fieldPlaceholder: { color: COLORS.textMuted },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: COLORS.surface,
    borderTopLeftRadius: borderRadius.lg,
    borderTopRightRadius: borderRadius.lg,
    padding: spacing.md,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: spacing.md,
    backgroundColor: COLORS.bgMuted,
    borderRadius: borderRadius.sm,
    marginBottom: spacing.sm,
  },
  searchInput: { flex: 1, paddingVertical: 10, fontFamily: fontFamily.regular, fontSize: fontSize.sm, color: COLORS.text },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 13,
    paddingHorizontal: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  addRow: { backgroundColor: COLORS.bgMuted, borderRadius: borderRadius.sm },
  rowText: { flex: 1, fontFamily: fontFamily.regular, fontSize: fontSize.sm, color: COLORS.text },
  rowTextActive: { fontFamily: fontFamily.semiBold, color: COLORS.primary },
  empty: { textAlign: 'center', padding: spacing.lg, color: COLORS.textMuted, fontSize: fontSize.sm },
});
