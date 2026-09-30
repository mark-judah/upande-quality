import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Screen } from '@/src/core/ui/Screen';
import { Card } from '@/src/core/ui/Card';
import { Button } from '@/src/core/ui/Button';
import { Dropdown } from '@/src/core/ui/Dropdown';
import { LabeledInput } from '@/src/core/ui/LabeledInput';
import { useToast } from '@/src/core/ui/Toast';
import { COLORS, fontFamily, fontSize } from '@/src/core/theme';
import { useKarenBucketCleaningStore } from '@/src/tenants/karen/state/karen-bucket-cleaning-store';

export function KarenBucketCleaningScreen() {
  const { showSuccess, showError } = useToast();
  const st = useKarenBucketCleaningStore();

  useEffect(() => {
    if (st.detergents.length === 0 && !st.loading && !st.error) st.load();
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

  return (
    <Screen
      title="Bucket Cleaning"
      loading={st.loading && st.detergents.length === 0 && st.disinfectants.length === 0}
      error={st.detergents.length === 0 && st.disinfectants.length === 0 ? st.error : null}
      onRetry={st.load}
    >
      <Card>
        <Text style={s.section}>RUN</Text>
        <View style={{ height: 8 }} />
        <LabeledInput
          label="Buckets cleaned"
          iconName="bucket-outline"
          value={st.buckets}
          onChangeText={(t) => st.setField('buckets', t)}
          keyboardType="number-pad"
          placeholder="0"
        />
      </Card>

      <Card>
        <Text style={s.section}>DETERGENT</Text>
        <View style={{ height: 8 }} />
        <Dropdown
          label="Detergent used"
          iconName="bottle-tonic-outline"
          value={st.detergent}
          options={st.detergents}
          placeholder="Pick detergent"
          onChange={(v) => st.setField('detergent', v)}
        />
        <View style={{ height: 12 }} />
        <View style={s.row}>
          <View style={{ flex: 1 }}>
            <LabeledInput
              label="Qty used"
              iconName="scale-balance"
              value={st.detergentQty}
              onChangeText={(t) => st.setField('detergentQty', t)}
              keyboardType="decimal-pad"
              placeholder="0"
            />
          </View>
          <View style={{ width: 12 }} />
          <View style={{ flex: 1 }}>
            <LabeledInput
              label="Solution volume"
              iconName="cup-water"
              value={st.detergentVolume}
              onChangeText={(t) => st.setField('detergentVolume', t)}
              keyboardType="decimal-pad"
              placeholder="0"
            />
          </View>
        </View>
      </Card>

      <Card>
        <Text style={s.section}>DISINFECTANT</Text>
        <View style={{ height: 8 }} />
        <Dropdown
          label="Disinfectant used"
          iconName="bottle-tonic-plus-outline"
          value={st.disinfectant}
          options={st.disinfectants}
          placeholder="Pick disinfectant"
          onChange={(v) => st.setField('disinfectant', v)}
        />
        <View style={{ height: 12 }} />
        <View style={s.row}>
          <View style={{ flex: 1 }}>
            <LabeledInput
              label="Qty used"
              iconName="scale-balance"
              value={st.disinfectantQty}
              onChangeText={(t) => st.setField('disinfectantQty', t)}
              keyboardType="decimal-pad"
              placeholder="0"
            />
          </View>
          <View style={{ width: 12 }} />
          <View style={{ flex: 1 }}>
            <LabeledInput
              label="Solution volume"
              iconName="cup-water"
              value={st.disinfectantVolume}
              onChangeText={(t) => st.setField('disinfectantVolume', t)}
              keyboardType="decimal-pad"
              placeholder="0"
            />
          </View>
        </View>
      </Card>

      <Card>
        <Text style={s.section}>REMARKS</Text>
        <View style={{ height: 8 }} />
        <LabeledInput
          label=""
          value={st.remarks}
          onChangeText={(t) => st.setField('remarks', t)}
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
  row: { flexDirection: 'row', alignItems: 'flex-end' },
});
