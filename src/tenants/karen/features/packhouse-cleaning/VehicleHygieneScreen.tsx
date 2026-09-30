import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Screen } from '@/src/core/ui/Screen';
import { Card } from '@/src/core/ui/Card';
import { Button } from '@/src/core/ui/Button';
import { Dropdown } from '@/src/core/ui/Dropdown';
import { LabeledInput } from '@/src/core/ui/LabeledInput';
import { useToast } from '@/src/core/ui/Toast';
import { borderRadius, COLORS, fontFamily, fontSize, spacing } from '@/src/core/theme';
import {
  SURFACES,
  useKarenVehicleHygieneStore,
} from '@/src/tenants/karen/state/karen-vehicle-hygiene-store';

export function KarenVehicleHygieneScreen() {
  const { showSuccess, showError } = useToast();
  const st = useKarenVehicleHygieneStore();

  useEffect(() => {
    if (st.vehicles.length === 0 && !st.loading && !st.error) st.load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onSubmit = async () => {
    const outcome = await st.submit();
    if (outcome.kind === 'ok') {
      showSuccess(`Saved ${outcome.name}.`);
      st.resetForm();
    } else {
      showError(outcome.message);
    }
  };

  const flagged = SURFACES.filter((x) => st.picked[x.key].length > 0).length;

  return (
    <Screen
      title="Vehicle Hygiene"
      loading={st.loading && st.vehicles.length === 0}
      error={st.vehicles.length === 0 ? st.error : null}
      onRetry={st.load}
    >
      <Card>
        <Text style={s.section}>VEHICLE</Text>
        <View style={{ height: 8 }} />
        <Dropdown
          label="Vehicle"
          iconName="truck-outline"
          value={st.vehicle}
          options={st.vehicles}
          placeholder="Pick vehicle"
          onChange={st.setVehicle}
        />
      </Card>

      <Card>
        <Text style={s.section}>
          FINDINGS ({flagged}/{SURFACES.length})
        </Text>
        <Text style={s.help}>
          Tap what you found on each surface — you can flag more than one. Leave a surface blank if
          it was fine.
        </Text>
        <View style={{ height: 8 }} />
        {st.conditions.length === 0 ? (
          <Text style={s.empty}>
            No conditions set up yet. Add them under Packhouse Condition on the desk.
          </Text>
        ) : (
          SURFACES.map((surface, i) => {
            const selected = st.picked[surface.key];
            return (
              <View key={surface.key} style={[s.itemRow, i > 0 && s.itemDivider]}>
                <Text style={s.itemLabel}>{surface.label}</Text>
                <View style={s.chipRow}>
                  {st.conditions.map((c) => {
                    const active = selected.includes(c);
                    return (
                      <Pressable
                        key={c}
                        onPress={() => st.toggleCondition(surface.key, c)}
                        style={[s.chip, active && s.chipActive]}
                      >
                        <Text style={[s.chipText, active && s.chipTextActive]}>{c}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            );
          })
        )}
      </Card>

      <Card>
        <Text style={s.section}>SANITATION USED</Text>
        <View style={{ height: 8 }} />
        <Dropdown
          label="Detergent used"
          iconName="bottle-tonic-outline"
          value={st.detergent}
          options={st.detergents}
          placeholder="Pick detergent"
          onChange={st.setDetergent}
        />
        <View style={{ height: 12 }} />
        <Dropdown
          label="Disinfectant used"
          iconName="bottle-tonic-plus-outline"
          value={st.disinfectant}
          options={st.disinfectants}
          placeholder="Pick disinfectant"
          onChange={st.setDisinfectant}
        />
        <View style={{ height: 12 }} />
        <LabeledInput
          label="Remarks"
          iconName="note-text-outline"
          value={st.remarks}
          onChangeText={st.setRemarks}
          placeholder="Optional"
          multiline
        />
      </Card>

      <Button
        label={st.submitting ? 'Saving…' : 'Save'}
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
  help: { fontSize: 12, color: COLORS.textMuted, marginTop: 4 },
  empty: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.sm,
    color: COLORS.textMuted,
    paddingVertical: spacing.sm,
  },
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
  chipActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  chipText: { fontFamily: fontFamily.medium, fontSize: 13, color: COLORS.textSecondary },
  chipTextActive: { color: COLORS.textOnPrimary },
});
