import { useCallback, useEffect, useRef } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Screen } from '@/src/core/ui/Screen';
import { Card, Alert } from '@/src/core/ui/Card';
import { Dropdown } from '@/src/core/ui/Dropdown';
import { Button } from '@/src/core/ui/Button';
import { ScanField, type ScanFieldHandle } from '@/src/core/scanning/ScanField';
import { focusWhenReady } from '@/src/core/scanning/focus';
import { useToast } from '@/src/core/ui/Toast';
import {
  useKarenShelfOperationsStore,
  type ShelfOperationsMode,
} from '@/src/tenants/karen/state/karen-shelf-operations-store';
import type { StockTakeScanRow } from '@/src/tenants/karen/offline/karen-stock-take-db';
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
    coldStores,
    coldStoresLoading,
    coldstore,
    stockTakeScans,
    stockTakePending,
    stockTakeSyncing,
    stockTakeSyncProgress,
    stockTakeSyncError,
    setMode,
    setShelfFromScan,
    clearShelf,
    setReason,
    submitTransfer,
    submitOfflineRemoval,
    initStockTake,
    loadColdStores,
    setColdstore,
    scanStockTakeBucket,
    syncStockTake,
    reset,
  } = useKarenShelfOperationsStore();
  const { showSuccess, showError } = useToast();

  useEffect(() => () => reset(), [reset]);

  // Transfer mode: shelf then bucket, mirrors Shelving's focus chain.
  // Offline Removal mode: no shelf step, focus goes straight to the bucket field.
  // Stock Take mode: no shelf step either - focus goes to the bucket field once
  // a cold store is picked.
  useFocusEffect(
    useCallback(() => {
      if (mode === 'transfer') {
        focusWhenReady(shelfId ? bucketRef : shelfRef);
      } else if (mode === 'stock-take' && coldstore) {
        focusWhenReady(bucketRef);
      }
    }, [mode, shelfId, coldstore]),
  );

  useEffect(() => {
    if (mode === 'transfer') {
      focusWhenReady(shelfId ? bucketRef : shelfRef);
    } else if (mode === 'stock-take' && coldstore) {
      focusWhenReady(bucketRef);
    }
  }, [mode, shelfId, coldstore]);

  useEffect(() => {
    if (mode === 'stock-take') {
      initStockTake();
      loadColdStores(userFarm);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

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

  // No success toast per scan, deliberately - this needs to stay fast
  // through thousands of scans, and the running list below is already the
  // per-scan feedback. Only a bad scan (no cold store yet, invalid QR)
  // interrupts with a toast.
  const onBucketScanStockTake = async (raw: string) => {
    const result = await scanStockTakeBucket(raw);
    if (!result.ok) {
      showError(result.message ?? 'Invalid bucket QR.');
    }
    bucketRef.current?.clear();
    focusWhenReady(bucketRef);
  };

  const onSyncStockTake = async () => {
    await syncStockTake(userFarm);
    const err = useKarenShelfOperationsStore.getState().stockTakeSyncError;
    if (err) showError(err);
    else showSuccess('Synced.');
  };

  return (
    <Screen title="Shelf Operations" scroll={mode !== 'stock-take'}>
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
        <ModeButton label="Stock Take" active={mode === 'stock-take'} onPress={() => switchMode('stock-take')} />
      </View>

      {mode === 'stock-take' ? (
        <View style={s.flexCol}>
          {/* These controls live OUTSIDE the FlatList (unlike an earlier
           *  version that put them in ListHeaderComponent) because
           *  removeClippedSubviews below can detach and recreate the native
           *  TextInput view as the list scrolls/re-renders - a hardware
           *  (Honeywell-style HID) scanner's keystrokes land on whatever
           *  native view currently holds focus, and a detach/reattach drops
           *  that without necessarily changing what's visually focused. The
           *  camera path never depended on continuous native focus, so it
           *  kept working while hardware scanning silently stopped. Mirrors
           *  how Transfer/Offline Removal keep their ScanField outside any
           *  virtualised list. */}
          <Card title="Cold store">
            <Dropdown
              label="Cold store"
              iconName="snowflake"
              value={coldstore ?? ''}
              options={coldStores.map((c) => ({ label: c, value: c }))}
              placeholder={coldStoresLoading ? 'Loading…' : 'Pick cold store'}
              disabled={coldStoresLoading}
              onChange={(v) => setColdstore(v)}
            />
          </Card>

          <Card title="Bucket">
            <ScanField
              ref={bucketRef}
              onScan={onBucketScanStockTake}
              autoFocus={!!coldstore}
              placeholder={coldstore ? 'Scan bucket QR' : 'Pick the cold store first'}
              editable={!!coldstore}
            />
          </Card>

          {coldstore ? (
            <Card title="Sync">
              <View style={s.syncRow}>
                <Text style={s.syncCount}>
                  {stockTakePending} bucket{stockTakePending === 1 ? '' : 's'} not yet synced
                </Text>
                <Button
                  label={stockTakeSyncing ? 'Syncing…' : stockTakeSyncError ? 'Retry sync' : 'Sync'}
                  onPress={onSyncStockTake}
                  loading={stockTakeSyncing}
                  disabled={stockTakeSyncing || stockTakePending === 0}
                />
              </View>
              {stockTakeSyncProgress ? (
                <Text style={s.muted}>
                  Syncing {stockTakeSyncProgress.done} of {stockTakeSyncProgress.total}…
                </Text>
              ) : null}
              {stockTakeSyncError ? <Alert tone="danger">{stockTakeSyncError}</Alert> : null}
            </Card>
          ) : null}

          <FlatList<StockTakeScanRow>
            style={s.flex}
            data={stockTakeScans}
            keyExtractor={(row) => String(row.id)}
            renderItem={({ item }) => <StockTakeScanRowView row={item} />}
            initialNumToRender={20}
            windowSize={7}
            removeClippedSubviews
            keyboardShouldPersistTaps="handled"
            ListHeaderComponent={
              stockTakeScans.length ? <Text style={s.logHeader}>Scanned ({stockTakeScans.length})</Text> : null
            }
          />
        </View>
      ) : mode === 'transfer' ? (
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
              onBlur={() => {
                if (reason.trim()) focusWhenReady(bucketRef);
              }}
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

function StockTakeScanRowView({ row }: { row: StockTakeScanRow }) {
  if (!row.synced) {
    return (
      <View style={s.stockTakeRow}>
        <Text style={s.stockTakeBucketId}>{row.bucketId}</Text>
        <Text style={[s.stockTakeStatus, { color: COLORS.textMuted }]}>Pending sync</Text>
      </View>
    );
  }
  if (row.syncError) {
    return (
      <View style={s.stockTakeRow}>
        <Text style={s.stockTakeBucketId}>{row.bucketId}</Text>
        <Text style={[s.stockTakeStatus, { color: COLORS.danger }]}>{row.syncError}</Text>
      </View>
    );
  }
  const statusColor = row.serverStatus === 'Shelved' ? COLORS.success : COLORS.warn;
  const detail = [row.serverVariety, row.serverStemLength].filter(Boolean).join(' · ');
  return (
    <View style={s.stockTakeRow}>
      <View style={s.stockTakeHeaderRow}>
        <Text style={s.stockTakeBucketId}>{row.bucketId}</Text>
        <Text style={[s.stockTakeStatus, { color: statusColor }]}>
          {row.serverStatus === 'Shelved' ? `Shelved — ${row.serverShelf}` : 'Unshelved'}
        </Text>
      </View>
      <View style={s.stockTakeHeaderRow}>
        <Text style={s.stockTakeDetail}>{detail || '—'}</Text>
        {row.serverAgeDays != null ? <Text style={s.stockTakeDetail}>{row.serverAgeDays}d old</Text> : null}
      </View>
    </View>
  );
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
  flex: { flex: 1 },
  flexCol: { flex: 1, flexDirection: 'column' },
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
  stockTakeRow: {
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  stockTakeHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  stockTakeBucketId: { fontSize: 14, fontWeight: '700', color: COLORS.text },
  stockTakeStatus: { fontSize: 13, fontWeight: '600', flexShrink: 1, textAlign: 'right' },
  stockTakeDetail: { fontSize: 12, color: COLORS.textMuted, marginTop: 2 },
  syncRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  syncCount: { fontSize: 13, color: COLORS.text, flexShrink: 1 },
  logHeader: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginTop: 16,
    marginBottom: 4,
  },
});
