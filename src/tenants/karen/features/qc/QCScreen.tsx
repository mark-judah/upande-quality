import { useCallback, useEffect, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Screen } from '@/src/core/ui/Screen';
import { Card } from '@/src/core/ui/Card';
import { ScanField, type ScanFieldHandle } from '@/src/core/scanning/ScanField';
import { focusWhenReady } from '@/src/core/scanning/focus';
import { useToast } from '@/src/core/ui/Toast';
import { COLORS } from '@/src/core/theme';
import { useKarenQcStore } from '@/src/tenants/karen/state/karen-qc-store';
import { InspectionMode } from './InspectionMode';
import { QuarantineMode } from './QuarantineMode';

type Props = {
  userFarm: string;
  userGreenhouse: string;
};

export function KarenQcScreen({ userFarm: _userFarm, userGreenhouse }: Props) {
  const scanRef = useRef<ScanFieldHandle>(null);
  const { showError } = useToast();

  const isQuarantineMode = useKarenQcStore((s) => s.isQuarantineMode);
  const parameters = useKarenQcStore((s) => s.parameters);
  const parametersLoading = useKarenQcStore((s) => s.parametersLoading);
  const loadParameters = useKarenQcStore((s) => s.loadParameters);
  const loadVarieties = useKarenQcStore((s) => s.loadVarieties);
  const setControlPoint = useKarenQcStore((s) => s.setControlPoint);
  const resetAll = useKarenQcStore((s) => s.resetAll);

  useEffect(() => {
    // This screen is always Intake QC — Coldroom / Packhouse will be separate
    // drawer entries once implemented.
    setControlPoint('Intake');
    loadParameters();
    return () => resetAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (userGreenhouse) loadVarieties(userGreenhouse);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userGreenhouse]);

  return (
    <Screen title={isQuarantineMode ? 'Quarantine Review' : 'Intake QC'}>
      <ScanAndBatchSection scanRef={scanRef} onError={showError} />

      {parametersLoading && parameters.length === 0 ? (
        <Card>
          <Text style={s.muted}>Loading quality concerns…</Text>
        </Card>
      ) : isQuarantineMode ? (
        <QuarantineMode />
      ) : (
        <InspectionMode />
      )}
    </Screen>
  );
}

function ScanAndBatchSection({
  scanRef,
  onError,
}: {
  scanRef: React.RefObject<ScanFieldHandle | null>;
  onError: (msg: string) => void;
}) {
  const batch = useKarenQcStore((s) => s.batch);
  const batchLoading = useKarenQcStore((s) => s.batchLoading);
  const isQuarantineMode = useKarenQcStore((s) => s.isQuarantineMode);
  const quarantineRows = useKarenQcStore((s) => s.quarantineRows);
  const loadBatchFromScan = useKarenQcStore((s) => s.loadBatchFromScan);

  // Park the cursor in the scan field on every screen entry, and after
  // every scan attempt — Honeywell operators should never have to tap.
  useFocusEffect(
    useCallback(() => {
      if (!batch) focusWhenReady(scanRef);
    }, [batch, scanRef]),
  );

  const onScan = async (raw: string) => {
    const result = await loadBatchFromScan(raw);
    if (!result.ok) onError(result.message ?? 'Failed to load batch.');
    focusWhenReady(scanRef);
  };

  return (
    <>
      <Card title="Scan Bucket QR">
        <ScanField
          ref={scanRef}
          onScan={onScan}
          autoFocus={!batch}
          placeholder="Scan or type bucket"
          editable={!batchLoading}
        />
        {batchLoading ? <Text style={s.loadingText}>Loading batch…</Text> : null}
      </Card>

      {batch ? (
        <Card>
          <Text style={s.batchTitle}>BATCH {batch.batchNo || '—'}</Text>
          <Text style={s.muted}>
            Farm: {batch.farm || '—'} • {batch.company || '—'}
          </Text>
          <View style={s.chipRow}>
            <View style={s.chip}>
              <Text style={s.chipText}>Buckets: {batch.totalBuckets}</Text>
            </View>
            <View style={s.chip}>
              <Text style={s.chipText}>Stems: {batch.totalStems}</Text>
            </View>
          </View>
          {isQuarantineMode ? (
            <Text style={s.warn}>
              Quarantined: {Object.keys(quarantineRows).length} bucket(s)
            </Text>
          ) : (
            <Text style={s.muted}>
              Active buckets:{' '}
              {batch.buckets.filter((b) => b.status !== 'rejected').length}
            </Text>
          )}
        </Card>
      ) : null}
    </>
  );
}

const s = StyleSheet.create({
  muted: { fontSize: 12, color: COLORS.textMuted, marginTop: 4 },
  loadingText: { fontSize: 12, color: COLORS.textMuted, marginTop: 12, textAlign: 'center' },
  batchTitle: { fontSize: 18, fontWeight: '700', color: COLORS.text },
  chipRow: { flexDirection: 'row', gap: 12, marginTop: 12, justifyContent: 'space-between' },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: COLORS.bgMuted,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  chipText: { fontSize: 13, fontWeight: '600', color: COLORS.text },
  warn: { fontSize: 13, fontWeight: '600', color: COLORS.text, marginTop: 12 },
});
