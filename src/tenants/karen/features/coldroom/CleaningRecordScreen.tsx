import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Screen } from '@/src/core/ui/Screen';
import { Card } from '@/src/core/ui/Card';
import { Button } from '@/src/core/ui/Button';
import { Dropdown } from '@/src/core/ui/Dropdown';
import { LabeledInput } from '@/src/core/ui/LabeledInput';
import { useToast } from '@/src/core/ui/Toast';
import { borderRadius, COLORS, fontFamily, fontSize, spacing } from '@/src/core/theme';
import { useKarenColdroomStore } from '@/src/tenants/karen/state/karen-coldroom-store';

const MODES = ['Sweeping', 'Washing'] as const;
const DETERGENTS = ['MPD', 'Aerial', 'Omo'];
const DISINFECTANTS = ['Physan', 'TOG 6', 'Sporekill', 'Sodium Hypochlorite'];
const EQUIPMENT = ['Powered Knapsack', 'Fogging Machine'];

export function KarenCleaningRecordScreen({ userFarm }: { userFarm: string }) {
  const { showSuccess, showError } = useToast();
  const {
    farms, coldStores, coldStoresLoading, submitting,
    loadFarms, loadColdStores, submitCleaning,
  } = useKarenColdroomStore();

  const [farm, setFarm] = useState(userFarm);
  const [coldstore, setColdstore] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [mode, setMode] = useState<(typeof MODES)[number]>('Sweeping');
  const [detergent, setDetergent] = useState('');
  const [detergentRate, setDetergentRate] = useState('');
  const [detergentUnit, setDetergentUnit] = useState<'ml/L' | 'g/L'>('ml/L');
  const [detergentVol, setDetergentVol] = useState('');
  const [disinfectant, setDisinfectant] = useState('');
  const [disinfectantRate, setDisinfectantRate] = useState('');
  const [disinfectantUnit, setDisinfectantUnit] = useState<'ml/L' | 'g/L'>('ml/L');
  const [disinfectantVol, setDisinfectantVol] = useState('');
  const [coldVolume, setColdVolume] = useState('');
  const [stockStems, setStockStems] = useState('');
  const [equipment, setEquipment] = useState('');
  const [disinfectedBy, setDisinfectedBy] = useState('');
  const [supervisedBy, setSupervisedBy] = useState('');
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
    if (!mode) return showError('Pick a cleaning mode.');
    const outcome = await submitCleaning({
      farm, coldstore: coldstore || undefined,
      cleaning_date: date,
      mode_of_cleaning: mode,
      detergent_used: detergent || undefined,
      detergent_rate: detergentRate ? Number(detergentRate) : undefined,
      detergent_rate_unit: detergentUnit,
      detergent_solution_volume_l: detergentVol ? Number(detergentVol) : undefined,
      disinfectant_used: disinfectant || undefined,
      disinfectant_rate: disinfectantRate ? Number(disinfectantRate) : undefined,
      disinfectant_rate_unit: disinfectantUnit,
      disinfectant_solution_volume_l: disinfectantVol ? Number(disinfectantVol) : undefined,
      coldroom_volume_disinfected_m3: coldVolume ? Number(coldVolume) : undefined,
      stock_quantity_stems: stockStems ? Number(stockStems) : undefined,
      equipment_used: equipment || undefined,
      disinfected_by: disinfectedBy || undefined,
      supervised_by: supervisedBy || undefined,
      notes: notes || undefined,
    });
    if (outcome.kind === 'ok') {
      showSuccess(`Saved ${outcome.name}.`);
      // Reset volatile fields; keep farm/coldstore so the next entry is fast.
      setDetergent(''); setDetergentRate(''); setDetergentVol('');
      setDisinfectant(''); setDisinfectantRate(''); setDisinfectantVol('');
      setColdVolume(''); setStockStems(''); setEquipment('');
      setDisinfectedBy(''); setSupervisedBy(''); setNotes('');
    } else {
      showError(outcome.message);
    }
  };

  return (
    <Screen title="Coldroom Cleaning" scroll={false}>
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
          <View style={{ height: 12 }} />
          <Text style={s.subLabel}>Mode of cleaning</Text>
          <View style={s.segmented}>
            {MODES.map((m) => (
              <Pressable key={m} onPress={() => setMode(m)} style={[s.segment, mode === m && s.segmentActive]}>
                <Text style={[s.segmentLabel, mode === m && s.segmentLabelActive]}>{m}</Text>
              </Pressable>
            ))}
          </View>
        </Card>

        <Card>
          <Text style={s.section}>DETERGENT</Text>
          <View style={{ height: 8 }} />
          <Dropdown
            label="Detergent used" iconName="bottle-tonic-outline" value={detergent}
            options={DETERGENTS.map((d) => ({ label: d, value: d }))}
            placeholder="Pick" onChange={(v) => setDetergent(v)} />
          <View style={{ height: 12 }} />
          <View style={s.row}>
            <View style={{ flex: 2 }}>
              <LabeledInput
                label="Rate" iconName="scale-balance"
                value={detergentRate} onChangeText={setDetergentRate}
                keyboardType="decimal-pad" placeholder="0" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.subLabel}>Unit</Text>
              <View style={s.segmented}>
                {(['ml/L', 'g/L'] as const).map((u) => (
                  <Pressable key={u} onPress={() => setDetergentUnit(u)}
                             style={[s.segment, detergentUnit === u && s.segmentActive]}>
                    <Text style={[s.segmentLabel, detergentUnit === u && s.segmentLabelActive]}>{u}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          </View>
          <View style={{ height: 12 }} />
          <LabeledInput
            label="Solution volume (L)" iconName="cup-water"
            value={detergentVol} onChangeText={setDetergentVol}
            keyboardType="decimal-pad" placeholder="0" />
        </Card>

        <Card>
          <Text style={s.section}>DISINFECTANT</Text>
          <View style={{ height: 8 }} />
          <Dropdown
            label="Disinfectant used" iconName="spray-bottle" value={disinfectant}
            options={DISINFECTANTS.map((d) => ({ label: d, value: d }))}
            placeholder="Pick" onChange={(v) => setDisinfectant(v)} />
          <View style={{ height: 12 }} />
          <View style={s.row}>
            <View style={{ flex: 2 }}>
              <LabeledInput
                label="Rate" iconName="scale-balance"
                value={disinfectantRate} onChangeText={setDisinfectantRate}
                keyboardType="decimal-pad" placeholder="0" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.subLabel}>Unit</Text>
              <View style={s.segmented}>
                {(['ml/L', 'g/L'] as const).map((u) => (
                  <Pressable key={u} onPress={() => setDisinfectantUnit(u)}
                             style={[s.segment, disinfectantUnit === u && s.segmentActive]}>
                    <Text style={[s.segmentLabel, disinfectantUnit === u && s.segmentLabelActive]}>{u}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          </View>
          <View style={{ height: 12 }} />
          <LabeledInput
            label="Solution volume (L)" iconName="cup-water"
            value={disinfectantVol} onChangeText={setDisinfectantVol}
            keyboardType="decimal-pad" placeholder="0" />
        </Card>

        <Card>
          <Text style={s.section}>COLD ROOM CONTEXT</Text>
          <View style={{ height: 8 }} />
          <LabeledInput
            label="Volume disinfected (m³)" iconName="cube-outline"
            value={coldVolume} onChangeText={setColdVolume}
            keyboardType="decimal-pad" placeholder="0" />
          <View style={{ height: 12 }} />
          <LabeledInput
            label="Stock at time (stems)" iconName="grass"
            value={stockStems} onChangeText={setStockStems}
            keyboardType="number-pad" placeholder="0" />
          <View style={{ height: 12 }} />
          <Dropdown
            label="Equipment used" iconName="tools" value={equipment}
            options={EQUIPMENT.map((e) => ({ label: e, value: e }))}
            placeholder="Pick" onChange={(v) => setEquipment(v)} />
        </Card>

        <Card>
          <Text style={s.section}>SIGN-OFF</Text>
          <View style={{ height: 8 }} />
          <LabeledInput
            label="Disinfected by" iconName="account-outline"
            value={disinfectedBy} onChangeText={setDisinfectedBy}
            placeholder="Staff name" />
          <View style={{ height: 12 }} />
          <LabeledInput
            label="Supervised by (QC)" iconName="account-check-outline"
            value={supervisedBy} onChangeText={setSupervisedBy}
            placeholder="QC name" />
          <View style={{ height: 12 }} />
          <LabeledInput
            label="Notes" iconName="note-text-outline"
            value={notes} onChangeText={setNotes}
            placeholder="Optional" multiline />
        </Card>

        <Button label={submitting ? 'Saving…' : 'Save cleaning record'} onPress={onSubmit} loading={submitting} />
      </ScrollView>
    </Screen>
  );
}

const s = StyleSheet.create({
  section: { fontFamily: fontFamily.semiBold, fontSize: fontSize.xs, color: COLORS.textMuted, textTransform: 'uppercase', letterSpacing: 0.4 },
  subLabel: { fontFamily: fontFamily.semiBold, fontSize: fontSize.sm, color: COLORS.text, marginBottom: spacing.sm },
  row: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-end' },
  segmented: {
    flexDirection: 'row',
    backgroundColor: COLORS.bg,
    borderRadius: borderRadius.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
    overflow: 'hidden',
  },
  segment: { flex: 1, paddingVertical: 11, alignItems: 'center' },
  segmentActive: { backgroundColor: COLORS.text },
  segmentLabel: { fontFamily: fontFamily.semiBold, fontSize: fontSize.sm, color: COLORS.textMuted },
  segmentLabelActive: { color: '#FFFFFF' },
});
