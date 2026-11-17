import { useEffect, useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '@/src/core/ui/Screen';
import { Card } from '@/src/core/ui/Card';
import { Button } from '@/src/core/ui/Button';
import { Dropdown } from '@/src/core/ui/Dropdown';
import { ScanField, type ScanFieldHandle } from '@/src/core/scanning/ScanField';
import { useToast } from '@/src/core/ui/Toast';
import { useKarenBucketReturnDispatchStore } from '@/src/tenants/karen/state/karen-bucket-return-dispatch-store';
import { COLORS, fontSize, spacing } from '@/src/core/theme';

export function KarenBucketReturnDispatchScreen({ userFarm }: { userFarm: string }) {
  const scanRef = useRef<ScanFieldHandle>(null);
  const { farms, vehicles, farm, vehicle, buckets, submitting, loadRefs, setFarm, setVehicle, addScan, remove, submit, reset } =
    useKarenBucketReturnDispatchStore();
  const { showSuccess, showError } = useToast();

  useEffect(() => {
    loadRefs(userFarm);
    return () => reset();
  }, [loadRefs, reset, userFarm]);

  const onScan = (raw: string) => {
    const r = addScan(raw);
    if (!r.ok && r.message) showError(r.message);
    scanRef.current?.clear();
    scanRef.current?.focus();
  };

  const onSubmit = async () => {
    const o = await submit();
    if (o.kind === 'success') {
      showSuccess(o.message);
      scanRef.current?.focus();
    } else {
      showError(o.message);
    }
  };

  return (
    <Screen title="Bucket Return — Dispatch">
      <Card title="Destination">
        <Dropdown label="Farm" value={farm} options={farms} onChange={setFarm} placeholder="Select farm" />
        <View style={{ height: spacing.sm }} />
        <Dropdown label="Truck" value={vehicle} options={vehicles} onChange={setVehicle} placeholder="Select vehicle (optional)" />
      </Card>

      <Card title="Scan buckets to send back">
        <ScanField ref={scanRef} onScan={onScan} autoFocus placeholder="Scan bucket QR" editable={!submitting} />
        <Text style={s.muted}>
          {buckets.length} scanned · {farm ?? 'no farm'}
        </Text>
      </Card>

      {buckets.length ? (
        <Card>
          {buckets.map((b, i) => (
            <View key={b.bucketId} style={[s.row, i > 0 && s.rowBorder]}>
              <Text style={s.bId}>{b.bucketId}</Text>
              <Pressable onPress={() => remove(b.bucketId)} hitSlop={8}>
                <Ionicons name="close-circle" size={20} color={COLORS.textMuted} />
              </Pressable>
            </View>
          ))}
        </Card>
      ) : null}

      <View style={{ height: spacing.md }} />
      <Button
        label={submitting ? 'Dispatching…' : `Dispatch ${buckets.length} bucket${buckets.length === 1 ? '' : 's'}`}
        onPress={onSubmit}
        loading={submitting}
        disabled={!buckets.length || !farm}
      />
    </Screen>
  );
}

const s = StyleSheet.create({
  muted: { fontSize: 12, color: COLORS.textMuted, marginTop: 8 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: spacing.sm },
  rowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLORS.border },
  bId: { fontFamily: 'monospace', fontSize: fontSize.sm, color: COLORS.text, fontWeight: '700' },
});
