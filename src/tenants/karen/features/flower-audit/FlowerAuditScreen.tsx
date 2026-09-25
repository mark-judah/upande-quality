import React, { memo, useEffect, useMemo } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '@/src/core/ui/Screen';
import { Card } from '@/src/core/ui/Card';
import { Button } from '@/src/core/ui/Button';
import { Dropdown } from '@/src/core/ui/Dropdown';
import { LabeledInput } from '@/src/core/ui/LabeledInput';
import { useToast } from '@/src/core/ui/Toast';
import { borderRadius, COLORS, fontFamily, fontSize, spacing } from '@/src/core/theme';
import {
  useKarenFlowerAuditStore,
  type SampleRow,
} from '@/src/tenants/karen/state/karen-flower-audit-store';
import type { AuditDef, SampleField } from './constants';

/** One sample line: number, a cell per measured column, and a remove button.
 *  Memoised so typing in one row doesn't re-render (and un-focus) the rest. */
const SampleRowView = memo(function SampleRowView({
  row,
  index,
  columns,
  onChange,
  onRemove,
}: {
  row: SampleRow;
  index: number;
  columns: AuditDef['columns'];
  onChange: (id: number, field: SampleField, text: string) => void;
  onRemove: (id: number) => void;
}) {
  return (
    <View style={s.row}>
      <Text style={s.rowNo}>{index + 1}</Text>
      {columns.map((c) => (
        <View key={c.field} style={s.cell}>
          <TextInput
            value={row.values[c.field] ?? ''}
            onChangeText={(t) => onChange(row.id, c.field, t)}
            keyboardType="decimal-pad"
            placeholder="—"
            placeholderTextColor={COLORS.textMuted}
            style={s.cellInput}
          />
        </View>
      ))}
      <Pressable onPress={() => onRemove(row.id)} hitSlop={8} style={s.rowRemove}>
        <Ionicons name="close" size={16} color={COLORS.textMuted} />
      </Pressable>
    </View>
  );
});

export function KarenFlowerAuditScreen({ audit }: { audit: AuditDef }) {
  const { showSuccess, showError } = useToast();
  const st = useKarenFlowerAuditStore();

  useEffect(() => {
    if (st.farms.length === 0 && !st.loading && !st.error) st.load();
    // Pickers load once per session; the four audits share them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fresh sample rows whenever the operator switches audit from the hub.
  useEffect(() => {
    st.resetForm();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audit.type]);

  const farmOptions = useMemo(
    () => st.farms.map((f) => ({ label: f, value: f })),
    [st.farms],
  );

  // Greenhouses belong to a farm — show only the chosen farm's own.
  const greenhouseOptions = useMemo(
    () => st.greenhouses.filter((g) => g.farm === st.farm),
    [st.greenhouses, st.farm],
  );

  const onSubmit = async () => {
    const outcome = await st.submit(audit);
    if (outcome.kind === 'ok') {
      showSuccess(`Saved ${outcome.name}.`);
      st.resetForm();
    } else {
      showError(outcome.message);
    }
  };

  return (
    <Screen
      title={audit.type}
      loading={st.loading && st.farms.length === 0}
      error={st.farms.length === 0 ? st.error : null}
      onRetry={st.load}
    >
      <Card>
        <Text style={s.section}>AUDIT</Text>
        <View style={{ height: 8 }} />
        <Dropdown
          label="Farm"
          iconName="barn"
          value={st.farm}
          options={farmOptions}
          placeholder="Pick farm"
          onChange={st.setFarm}
        />
        {audit.needsGreenhouse ? (
          <>
            <View style={{ height: 12 }} />
            <Dropdown
              label="Greenhouse"
              iconName="greenhouse"
              value={st.greenhouse}
              options={greenhouseOptions}
              placeholder={st.farm ? 'Pick greenhouse' : 'Pick a farm first'}
              disabled={!st.farm}
              onChange={st.setGreenhouse}
            />
          </>
        ) : null}
        <View style={{ height: 12 }} />
        <Dropdown
          label="Variety"
          iconName="flower-outline"
          value={st.variety}
          options={st.varieties}
          placeholder="Pick variety"
          onChange={st.setVariety}
        />
      </Card>

      <Card>
        <Text style={s.section}>SAMPLES</Text>
        <Text style={s.sectionHint}>{audit.hint}</Text>

        <View style={s.headerRow}>
          <Text style={[s.rowNo, s.headerText]}>#</Text>
          {audit.columns.map((c) => (
            <Text key={c.field} style={[s.cell, s.headerText]} numberOfLines={1}>
              {c.unit ? `${c.header} (${c.unit})` : c.header}
            </Text>
          ))}
          <View style={s.rowRemove} />
        </View>

        {st.rows.map((row, i) => (
          <SampleRowView
            key={row.id}
            row={row}
            index={i}
            columns={audit.columns}
            onChange={st.setCell}
            onRemove={st.removeRow}
          />
        ))}

        <Button label="Add sample" variant="outline" iconLeft="add" onPress={st.addRow} style={{ marginTop: spacing.md }} />
      </Card>

      <Card>
        <Text style={s.section}>REMARKS</Text>
        <View style={{ height: 8 }} />
        <LabeledInput
          label=""
          value={st.remarks}
          onChangeText={st.setRemarks}
          placeholder="Optional"
          multiline
        />
      </Card>

      <Button
        label={st.submitting ? 'Saving…' : 'Save audit'}
        onPress={onSubmit}
        loading={st.submitting}
      />
    </Screen>
  );
}

const s = StyleSheet.create({
  section: {
    fontFamily: fontFamily.semiBold,
    fontSize: fontSize.xs,
    color: COLORS.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  sectionHint: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.xs,
    color: COLORS.textMuted,
    marginTop: 2,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
    paddingBottom: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  headerText: {
    fontFamily: fontFamily.medium,
    fontSize: fontSize.xs,
    color: COLORS.textMuted,
    textAlign: 'center',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm },
  rowNo: {
    width: 20,
    textAlign: 'center',
    fontFamily: fontFamily.medium,
    fontSize: fontSize.sm,
    color: COLORS.textMuted,
  },
  cell: { flex: 1 },
  cellInput: {
    backgroundColor: COLORS.bg,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: borderRadius.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    textAlign: 'center',
    fontFamily: fontFamily.regular,
    fontSize: fontSize.md,
    color: COLORS.text,
  },
  rowRemove: { width: 24, alignItems: 'center', justifyContent: 'center' },
});
