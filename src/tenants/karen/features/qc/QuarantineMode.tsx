import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Card } from '@/src/core/ui/Card';
import { Button } from '@/src/core/ui/Button';
import { useToast } from '@/src/core/ui/Toast';
import { COLORS } from '@/src/core/theme';
import {
  useKarenQcStore,
  type QuarantineAction,
} from '@/src/tenants/karen/state/karen-qc-store';

export function QuarantineMode() {
  const batch = useKarenQcStore((s) => s.batch);
  const rows = useKarenQcStore((s) => s.quarantineRows);
  const submitting = useKarenQcStore((s) => s.submitting);
  const setQuarantineRowAction = useKarenQcStore((s) => s.setQuarantineRowAction);
  const setQuarantineRowStems = useKarenQcStore((s) => s.setQuarantineRowStems);
  const submitQuarantine = useKarenQcStore((s) => s.submitQuarantine);
  const resetBatch = useKarenQcStore((s) => s.resetBatch);
  const { showSuccess, showError } = useToast();

  if (!batch) return null;
  const quarantined = batch.buckets.filter((b) => b.isInQuarantine);

  const onSubmit = async () => {
    const outcome = await submitQuarantine();
    if (outcome.kind === 'ok') {
      showSuccess(outcome.message);
      resetBatch();
    } else {
      showError(outcome.message);
    }
  };

  return (
    <>
      <Card style={s.alertCard}>
        <View style={s.alertRow}>
          <MaterialCommunityIcons name="alert" size={28} color={COLORS.text} />
          <View style={{ flex: 1 }}>
            <Text style={s.alertTitle}>QUARANTINE REVIEW</Text>
            <Text style={s.alertBody}>
              {quarantined.length} bucket(s) currently in quarantine. Review and decide to accept
              or reject.
            </Text>
          </View>
        </View>
      </Card>

      <Text style={s.sectionLabel}>QUARANTINED BUCKETS</Text>
      {quarantined.map((b) => {
        const row = rows[b.bucketId] ?? {
          action: 'accept' as QuarantineAction,
          stems: String(b.stems),
        };
        return (
          <Card key={b.bucketId}>
            <View style={s.rowHead}>
              <View style={{ flex: 1 }}>
                <Text style={s.bucketTitle}>{b.bucketId}</Text>
                <Text style={s.bucketSubtitle}>{b.itemName || b.itemCode}</Text>
              </View>
              <View style={s.tag}>
                <MaterialCommunityIcons name="alert-outline" size={12} color={COLORS.text} />
                <Text style={s.tagLabel}>QUARANTINE</Text>
              </View>
            </View>

            <View style={{ height: 16 }} />
            <View style={s.stemsRow}>
              <Text style={s.stemsLabel}>Stems to process:</Text>
              <TextInput
                value={row.stems}
                onChangeText={(t) => setQuarantineRowStems(b.bucketId, t)}
                keyboardType="number-pad"
                textAlign="center"
                style={s.stemsInput}
              />
              <Text style={s.stemsOf}>of {b.stems}</Text>
            </View>

            <View style={{ height: 20 }} />
            <Text style={s.actionLabel}>ACTION</Text>
            <View style={{ height: 8 }} />
            <View style={s.actionRow}>
              <ActionButton
                icon="check-circle"
                label="ACCEPT"
                selected={row.action === 'accept'}
                onPress={() => setQuarantineRowAction(b.bucketId, 'accept')}
              />
              <View style={{ width: 12 }} />
              <ActionButton
                icon="close-circle"
                label="REJECT"
                selected={row.action === 'reject'}
                onPress={() => setQuarantineRowAction(b.bucketId, 'reject')}
              />
            </View>
          </Card>
        );
      })}

      <Button
        label={submitting ? 'Submitting…' : 'SUBMIT QUARANTINE ACTIONS'}
        loading={submitting}
        onPress={onSubmit}
        style={{ height: 56 }}
      />
    </>
  );
}

function ActionButton({
  icon,
  label,
  selected,
  onPress,
}: {
  icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[s.actionButton, selected ? s.actionButtonSelected : null]}
    >
      <MaterialCommunityIcons
        name={icon}
        size={20}
        color={selected ? COLORS.text : COLORS.textMuted}
      />
      <Text style={[s.actionButtonLabel, selected ? s.actionButtonLabelSelected : null]}>
        {label}
      </Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  alertCard: { backgroundColor: COLORS.bgMuted },
  alertRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  alertTitle: { fontSize: 16, fontWeight: '700', color: COLORS.text },
  alertBody: { fontSize: 13, color: COLORS.text, marginTop: 4 },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.textMuted,
    letterSpacing: 0.4,
    marginBottom: 12,
  },
  rowHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  bucketTitle: { fontSize: 18, fontWeight: '700', color: COLORS.text },
  bucketSubtitle: { fontSize: 12, color: COLORS.textMuted, marginTop: 4 },
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: COLORS.bgMuted,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  tagLabel: { fontSize: 11, fontWeight: '700', color: COLORS.text },
  stemsRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  stemsLabel: { fontWeight: '600', fontSize: 14, color: COLORS.text },
  stemsInput: {
    width: 100,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    paddingVertical: 8,
    fontSize: 14,
    color: COLORS.text,
    backgroundColor: COLORS.bg,
  },
  stemsOf: { fontSize: 12, color: COLORS.textMuted },
  actionLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.textMuted,
    letterSpacing: 0.4,
  },
  actionRow: { flexDirection: 'row' },
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: COLORS.border,
    backgroundColor: COLORS.bgMuted,
  },
  actionButtonSelected: { borderColor: COLORS.text, backgroundColor: COLORS.bg },
  actionButtonLabel: { color: COLORS.textMuted, fontWeight: '500' },
  actionButtonLabelSelected: { color: COLORS.text, fontWeight: '700' },
});
