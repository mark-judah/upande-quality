import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Screen } from '@/src/core/ui/Screen';
import { Card } from '@/src/core/ui/Card';
import { Button } from '@/src/core/ui/Button';
import { Dropdown } from '@/src/core/ui/Dropdown';
import { LabeledInput } from '@/src/core/ui/LabeledInput';
import { useToast } from '@/src/core/ui/Toast';
import { borderRadius, COLORS, fontFamily, fontSize, spacing } from '@/src/core/theme';
import { AREAS, AreaStatus } from '@/src/tenants/karen/repository/karen-vehicle-inspection-repository';
import { useKarenVehicleInspectionStore } from '@/src/tenants/karen/state/karen-vehicle-inspection-store';

const STATUSES: AreaStatus[] = ['OK', 'Defective'];

export function KarenVehicleInspectionScreen() {
  const { showSuccess, showError } = useToast();
  const st = useKarenVehicleInspectionStore();

  useEffect(() => {
    if (st.vehicles.length === 0 && !st.loading && !st.error) st.load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onSubmit = async () => {
    const outcome = await st.submit();
    if (outcome.ok) showSuccess(`Saved ${outcome.name}.`);
    else showError(outcome.error);
  };

  const defective = AREAS.filter((a) => st.areas[a.key] === 'Defective').length;

  return (
    <Screen
      title="Vehicle Inspection"
      loading={st.loading && st.vehicles.length === 0}
      error={st.vehicles.length === 0 ? st.error : null}
      onRetry={st.load}
    >
      <Card>
        <Text style={s.section}>GENERAL INFORMATION</Text>
        <View style={{ height: 8 }} />
        <Dropdown
          label="Vehicle"
          iconName="truck-outline"
          value={st.vehicle}
          options={st.vehicles}
          placeholder="Pick vehicle"
          onChange={st.setVehicle}
        />
        <View style={{ height: 12 }} />
        <LabeledInput
          label="Driver name"
          iconName="account-outline"
          value={st.driverName}
          onChangeText={st.setDriverName}
          placeholder="Optional"
        />
      </Card>

      <Card>
        <Text style={s.section}>
          INSPECTION ({defective}/{AREAS.length} defective)
        </Text>
        <Text style={s.help}>Mark each area OK or Defective. Tap again to clear.</Text>
        <View style={{ height: 8 }} />
        {AREAS.map((area, i) => {
          const selected = st.areas[area.key];
          return (
            <View key={area.key} style={[s.itemRow, i > 0 && s.itemDivider]}>
              <Text style={s.itemLabel}>{area.label}</Text>
              <View style={s.chipRow}>
                {STATUSES.map((status) => {
                  const active = selected === status;
                  const activeStyle = status === 'OK' ? s.chipOk : s.chipBad;
                  return (
                    <Pressable
                      key={status}
                      onPress={() => st.setArea(area.key, status)}
                      style={[s.chip, active && activeStyle]}
                    >
                      <Text style={[s.chipText, active && s.chipTextActive]}>{status}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          );
        })}
      </Card>

      <Card>
        <Text style={s.section}>DEFECT NOTES</Text>
        <View style={{ height: 8 }} />
        <LabeledInput
          label="Defect notes"
          iconName="note-text-outline"
          value={st.defectNotes}
          onChangeText={st.setDefectNotes}
          placeholder="Optional"
          multiline
        />
      </Card>

      <Button label={st.submitting ? 'Saving…' : 'Save'} onPress={onSubmit} loading={st.submitting} />
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
  help: { fontSize: 12, color: COLORS.textMuted, marginTop: 4 },
  itemRow: { paddingVertical: spacing.sm },
  itemDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLORS.border },
  itemLabel: {
    fontFamily: fontFamily.semiBold,
    fontSize: fontSize.sm,
    color: COLORS.text,
    marginBottom: 8,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: borderRadius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
  },
  chipOk: { backgroundColor: COLORS.success, borderColor: COLORS.success },
  chipBad: { backgroundColor: COLORS.danger, borderColor: COLORS.danger },
  chipText: { fontFamily: fontFamily.medium, fontSize: 13, color: COLORS.textSecondary },
  chipTextActive: { color: '#fff' },
});
