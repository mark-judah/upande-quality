import { useEffect, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '@/src/core/ui/Screen';
import { Card } from '@/src/core/ui/Card';
import { ScanField, type ScanFieldHandle } from '@/src/core/scanning/ScanField';
import { useToast } from '@/src/core/ui/Toast';
import { useKarenBucketReturnReceiptStore } from '@/src/tenants/karen/state/karen-bucket-return-receipt-store';
import { COLORS, fontFamily, fontSize, spacing } from '@/src/core/theme';

export function KarenBucketReturnReceiptScreen({ userFarm }: { userFarm: string }) {
  const scanRef = useRef<ScanFieldHandle>(null);
  const { receiving, received, receiveScan, reset } = useKarenBucketReturnReceiptStore();
  const { showSuccess, showError } = useToast();

  useEffect(() => () => reset(), [reset]);

  const onScan = async (raw: string) => {
    const o = await receiveScan(raw, userFarm);
    if (o.kind === 'success') showSuccess(o.message);
    else showError(o.message);
    scanRef.current?.clear();
    scanRef.current?.focus();
  };

  return (
    <Screen title="Bucket Return — Receipt">
      <Card title="Scan one bucket to receive the batch">
        <ScanField
          ref={scanRef}
          onScan={onScan}
          autoFocus
          placeholder="Scan any bucket from the batch"
          editable={!receiving}
        />
        <Text style={s.muted}>{userFarm} · one scan confirms the whole batch</Text>
      </Card>

      {received.length ? (
        <Card title="Received this session">
          {received.map((r, i) => (
            <View key={`${r.name}-${i}`} style={[s.row, i > 0 && s.rowBorder]}>
              <Ionicons name="checkmark-circle" size={16} color={COLORS.success} />
              <Text style={s.rName}>{r.name}</Text>
              <Text style={s.rCount}>{r.count} buckets</Text>
            </View>
          ))}
        </Card>
      ) : null}
    </Screen>
  );
}

const s = StyleSheet.create({
  muted: { fontSize: 12, color: COLORS.textMuted, marginTop: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm },
  rowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLORS.border },
  rName: { flex: 1, fontFamily: 'monospace', fontSize: fontSize.sm, color: COLORS.text, fontWeight: '700' },
  rCount: { fontFamily: fontFamily.medium, fontSize: fontSize.xs, color: COLORS.textSecondary },
});
