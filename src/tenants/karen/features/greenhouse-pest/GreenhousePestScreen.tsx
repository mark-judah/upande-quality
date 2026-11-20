import { useEffect, useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Screen } from '@/src/core/ui/Screen';
import { Card } from '@/src/core/ui/Card';
import { Button } from '@/src/core/ui/Button';
import { LabeledInput } from '@/src/core/ui/LabeledInput';
import { SearchSelect } from '@/src/core/ui/SearchSelect';
import { NumericStepper } from '@/src/core/ui/NumericStepper';
import { useToast } from '@/src/core/ui/Toast';
import { COLORS, fontFamily, fontSize, spacing } from '@/src/core/theme';
import { PESTS } from '@/src/tenants/karen/repository/karen-greenhouse-pest-repository';
import { useKarenGreenhousePestStore } from '@/src/tenants/karen/state/karen-greenhouse-pest-store';

/** YYYY-MM-DD <-> DD/MM/YYYY for the date field. */
function isoToDMY(iso: string): string {
  const [y, m, d] = iso.split('-');
  return y && m && d ? `${d}/${m}/${y}` : iso;
}
function dmyToISO(text: string): string {
  const match = text.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return '';
  const [, d, m, y] = match;
  const dd = Number(d), mm = Number(m);
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return '';
  return `${y}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}
/** '' unless a full, valid HH:mm:ss (seconds optional -> :00). */
function normTime(text: string): string {
  const m = text.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return '';
  const hh = Number(m[1]), mm = Number(m[2]), ss = Number(m[3] ?? '0');
  if (hh > 23 || mm > 59 || ss > 59) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(hh)}:${p(mm)}:${p(ss)}`;
}

export function KarenGreenhousePestScreen() {
  const router = useRouter();
  const { showSuccess, showError } = useToast();
  const st = useKarenGreenhousePestStore();

  useEffect(() => {
    if (st.farms.length === 0 && st.supervisors.length === 0 && !st.loading && !st.error) st.load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const bad = st.showErrors ? new Set(st.missing()) : new Set<string>();

  const ghOptions = useMemo(
    () => st.greenhouses.filter((g) => g.farm === st.farm).map((g) => g.name),
    [st.greenhouses, st.farm],
  );

  const onSave = async () => {
    const outcome = await st.submit();
    if (outcome.ok) {
      showSuccess(`Saved ${outcome.name}.`);
      router.back();
    } else {
      showError(outcome.error);
    }
  };

  return (
    <Screen
      title="Greenhouse Pest"
      loading={st.loading && st.farms.length === 0 && st.supervisors.length === 0}
      error={st.farms.length === 0 && st.supervisors.length === 0 ? st.error : null}
      onRetry={st.load}
      footer={
        <View style={s.actions}>
          <Button label="Cancel" variant="outline" onPress={() => router.back()} style={{ flex: 1 }} />
          <Button
            label={st.submitting ? 'Saving…' : 'Save'}
            onPress={onSave}
            loading={st.submitting}
            style={{ flex: 1 }}
          />
        </View>
      }
    >
      <Card>
        <Text style={s.section}>SCOUTING DETAILS</Text>
        <View style={{ height: 10 }} />
        <LabeledInput
          label="Date *"
          iconName="calendar-outline"
          value={isoToDMY(st.date)}
          onChangeText={(t) => st.setDate(dmyToISO(t))}
          placeholder="DD/MM/YYYY"
          keyboardType="numbers-and-punctuation"
        />
        <View style={{ height: 12 }} />
        <LabeledInput
          label="Time *"
          iconName="clock-outline"
          value={st.time}
          onChangeText={(t) => st.setTime(normTime(t))}
          placeholder="HH:mm:ss"
          keyboardType="numbers-and-punctuation"
        />
        <View style={{ height: 12 }} />
        <SearchSelect
          label="Supervisor *"
          iconName="account-outline"
          value={st.supervisor}
          options={st.supervisors}
          placeholder="Search"
          invalid={bad.has('supervisor')}
          onChange={st.setSupervisor}
        />
        <View style={{ height: 12 }} />
        <SearchSelect
          label="Farm *"
          iconName="barn"
          value={st.farm}
          options={st.farms}
          placeholder="Select farm"
          invalid={bad.has('farm')}
          onChange={st.setFarm}
        />
        {st.farm ? (
          <>
            <View style={{ height: 12 }} />
            <SearchSelect
              label="Greenhouse *"
              iconName="greenhouse"
              value={st.greenhouse}
              options={ghOptions}
              placeholder="Search"
              invalid={bad.has('greenhouse')}
              onChange={st.setGreenhouse}
            />
          </>
        ) : null}
      </Card>

      <Card>
        <Text style={s.section}>PEST</Text>
        <View style={{ height: 10 }} />
        <SearchSelect
          label="Pest *"
          iconName="bug-outline"
          value={st.pest}
          options={PESTS}
          placeholder="Select pest"
          invalid={bad.has('pest')}
          onChange={st.setPest}
        />
        <View style={{ height: 14 }} />
        <Text style={s.fieldLabel}>Count *</Text>
        <View style={{ height: 6 }} />
        <NumericStepper value={st.count} onChange={st.setCount} min={1} invalid={bad.has('count')} />
      </Card>
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
  fieldLabel: { fontFamily: fontFamily.medium, fontSize: fontSize.xs, color: COLORS.textSecondary },
  actions: { flexDirection: 'row', gap: spacing.md },
});
