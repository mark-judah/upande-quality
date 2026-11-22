import { useEffect, useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Screen } from '@/src/core/ui/Screen';
import { Card } from '@/src/core/ui/Card';
import { Button } from '@/src/core/ui/Button';
import { LabeledInput } from '@/src/core/ui/LabeledInput';
import { YesNoToggle } from '@/src/core/ui/YesNoToggle';
import { useToast } from '@/src/core/ui/Toast';
import { COLORS, fontFamily, fontSize, spacing } from '@/src/core/theme';
import { useKarenGreenhouseIntegrityStore } from '@/src/tenants/karen/state/karen-greenhouse-integrity-store';
import { SearchSelect } from '@/src/core/ui/SearchSelect';

/** YYYY-MM-DD -> DD/MM/YYYY for display. */
function isoToDMY(iso: string): string {
  const [y, m, d] = iso.split('-');
  return y && m && d ? `${d}/${m}/${y}` : iso;
}
/** DD/MM/YYYY -> YYYY-MM-DD, or '' if not a complete valid date. */
function dmyToISO(text: string): string {
  const match = text.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return '';
  const [, d, m, y] = match;
  const dd = Number(d), mm = Number(m);
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return '';
  return `${y}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}

export function KarenGreenHouseIntegrityScreen() {
  const router = useRouter();
  const { showSuccess, showError } = useToast();
  const st = useKarenGreenhouseIntegrityStore();

  useEffect(() => {
    if (st.farms.length === 0 && !st.loading && !st.error) st.load();
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
      title="New GH Integrity"
      loading={st.loading && st.farms.length === 0}
      error={st.farms.length === 0 ? st.error : null}
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
        <Text style={s.section}>INSPECTION DETAILS</Text>
        <View style={{ height: 10 }} />
        <LabeledInput
          label="Date *"
          iconName="calendar-outline"
          value={isoToDMY(st.date)}
          onChangeText={(t) => st.setDate(dmyToISO(t))}
          placeholder="DD/MM/YYYY"
          keyboardType="numbers-and-punctuation"
          style={bad.has('date') ? s.inputInvalid : undefined}
        />
        <View style={{ height: 12 }} />
        <SearchSelect
          label="Farm *"
          iconName="barn"
          value={st.farm}
          options={st.farms}
          placeholder="Select farm"
          allowAdd
          invalid={bad.has('farm')}
          onChange={st.setFarm}
        />
        {st.farm ? (
          <>
            <View style={{ height: 12 }} />
            <SearchSelect
              label="Greenhouse *"
              iconName="greenhouse"
              value={st.gh}
              options={ghOptions}
              placeholder="Select greenhouse"
              allowAdd
              invalid={bad.has('gh')}
              onChange={st.setGh}
            />
          </>
        ) : null}
      </Card>

      <Card>
        <Text style={s.section}>CHECKLIST</Text>
        <Text style={s.help}>YES if the defect is there. Anything left blank is saved as OK.</Text>
        <View style={{ height: 4 }} />
        {st.items.length === 0 ? (
          <Text style={s.hint}>No checklist items are set up yet (Greenhouse Inspection Item Master).</Text>
        ) : null}
        {st.items.map((c, i) => (
          <View key={c.name} style={[s.item, i > 0 && s.itemDivider]}>
            <Text style={s.itemLabel}>{c.label}</Text>
            <YesNoToggle
              value={st.checks[c.name] ?? null}
              onChange={(v) => st.setCheck(c.name, v)}
            />
          </View>
        ))}
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
  help: { fontSize: 12, color: COLORS.textMuted, marginTop: 4 },
  inputInvalid: { borderColor: COLORS.danger },
  item: { paddingVertical: spacing.sm },
  itemDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLORS.border },
  itemLabel: {
    fontFamily: fontFamily.semiBold,
    fontSize: fontSize.sm,
    color: COLORS.text,
    marginBottom: 8,
  },
  hint: { fontSize: 11, color: COLORS.textMuted, marginTop: 6 },
  actions: { flexDirection: 'row', gap: spacing.md },
});
