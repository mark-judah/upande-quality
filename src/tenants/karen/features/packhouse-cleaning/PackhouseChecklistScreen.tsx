import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Screen } from '@/src/core/ui/Screen';
import { Card } from '@/src/core/ui/Card';
import { Button } from '@/src/core/ui/Button';
import { Dropdown } from '@/src/core/ui/Dropdown';
import { LabeledInput } from '@/src/core/ui/LabeledInput';
import { useToast } from '@/src/core/ui/Toast';
import { borderRadius, COLORS, fontFamily, fontSize, spacing } from '@/src/core/theme';
import { useAuthStore } from '@/src/core/auth/store';
import type { ComponentSpec } from './constants';
import type { InspectionPayload } from '@/src/tenants/karen/api/karen-packhouse-cleaning-api';
import type { SubmitOutcome } from '@/src/tenants/karen/state/karen-packhouse-cleaning-store';

/** Shared area × component-condition checklist — used by both the Inspection
 *  Log and the Glass-materials Inspection (structurally identical: one record
 *  per area, one condition per component). Each component carries its own set
 *  of options, tapped directly like the Coldroom inspection log. */
export function PackhouseChecklistScreen({
  title,
  areaLabel,
  areas,
  components,
  submitting,
  onSubmit,
}: {
  title: string;
  areaLabel: string;
  areas: string[];
  components: ComponentSpec[];
  submitting: boolean;
  onSubmit: (payload: InspectionPayload) => Promise<SubmitOutcome>;
}) {
  const { showSuccess, showError } = useToast();
  const fullName = useAuthStore((s) => s.fullName);
  const email = useAuthStore((s) => s.email);

  const [area, setArea] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [values, setValues] = useState<Record<string, string[]>>({});
  const [inspectedBy, setInspectedBy] = useState(fullName || email || '');
  const [remarks, setRemarks] = useState('');

  // Each item can carry several conditions — tap to add, tap again to remove.
  const toggle = (component: string, condition: string) =>
    setValues((st) => {
      const current = st[component] ?? [];
      const nextList = current.includes(condition)
        ? current.filter((c) => c !== condition)
        : [...current, condition];
      const next = { ...st };
      if (nextList.length === 0) delete next[component];
      else next[component] = nextList;
      return next;
    });

  const filled = components.filter((c) => values[c.label]?.length).length;

  const onPressSubmit = async () => {
    if (!area) return showError('Pick an area.');
    const checks = components.flatMap((c) =>
      (values[c.label] ?? []).map((condition) => ({ component: c.label, condition })),
    );
    if (checks.length === 0) return showError('Record at least one condition.');
    const outcome = await onSubmit({
      date,
      area,
      inspected_by: inspectedBy || undefined,
      remarks: remarks || undefined,
      checks,
    });
    if (outcome.kind === 'ok') {
      showSuccess(`Saved ${outcome.name}.`);
      setValues({});
      setRemarks('');
    } else {
      showError(outcome.message);
    }
  };

  return (
    <Screen title={title} scroll={false}>
      <ScrollView contentContainerStyle={{ paddingBottom: spacing.xxl }} keyboardShouldPersistTaps="handled">
        <Card>
          <Text style={s.section}>WHERE &amp; WHEN</Text>
          <View style={{ height: 8 }} />
          <Dropdown
            label={areaLabel}
            iconName="map-marker-outline"
            value={area}
            options={areas.map((a) => ({ label: a, value: a }))}
            placeholder="Pick area"
            onChange={setArea}
          />
          <View style={{ height: 12 }} />
          <LabeledInput
            label="Date"
            iconName="calendar-outline"
            value={date}
            onChangeText={setDate}
            placeholder="YYYY-MM-DD"
            autoCapitalize="none"
          />
        </Card>

        <Card>
          <Text style={s.section}>
            CONDITIONS ({filled}/{components.length})
          </Text>
          <Text style={s.help}>Tap conditions for each item — you can flag more than one. Skip any you didn&apos;t inspect.</Text>
          <View style={{ height: 8 }} />
          {components.map((c, i) => {
            const selected = values[c.label] ?? [];
            return (
              <View key={c.label} style={[s.itemRow, i > 0 && s.itemDivider]}>
                <Text style={s.itemLabel}>{c.label}</Text>
                <View style={s.chipRow}>
                  {c.options.map((o) => {
                    const active = selected.includes(o);
                    return (
                      <Pressable
                        key={o}
                        onPress={() => toggle(c.label, o)}
                        style={[s.chip, active && s.chipActive]}
                      >
                        <Text style={[s.chipText, active && s.chipTextActive]}>{o}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            );
          })}
        </Card>

        <Card>
          <Text style={s.section}>SIGN-OFF</Text>
          <View style={{ height: 8 }} />
          <LabeledInput
            label="Inspected by"
            iconName="account-check-outline"
            value={inspectedBy}
            onChangeText={setInspectedBy}
            placeholder="Inspector name"
          />
          <View style={{ height: 12 }} />
          <LabeledInput
            label="Remarks"
            iconName="note-text-outline"
            value={remarks}
            onChangeText={setRemarks}
            placeholder="Optional"
            multiline
          />
        </Card>

        <Button label={submitting ? 'Saving…' : 'Save'} onPress={onPressSubmit} loading={submitting} />
      </ScrollView>
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
  itemLabel: { fontFamily: fontFamily.semiBold, fontSize: fontSize.sm, color: COLORS.text, marginBottom: 8 },
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
