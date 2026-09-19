import { useCallback, useEffect, useRef } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Screen } from '@/src/core/ui/Screen';
import { Card, Alert } from '@/src/core/ui/Card';
import { ScanField, type ScanFieldHandle } from '@/src/core/scanning/ScanField';
import { focusWhenReady } from '@/src/core/scanning/focus';
import { useToast } from '@/src/core/ui/Toast';
import {
  useKarenShelfOperationsStore,
  type ShelfOperationsMode,
} from '@/src/tenants/karen/state/karen-shelf-operations-store';
import { COLORS } from '@/src/core/theme';

export function KarenShelfOperationsScreen({ userFarm }: { userFarm: string }) {
  const shelfRef = useRef<ScanFieldHandle>(null);
  const bucketRef = useRef<ScanFieldHandle>(null);
  const {
    mode,
    shelfId,
    reason,
    loading,
    lastTransferOutcome,
    lastOfflineOutcome,
    setMode,
    setShelfFromScan,
    clearShelf,
    setReason,
    submitTransfer,
    submitOfflineRemoval,
    reset,
  } = useKarenShelfOperationsStore();
  const { showSuccess, showError } = useToast();

  useEffect(() => () => reset(), [reset]);

  // Transfer mode: shelf then bucket, mirrors Shelving's focus chain.
  // Offline Removal mode: no shelf step, focus goes straight to the bucket field.
  useFocusEffect(
    useCallback(() => {
      if (mode === 'transfer') {
        focusWhenReady(shelfId ? bucketRef : shelfRef);
      } else if (reason.trim()) {
        focusWhenReady(bucketRef);
      }
    }, [mode, shelfId, reason]),
  );

  useEffect(() => {
    if (mode === 'transfer') {
      focusWhenReady(shelfId ? bucketRef : shelfRef);
    } else if (reason.trim()) {
      focusWhenReady(bucketRef);
    }
  }, [mode, shelfId, reason]);

  const switchMode = (next: ShelfOperationsMode) => {
    setMode(next);
    bucketRef.current?.clear();
    shelfRef.current?.clear();
  };

  const onShelfScan = (raw: string) => {
    const result = setShelfFromScan(raw);
    if (!result.ok) {
      showError(result.message ?? 'Invalid shelf QR.');
      shelfRef.current?.clear();
      focusWhenReady(shelfRef);
    }
  };

  const onBucketScanTransfer = async (raw: string) => {
    const outcome = await submitTransfer(raw);
    if (outcome.kind === 'success') {
      showSuccess(outcome.message);
    } else {
      showError(outcome.message);
    }
    bucketRef.current?.clear();
    focusWhenReady(bucketRef);
  };

  const onBucketScanOfflineRemoval = async (raw: string) => {
    const outcome = await submitOfflineRemoval(raw);
    if (outcome.kind === 'success') {
      showSuccess(outcome.message);
    } else {
      showError(outcome.message);
    }
    bucketRef.current?.clear();
    focusWhenReady(bucketRef);
  };

  return (
    <Screen title="Shelf Operations">
      <View style={s.farmBanner}>
        <Text style={s.farmBannerLabel}>Farm</Text>
        <Text style={s.farmBannerValue}>{userFarm || 'All farms'}</Text>
      </View>

      <View style={s.modeRow}>
        <ModeButton label="Transfer" active={mode === 'transfer'} onPress={() => switchMode('transfer')} />
        <ModeButton
          label="Report Offline Removal"
          active={mode === 'offline-removal'}
          onPress={() => switchMode('offline-removal')}
        />
      </View>

      {mode === 'transfer' ? (
        <>
          <Card title="Destination shelf">
            <ScanField
              ref={shelfRef}
              onScan={onShelfScan}
              autoFocus={!shelfId}
              placeholder="Scan destination shelf QR"
              value={shelfId ?? undefined}
              editable={!loading && !shelfId}
            />
            {shelfId ? (
              <View style={s.shelfStatusRow}>
                <Text style={s.shelfStatusLabel}>Moving bucket(s) to {shelfId}</Text>
                <Pressable onPress={clearShelf} hitSlop={8}>
                  <Text style={s.changeLink}>Change shelf</Text>
                </Pressable>
              </View>
            ) : null}
          </Card>

          <Card title="Bucket to move">
            <ScanField
              ref={bucketRef}
              onScan={onBucketScanTransfer}
              autoFocus={!!shelfId}
              placeholder={shelfId ? 'Scan bucket QR' : 'Scan the destination shelf first'}
              editable={!loading && !!shelfId}
            />
            {loading ? <Text style={s.muted}>Transferring…</Text> : null}
          </Card>

          {lastTransferOutcome ? <TransferOutcomeCard outcome={lastTransferOutcome} /> : null}
        </>
      ) : (
        <>
          <Card title="Reason">
            <TextInput
              style={s.reasonInput}
              placeholder="Why is this bucket being removed? (e.g. damaged, quality hold)"
              placeholderTextColor={COLORS.textMuted}
              value={reason}
              onChangeText={setReason}
              multiline
              editable={!loading}
            />
          </Card>

          <Card title="Bucket to report">
            <ScanField
              ref={bucketRef}
              onScan={onBucketScanOfflineRemoval}
              autoFocus={!!reason.trim()}
              placeholder={reason.trim() ? 'Scan bucket QR' : 'Enter a reason first'}
              editable={!loading && !!reason.trim()}
            />
            {loading ? <Text style={s.muted}>Reporting…</Text> : null}
          </Card>

          {lastOfflineOutcome ? <OfflineOutcomeCard outcome={lastOfflineOutcome} /> : null}
        </>
      )}
    </Screen>
  );
}

function ModeButton({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable style={[s.modeButton, active && s.modeButtonActive]} onPress={onPress}>
      <Text style={[s.modeButtonLabel, active && s.modeButtonLabelActive]}>{label}</Text>
    </Pressable>
  );
}

function TransferOutcomeCard({
  outcome,
}: {
  outcome: NonNullable<ReturnType<typeof useKarenShelfOperationsStore.getState>['lastTransferOutcome']>;
}) {
  if (outcome.kind === 'success') {
    return (
      <Card title="Transferred">
        <Row label="Bucket" value={outcome.bucketId} />
        <Row label="From" value={outcome.fromShelfId || '—'} />
        <Row label="To" value={outcome.toShelfId} />
        {outcome.stems != null ? <Row label="Stems" value={String(outcome.stems)} /> : null}
        {outcome.syncedOpls.length ? (
          <Row label="Pick lists updated" value={outcome.syncedOpls.join(', ')} />
        ) : null}
      </Card>
    );
  }
  return <Alert tone="danger">{outcome.message}</Alert>;
}

function OfflineOutcomeCard({
  outcome,
}: {
  outcome: NonNullable<ReturnType<typeof useKarenShelfOperationsStore.getState>['lastOfflineOutcome']>;
}) {
  if (outcome.kind === 'success') {
    return (
      <Card title="Removal reported">
        <Row label="Bucket" value={outcome.bucketId} />
        {outcome.stems != null ? <Row label="Stems" value={String(outcome.stems)} /> : null}
        {outcome.stockEntry ? <Row label="Stock entry" value={outcome.stockEntry} /> : null}
      </Card>
    );
  }
  if (outcome.kind === 'failure' && outcome.reason === 'bucket_allocated') {
    return (
      <>
        <Alert tone="danger">{outcome.message}</Alert>
        {outcome.payload?.sales_orders?.length ? (
          <Card title="Allocated to">
            {outcome.payload.sales_orders.map((so) => (
              <Row key={so} label="Sales order" value={so} />
            ))}
          </Card>
        ) : null}
      </>
    );
  }
  return <Alert tone="danger">{outcome.message}</Alert>;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.detailRow}>
      <Text style={s.detailLabel}>{label}</Text>
      <Text style={s.detailValue}>{value || '—'}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  farmBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: COLORS.surfaceAlt,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 12,
  },
  farmBannerLabel: {
    fontSize: 12,
    color: COLORS.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    fontWeight: '600',
  },
  farmBannerValue: { fontSize: 15, color: COLORS.text, fontWeight: '700' },
  modeRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  modeButton: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
  },
  modeButtonActive: { backgroundColor: COLORS.text, borderColor: COLORS.text },
  modeButtonLabel: { fontSize: 13, fontWeight: '600', color: COLORS.text },
  modeButtonLabelActive: { color: COLORS.surface },
  shelfStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  shelfStatusLabel: {
    fontSize: 12,
    color: COLORS.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  changeLink: { fontSize: 13, color: COLORS.text, fontWeight: '600' },
  muted: { fontSize: 12, color: COLORS.textMuted, marginTop: 8 },
  reasonInput: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    padding: 10,
    fontSize: 14,
    color: COLORS.text,
    minHeight: 60,
    textAlignVertical: 'top',
  },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  detailLabel: {
    fontSize: 12,
    color: COLORS.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  detailValue: { fontSize: 14, color: COLORS.text, flexShrink: 1, textAlign: 'right' },
});
