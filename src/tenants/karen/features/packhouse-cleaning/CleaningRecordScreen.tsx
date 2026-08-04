import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Screen } from '@/src/core/ui/Screen';
import { Card } from '@/src/core/ui/Card';
import { Button } from '@/src/core/ui/Button';
import { Dropdown } from '@/src/core/ui/Dropdown';
import { LabeledInput } from '@/src/core/ui/LabeledInput';
import { useToast } from '@/src/core/ui/Toast';
import { COLORS, fontFamily, fontSize, spacing } from '@/src/core/theme';
import { useAuthStore } from '@/src/core/auth/store';
import { useKarenPackhouseCleaningStore } from '@/src/tenants/karen/state/karen-packhouse-cleaning-store';
import {
  CLEANING_AREAS,
  CLEANING_MODES,
  DETERGENTS,
  DISINFECTANTS,
  DISINFECTION_EQUIPMENT,
  RATE_UNITS,
} from './constants';

const opts = (arr: string[]) => arr.map((o) => ({ label: o, value: o }));
const num = (v: string) => {
  const n = Number.parseFloat(v);
  return Number.isFinite(n) ? n : undefined;
};

export function KarenPackhouseCleaningScreen() {
  const { showSuccess, showError } = useToast();
  const submitting = useKarenPackhouseCleaningStore((s) => s.submitting);
  const submitCleaning = useKarenPackhouseCleaningStore((s) => s.submitCleaning);
  const fullName = useAuthStore((s) => s.fullName);
  const email = useAuthStore((s) => s.email);

  const [area, setArea] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [mode, setMode] = useState('');
  const [detergent, setDetergent] = useState('');
  const [detRate, setDetRate] = useState('');
  const [detUnit, setDetUnit] = useState('ml/L');
  const [detVol, setDetVol] = useState('');
  const [disinfectant, setDisinfectant] = useState('');
  const [disRate, setDisRate] = useState('');
  const [disUnit, setDisUnit] = useState('ml/L');
  const [disVol, setDisVol] = useState('');
  const [equipment, setEquipment] = useState('');
  const [inspectedBy, setInspectedBy] = useState(fullName || email || '');
  const [remarks, setRemarks] = useState('');

  const onSubmit = async () => {
    if (!area) return showError('Pick an area.');
    const outcome = await submitCleaning({
      date,
      area,
      mode_of_cleaning: mode || undefined,
      detergent_used: detergent || undefined,
      detergent_rate: num(detRate),
      detergent_rate_unit: detUnit || undefined,
      detergent_volume_l: num(detVol),
      disinfectant_used: disinfectant || undefined,
      disinfectant_rate: num(disRate),
      disinfectant_rate_unit: disUnit || undefined,
      disinfectant_volume_l: num(disVol),
      disinfection_equipment: equipment || undefined,
      inspected_by: inspectedBy || undefined,
      remarks: remarks || undefined,
    });
    if (outcome.kind === 'ok') {
      showSuccess(`Saved ${outcome.name}.`);
      setMode('');
      setDetergent('');
      setDetRate('');
      setDetVol('');
      setDisinfectant('');
      setDisRate('');
      setDisVol('');
      setEquipment('');
      setRemarks('');
    } else {
      showError(outcome.message);
    }
  };

  return (
    <Screen title="Packhouse Cleaning" scroll={false}>
      <ScrollView contentContainerStyle={{ paddingBottom: spacing.xxl }} keyboardShouldPersistTaps="handled">
        <Card>
          <Text style={s.section}>WHERE &amp; WHEN</Text>
          <View style={{ height: 8 }} />
          <Dropdown
            label="Area cleaned"
            iconName="map-marker-outline"
            value={area}
            options={opts(CLEANING_AREAS)}
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
          <View style={{ height: 12 }} />
          <Dropdown
            label="Mode of cleaning"
            iconName="broom"
            value={mode}
            options={opts(CLEANING_MODES)}
            placeholder="Pick mode"
            onChange={setMode}
          />
        </Card>

        <Card>
          <Text style={s.section}>DETERGENT</Text>
          <View style={{ height: 8 }} />
          <Dropdown
            label="Detergent used"
            iconName="bottle-tonic-outline"
            value={detergent}
            options={opts(DETERGENTS)}
            placeholder="Pick detergent"
            onChange={setDetergent}
          />
          <View style={{ height: 12 }} />
          <View style={s.row}>
            <View style={{ flex: 1 }}>
              <LabeledInput label="Rate" iconName="speedometer" value={detRate} onChangeText={setDetRate} keyboardType="decimal-pad" placeholder="0" />
            </View>
            <View style={{ width: 12 }} />
            <View style={{ width: 120 }}>
              <Dropdown label="Unit" value={detUnit} options={opts(RATE_UNITS)} searchable={false} onChange={setDetUnit} />
            </View>
          </View>
          <View style={{ height: 12 }} />
          <LabeledInput label="Solution volume (L)" iconName="cup-water" value={detVol} onChangeText={setDetVol} keyboardType="decimal-pad" placeholder="0" />
        </Card>

        <Card>
          <Text style={s.section}>DISINFECTANT</Text>
          <View style={{ height: 8 }} />
          <Dropdown
            label="Disinfectant used"
            iconName="bottle-tonic-plus-outline"
            value={disinfectant}
            options={opts(DISINFECTANTS)}
            placeholder="Pick disinfectant"
            onChange={setDisinfectant}
          />
          <View style={{ height: 12 }} />
          <View style={s.row}>
            <View style={{ flex: 1 }}>
              <LabeledInput label="Rate" iconName="speedometer" value={disRate} onChangeText={setDisRate} keyboardType="decimal-pad" placeholder="0" />
            </View>
            <View style={{ width: 12 }} />
            <View style={{ width: 120 }}>
              <Dropdown label="Unit" value={disUnit} options={opts(RATE_UNITS)} searchable={false} onChange={setDisUnit} />
            </View>
          </View>
          <View style={{ height: 12 }} />
          <LabeledInput label="Solution volume (L)" iconName="cup-water" value={disVol} onChangeText={setDisVol} keyboardType="decimal-pad" placeholder="0" />
          <View style={{ height: 12 }} />
          <Dropdown
            label="Disinfection equipment"
            iconName="spray"
            value={equipment}
            options={opts(DISINFECTION_EQUIPMENT)}
            placeholder="Pick equipment"
            onChange={setEquipment}
          />
        </Card>

        <Card>
          <Text style={s.section}>SIGN-OFF</Text>
          <View style={{ height: 8 }} />
          <LabeledInput label="Inspected by" iconName="account-check-outline" value={inspectedBy} onChangeText={setInspectedBy} placeholder="Inspector name" />
          <View style={{ height: 12 }} />
          <LabeledInput label="Remarks" iconName="note-text-outline" value={remarks} onChangeText={setRemarks} placeholder="Optional" multiline />
        </Card>

        <Button label={submitting ? 'Saving…' : 'Save'} onPress={onSubmit} loading={submitting} />
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
  row: { flexDirection: 'row', alignItems: 'flex-end' },
});
