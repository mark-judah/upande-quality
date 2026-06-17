import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Screen } from '@/src/core/ui/Screen';
import { Card } from '@/src/core/ui/Card';
import { Button } from '@/src/core/ui/Button';
import { Dropdown } from '@/src/core/ui/Dropdown';
import { LabeledInput } from '@/src/core/ui/LabeledInput';
import { useToast } from '@/src/core/ui/Toast';
import { COLORS, fontFamily, fontSize, spacing } from '@/src/core/theme';
import { useKarenColdroomStore } from '@/src/tenants/karen/state/karen-coldroom-store';
import type { InspectionPayload } from '@/src/tenants/karen/api/karen-coldroom-api';

// Each area can have MULTIPLE conditions flagged (e.g. a roof that is both
// clean and leaking). `key` is the area base; the API field is `${key}_conditions`.
const CONDITIONS: { key: string; label: string; options: string[] }[] = [
  { key: 'floor',       label: 'Floor',       options: ['Good condition', 'Clean', 'Dirty', 'Needs repair'] },
  { key: 'roof',        label: 'Roof',        options: ['Good condition', 'Clean', 'Dirty', 'Leaking'] },
  { key: 'walls',       label: 'Walls',       options: ['Good condition', 'Clean', 'Dirty', 'Gap'] },
  { key: 'lights',      label: 'Lights',      options: ['Good condition', 'Dim bulb', 'Blown bulb'] },
  { key: 'doors',       label: 'Doors',       options: ['Good condition', 'Not closing', 'Gap'] },
  { key: 'shelves',     label: 'Shelves',     options: ['Good condition', 'Rusty', 'Broken', 'Worn out mesh'] },
  { key: 'drainage',    label: 'Drainage',    options: ['Good condition', 'Blocked'] },
  { key: 'evaporators', label: 'Evaporators', options: ['Good condition', 'Icing', 'Leaking', 'Unusual sound'] },
];

export function KarenInspectionLogScreen({ userFarm }: { userFarm: string }) {
  const { showSuccess, showError } = useToast();
  const {
    farms, coldStores, coldStoresLoading, submitting,
    loadFarms, loadColdStores, submitInspection,
  } = useKarenColdroomStore();

  const [farm, setFarm] = useState(userFarm);
  const [coldstore, setColdstore] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [conditions, setConditions] = useState<Record<string, string[]>>({});
  const [inspectedBy, setInspectedBy] = useState('');

  const toggleCondition = (key: string, opt: string) =>
    setConditions((st) => {
      const cur = st[key] ?? [];
      const next = cur.includes(opt) ? cur.filter((x) => x !== opt) : [...cur, opt];
      return { ...st, [key]: next };
    });
  const [notes, setNotes] = useState('');

  useEffect(() => {
    loadFarms();
    loadColdStores(userFarm);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setColdstore('');
    if (farm) loadColdStores(farm);
  }, [farm, loadColdStores]);

  const onSubmit = async () => {
    if (!farm) return showError('Pick a farm.');
    const payload: Record<string, unknown> = {
      farm, coldstore: coldstore || undefined, inspection_date: date,
      inspected_by: inspectedBy || undefined, notes: notes || undefined,
    };
    CONDITIONS.forEach((c) => {
      const sel = conditions[c.key] ?? [];
      if (sel.length) payload[`${c.key}_conditions`] = sel;
    });
    const outcome = await submitInspection(payload as InspectionPayload);
    if (outcome.kind === 'ok') {
      showSuccess(`Saved ${outcome.name}.`);
      setConditions({});
      setNotes('');
    } else {
      showError(outcome.message);
    }
  };

  return (
    <Screen title="Coldroom Inspection" scroll={false}>
      <ScrollView contentContainerStyle={{ paddingBottom: spacing.xxl }} keyboardShouldPersistTaps="handled">
        <Card>
          <Text style={s.section}>WHERE & WHEN</Text>
          <View style={{ height: 8 }} />
          <Dropdown
            label="Farm" iconName="home-outline" value={farm}
            options={farms.map((f) => ({ label: f, value: f }))}
            placeholder="Pick farm" onChange={(v) => setFarm(v)} />
          <View style={{ height: 12 }} />
          <Dropdown
            label="Cold store" iconName="snowflake" value={coldstore}
            options={coldStores.map((c) => ({ label: c, value: c }))}
            placeholder={coldStoresLoading ? 'Loading…' : 'Pick cold store (optional)'}
            disabled={coldStoresLoading}
            onChange={(v) => setColdstore(v)} />
          <View style={{ height: 12 }} />
          <LabeledInput
            label="Date" iconName="calendar-outline" value={date}
            onChangeText={setDate} placeholder="YYYY-MM-DD" autoCapitalize="none" />
        </Card>

        <Card>
          <Text style={s.section}>CONDITIONS</Text>
          <Text style={s.help}>
            Tap every condition that applies — you can flag more than one per area
            (e.g. a roof that is both clean and leaking). Skip any you didn&apos;t inspect.
          </Text>
          <View style={{ height: 12 }} />
          {CONDITIONS.map((c) => {
            const sel = conditions[c.key] ?? [];
            return (
              <View key={c.key} style={{ marginBottom: spacing.md }}>
                <Text style={s.areaLabel}>{c.label}</Text>
                <View style={s.chipRow}>
                  {c.options.map((o) => {
                    const active = sel.includes(o);
                    return (
                      <Text
                        key={o}
                        onPress={() => toggleCondition(c.key, o)}
                        style={[s.chip, active && s.chipActive]}
                      >
                        {active ? '✓ ' : ''}{o}
                      </Text>
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
            label="Inspected by" iconName="account-check-outline"
            value={inspectedBy} onChangeText={setInspectedBy}
            placeholder="Inspector name" />
          <View style={{ height: 12 }} />
          <LabeledInput
            label="Notes" iconName="note-text-outline"
            value={notes} onChangeText={setNotes}
            placeholder="Optional" multiline />
        </Card>

        <Button label={submitting ? 'Saving…' : 'Save inspection'} onPress={onSubmit} loading={submitting} />
      </ScrollView>
    </Screen>
  );
}

const s = StyleSheet.create({
  section: { fontFamily: fontFamily.semiBold, fontSize: fontSize.xs, color: COLORS.textMuted, textTransform: 'uppercase', letterSpacing: 0.4 },
  help: { fontSize: 12, color: COLORS.textMuted, marginTop: 4 },
  areaLabel: { fontFamily: fontFamily.semiBold, fontSize: fontSize.sm, color: COLORS.text, marginBottom: 6 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingVertical: 7, paddingHorizontal: 12, borderRadius: 16, borderWidth: 1, borderColor: COLORS.border, color: COLORS.text, fontSize: 12, overflow: 'hidden' },
  chipActive: { backgroundColor: COLORS.text, color: '#FFFFFF', borderColor: COLORS.text },
});
