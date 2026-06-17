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

const SLOTS = [
  { key: 'temp_8am',  label: '8:00 AM'  },
  { key: 'temp_10am', label: '10:00 AM' },
  { key: 'temp_12pm', label: '12 NOON'  },
  { key: 'temp_2pm',  label: '2:00 PM'  },
  { key: 'temp_4pm',  label: '4:00 PM'  },
  { key: 'temp_6pm',  label: '6:00 PM'  },
  { key: 'temp_8pm',  label: '8:00 PM'  },
] as const;

type SlotKey = (typeof SLOTS)[number]['key'];

export function KarenTemperatureLogScreen({ userFarm }: { userFarm: string }) {
  const { showSuccess, showError } = useToast();
  const {
    farms, coldStores, coldStoresLoading, submitting,
    loadFarms, loadColdStores, submitTemperature,
  } = useKarenColdroomStore();

  const [farm, setFarm] = useState(userFarm);
  const [coldstore, setColdstore] = useState('');
  const [logDate, setLogDate] = useState(new Date().toISOString().slice(0, 10));
  const [readings, setReadings] = useState<Record<SlotKey, string>>({
    temp_8am: '', temp_10am: '', temp_12pm: '', temp_2pm: '',
    temp_4pm: '', temp_6pm: '', temp_8pm: '',
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
    if (!coldstore) return showError('Pick a cold store.');
    const payload: Record<string, unknown> = {
      farm, coldstore, log_date: logDate, notes,
    };
    for (const { key } of SLOTS) {
      const v = readings[key];
      if (v && v.trim()) payload[key] = Number(v);
    }
    const outcome = await submitTemperature(payload as never);
    if (outcome.kind === 'ok') {
      showSuccess(`Saved ${outcome.name}.`);
      setReadings({
        temp_8am: '', temp_10am: '', temp_12pm: '', temp_2pm: '',
        temp_4pm: '', temp_6pm: '', temp_8pm: '',
      });
      setNotes('');
    } else {
      showError(outcome.message);
    }
  };

  return (
    <Screen title="Cold Store Temperature" scroll={false}>
      <ScrollView contentContainerStyle={{ paddingBottom: spacing.xxl }} keyboardShouldPersistTaps="handled">
        <Card>
          <Text style={s.section}>COLD STORE</Text>
          <View style={{ height: 8 }} />
          <Dropdown
            label="Farm"
            iconName="home-outline"
            value={farm}
            options={farms.map((f) => ({ label: f, value: f }))}
            placeholder="Pick farm"
            onChange={(v) => setFarm(v)}
          />
          <View style={{ height: 12 }} />
          <Dropdown
            label="Cold store"
            iconName="snowflake"
            value={coldstore}
            options={coldStores.map((c) => ({ label: c, value: c }))}
            placeholder={coldStoresLoading ? 'Loading…' : 'Pick cold store'}
            disabled={coldStoresLoading}
            onChange={(v) => setColdstore(v)}
          />
          <View style={{ height: 12 }} />
          <LabeledInput
            label="Date"
            iconName="calendar-outline"
            value={logDate}
            onChangeText={setLogDate}
            placeholder="YYYY-MM-DD"
            autoCapitalize="none"
          />
        </Card>

        <Card>
          <Text style={s.section}>TEMPERATURE READINGS (°C)</Text>
          <Text style={s.help}>Enter what you measured at each slot. Blank slots are saved as zero.</Text>
          <View style={{ height: 12 }} />
          <View style={s.grid}>
            {SLOTS.map((slot) => (
              <View key={slot.key} style={s.gridCell}>
                <LabeledInput
                  label={slot.label}
                  iconName="thermometer"
                  value={readings[slot.key]}
                  onChangeText={(v) => setReadings((r) => ({ ...r, [slot.key]: v }))}
                  keyboardType="numbers-and-punctuation"
                  placeholder="—"
                />
              </View>
            ))}
          </View>
        </Card>

        <Card>
          <Text style={s.section}>NOTES</Text>
          <View style={{ height: 8 }} />
          <LabeledInput
            label="Notes"
            iconName="note-text-outline"
            value={notes}
            onChangeText={setNotes}
            placeholder="Optional"
            multiline
          />
        </Card>

        <Button label={submitting ? 'Saving…' : 'Save log'} onPress={onSubmit} loading={submitting} />
      </ScrollView>
    </Screen>
  );
}

const s = StyleSheet.create({
  section: { fontFamily: fontFamily.semiBold, fontSize: fontSize.xs, color: COLORS.textMuted, textTransform: 'uppercase', letterSpacing: 0.4 },
  help: { fontSize: 12, color: COLORS.textMuted, marginTop: 4 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  gridCell: { flexBasis: '48%' },
});
