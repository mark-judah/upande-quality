import { useCallback, useEffect, useMemo, useRef } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Screen } from '@/src/core/ui/Screen';
import { Card, Alert } from '@/src/core/ui/Card';
import { Dropdown } from '@/src/core/ui/Dropdown';
import { BottomSheet } from '@/src/core/ui/Dialog';
import { Button } from '@/src/core/ui/Button';
import { ScanField, type ScanFieldHandle } from '@/src/core/scanning/ScanField';
import { focusWhenReady } from '@/src/core/scanning/focus';
import { useToast } from '@/src/core/ui/Toast';
import {
  localDay,
  useKarenShelfOperationsStore,
  type ShelfOperationsMode,
} from '@/src/tenants/karen/state/karen-shelf-operations-store';
import type { StockTakeScanRow } from '@/src/tenants/karen/offline/karen-stock-take-db';
import { COLORS } from '@/src/core/theme';

/** Group / filter label for an OPL allocated without a packing team. */
const NO_TEAM = 'No team';

/** `only` turns one tab into a page of its own (the sidebar's Issue Offline):
 *  its title, no tab switcher. Without it, the Shelf Operations page with all
 *  three tabs. */
export function KarenShelfOperationsScreen({
  userFarm,
  only,
}: {
  userFarm: string;
  only?: ShelfOperationsMode;
}) {
  const shelfRef = useRef<ScanFieldHandle>(null);
  const bucketRef = useRef<ScanFieldHandle>(null);
  const {
    mode: storeMode,
    shelfId,
    loading,
    lastTransferOutcome,
    opls,
    oplsLoading,
    oplDeliveryDate,
    oplTeam,
    opl,
    offlineBuckets,
    offlineBucketsLoading,
    allocatedBucket,
    reason,
    correctVariety,
    correctStemLength,
    varieties,
    stemLengths,
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
    submitTransfer,
    loadOpls,
    setOplDeliveryDate,
    setOplTeam,
    selectOpl,
    selectAllocatedBucket,
    setReason,
    setCorrectVariety,
    setCorrectStemLength,
    submitIssueOffline,
    initStockTake,
    loadColdStores,
    setColdstore,
    scanStockTakeBucket,
    syncStockTake,
    reset,
  } = useKarenShelfOperationsStore();
  const { showSuccess, showError } = useToast();

  // Issue Offline: the date's OPLs, grouped by packing team (no team last), and the
  // teams to filter by.
  const oplTeams = useMemo(
    () => [...new Set(opls.map((o) => o.team || NO_TEAM))].sort((a, b) => (a === NO_TEAM ? 1 : b === NO_TEAM ? -1 : a.localeCompare(b))),
    [opls],
  );
  const pickedBucket = offlineBuckets.find((b) => b.bucket === allocatedBucket) ?? null;
  const shownOpls = useMemo(
    () =>
      opls
        .filter((o) => !oplTeam || (o.team || NO_TEAM) === oplTeam)
        .sort((a, b) => oplTeams.indexOf(a.team || NO_TEAM) - oplTeams.indexOf(b.team || NO_TEAM)),
    [opls, oplTeam, oplTeams],
  );

  // The single-tab page renders its own tab from the first frame; going by the
  // shared store alone, it flashed the Shelf Operations (Transfer) page until
  // the store caught up.
  const mode = only ?? storeMode;

  useEffect(() => () => reset(), [reset]);

  // The two pages stay mounted and share one store: the single-tab page takes
  // the store over while it is on screen and hands it back on Transfer when
  // left, so Shelf Operations never opens on a tab it has no button for.
  useFocusEffect(
    useCallback(() => {
      if (!only) return;
      const st = useKarenShelfOperationsStore.getState();
      if (st.mode !== only) setMode(only);
      // Fresh OPLs on every visit (the page stays mounted between visits).
      if (only === 'issue-offline') {
        if (st.oplDeliveryDate !== localDay(1)) setOplDeliveryDate(localDay(1));
        else loadOpls();
      }
      return () => setMode('transfer');
    }, [only, setMode, setOplDeliveryDate, loadOpls]),
  );

  // Transfer mode: shelf then bucket, mirrors Shelving's focus chain.
  // Issue Offline mode: OPL, allocated bucket and reason first, then the scan.
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
    if (only) return; // the single-tab page loads on focus, above
    if (mode === 'stock-take') {
      initStockTake();
      loadColdStores(userFarm);
    } else if (mode === 'issue-offline') {
      // Issuing works on tomorrow's deliveries only: a date left from yesterday
      // moves on to the new tomorrow (which loads its OPLs).
      if (oplDeliveryDate !== localDay(1)) setOplDeliveryDate(localDay(1));
      else loadOpls();
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

  const onBucketScanIssueOffline = async (raw: string) => {
    const outcome = await submitIssueOffline(raw);
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
    <Screen title={only === 'issue-offline' ? 'Issue Offline' : 'Shelf Operations'} scroll={mode !== 'stock-take'}>
      <View style={s.farmBanner}>
        <View style={s.farmBannerFarm}>
          <MaterialCommunityIcons name="map-marker" size={18} color={COLORS.textMuted} />
          <Text style={s.farmBannerValue} numberOfLines={1}>
            {userFarm || 'All farms'}
          </Text>
        </View>
        {mode === 'issue-offline' ? (
          <View style={s.teamSelect}>
            <Dropdown
              compact
              label="Team"
              iconName="account-group-outline"
              value={oplTeam}
              options={[
                { label: `All teams (${opls.length})`, value: '' },
                ...oplTeams.map((t) => ({
                  label: `${t} (${opls.filter((o) => (o.team || NO_TEAM) === t).length})`,
                  value: t,
                })),
              ]}
              searchable={false}
              disabled={oplsLoading}
              onChange={setOplTeam}
            />
          </View>
        ) : null}
      </View>

      {only ? null : (
        <View style={s.modeRow}>
          <ModeButton label="Transfer" active={mode === 'transfer'} onPress={() => switchMode('transfer')} />
          <ModeButton
            label="Issue Offline"
            active={mode === 'issue-offline'}
            onPress={() => switchMode('issue-offline')}
          />
          <ModeButton label="Stock Take" active={mode === 'stock-take'} onPress={() => switchMode('stock-take')} />
        </View>
      )}

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
          <Card title="Order pick list">
            <Text style={s.filterLabel}>Delivery date</Text>
            <View style={s.modeRow}>
              <ModeButton
                label="Tomorrow"
                active={oplDeliveryDate === localDay(1)}
                onPress={() => setOplDeliveryDate(localDay(1))}
              />
            </View>
            <Dropdown
              label="OPL"
              iconName="clipboard-list-outline"
              value={opl ?? ''}
              options={shownOpls.map((o) => ({
                label: `${o.team || NO_TEAM} · ${o.orderName} · ${o.issuedPct}% issued`,
                value: o.oplName,
                sublabel: [o.oplName, o.customer, o.deliveryDate].filter(Boolean).join(' · '),
              }))}
              placeholder={
                oplsLoading
                  ? 'Loading…'
                  : shownOpls.length
                    ? 'Pick the OPL'
                    : 'No OPL delivering tomorrow has buckets left to issue'
              }
              disabled={oplsLoading || loading}
              onChange={(v) => selectOpl(v)}
            />
          </Card>

          {opl ? (
            <Card title="Allocated bucket that was not issued">
              {offlineBucketsLoading ? (
                <Text style={s.muted}>Loading buckets…</Text>
              ) : offlineBuckets.length === 0 ? (
                <Text style={s.muted}>Every bucket on this OPL is issued.</Text>
              ) : (
                offlineBuckets.map((b) => {
                  const picked = allocatedBucket === b.bucket;
                  return (
                    <Pressable
                      key={b.bucket}
                      style={[s.pickRow, picked && s.pickRowActive]}
                      onPress={() => selectAllocatedBucket(picked ? null : b.bucket)}
                      disabled={loading}
                    >
                      <View style={s.flex}>
                        <Text style={s.pickTitle}>{b.bucket}</Text>
                        <Text style={s.pickDetail}>
                          {[b.variety, b.stemLength, `${b.stems} stems`, b.shelf ?? 'not on a shelf']
                            .filter(Boolean)
                            .join(' · ')}
                        </Text>
                      </View>
                      <Text style={[s.pickMark, picked && s.pickMarkActive]}>{picked ? '●' : '○'}</Text>
                    </Pressable>
                  );
                })
              )}
            </Card>
          ) : null}

          {lastOfflineOutcome?.kind === 'success' ? <OfflineOutcomeCard outcome={lastOfflineOutcome} /> : null}

          {/* Picking a bucket slides this up: the reason, the record fix and the
           *  scan all happen here, no scrolling to the end of the page. Issuing
           *  clears the picked bucket, which closes it. */}
          <BottomSheet
            visible={!!allocatedBucket}
            onClose={() => selectAllocatedBucket(null)}
            busy={loading}
            title="Why was it not issued?"
            subtitle={pickedBucket ? [pickedBucket.bucket, pickedBucket.variety, pickedBucket.stemLength, `${pickedBucket.stems} stems`].filter(Boolean).join(' · ') : undefined}
          >
            <View style={[s.modeRow, s.noMargin]}>
              <ModeButton label="Not found" active={reason === 'not_found'} onPress={() => setReason('not_found')} />
              <ModeButton
                label="Wrong variety"
                active={reason === 'wrong_variety'}
                onPress={() => setReason('wrong_variety')}
              />
            </View>
            {reason === 'wrong_variety' ? (
              <View>
                <Text style={[s.muted, s.noTopMargin]}>
                  {allocatedBucket} stays in the cold store. Enter what it really holds so its record is corrected.
                </Text>
                <View style={{ height: 8 }} />
                <Dropdown
                  label="Real variety"
                  iconName="flower-outline"
                  value={correctVariety}
                  options={varieties.map((v) => ({ label: v, value: v }))}
                  placeholder={varieties.length ? 'Pick the variety' : 'Loading…'}
                  disabled={loading}
                  onChange={setCorrectVariety}
                />
                <Dropdown
                  label="Real stem length"
                  iconName="ruler"
                  value={correctStemLength}
                  options={[
                    { label: 'Same as recorded', value: '' },
                    ...stemLengths.map((l) => ({ label: l, value: l })),
                  ]}
                  placeholder={stemLengths.length ? 'Pick the stem length, if it differs' : 'Loading…'}
                  disabled={loading}
                  onChange={setCorrectStemLength}
                />
              </View>
            ) : null}
            {reason ? (
              <View>
                <Text style={s.sheetLabel}>Bucket that went out</Text>
                <ScanField
                  ref={bucketRef}
                  onScan={onBucketScanIssueOffline}
                  autoFocus
                  placeholder={
                    reason === 'not_found'
                      ? `Scan the bucket issued instead of ${allocatedBucket} (or ${allocatedBucket} itself if found)`
                      : `Scan the bucket issued instead of ${allocatedBucket}`
                  }
                  editable={!loading}
                />
                {loading ? <Text style={s.muted}>Issuing…</Text> : null}
              </View>
            ) : (
              <Text style={[s.muted, s.noTopMargin]}>Pick a reason, then scan the bucket that went out.</Text>
            )}
            {lastOfflineOutcome?.kind === 'failure' ? <OfflineOutcomeCard outcome={lastOfflineOutcome} /> : null}
          </BottomSheet>
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
      <Card title="Issued offline">
        <Row label="Issued" value={outcome.issuedBucket} />
        {outcome.replacement ? <Row label="Replacement record" value={outcome.replacement} /> : null}
        {outcome.correction && !outcome.correction.ok ? (
          <Alert tone="danger">{outcome.correction.message || 'The bucket record could not be corrected.'}</Alert>
        ) : null}
        <Text style={s.muted}>{outcome.message}</Text>
      </Card>
    );
  }
  return (
    <>
      <Alert tone="danger">{outcome.message}</Alert>
      {outcome.candidates.length ? (
        <Card title="Buckets that could go out instead">
          {outcome.candidates.map((c) => (
            <Row
              key={c.bucket}
              label={c.bucket}
              value={[c.stemLength, c.stems != null ? `${c.stems} stems` : null, c.shelf].filter(Boolean).join(' · ')}
            />
          ))}
        </Card>
      ) : null}
    </>
  );
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
  farmBannerFarm: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
  farmBannerValue: { fontSize: 15, color: COLORS.text, fontWeight: '700', flexShrink: 1 },
  teamSelect: { width: 170, marginLeft: 12 },
  modeRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  noMargin: { marginBottom: 0 },
  noTopMargin: { marginTop: 0 },
  sheetLabel: { fontSize: 13, fontWeight: '600', color: COLORS.text, marginBottom: 6 },
  filterLabel: { fontSize: 12, color: COLORS.textMuted, marginBottom: 6 },
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
  pickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: 6,
  },
  pickRowActive: { borderColor: COLORS.text, backgroundColor: COLORS.surfaceAlt },
  pickTitle: { fontSize: 14, fontWeight: '700', color: COLORS.text },
  pickDetail: { fontSize: 12, color: COLORS.textMuted, marginTop: 2 },
  pickMark: { fontSize: 16, color: COLORS.textMuted },
  pickMarkActive: { color: COLORS.text },
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
