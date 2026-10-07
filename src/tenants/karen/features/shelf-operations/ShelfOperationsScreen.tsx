import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Screen } from '@/src/core/ui/Screen';
import { Card, Alert } from '@/src/core/ui/Card';
import { Dropdown } from '@/src/core/ui/Dropdown';
import { BottomSheet } from '@/src/core/ui/Dialog';
import { Button } from '@/src/core/ui/Button';
import { ScanField, type ScanFieldHandle } from '@/src/core/scanning/ScanField';
import { InlineCamera } from '@/src/core/scanning/InlineCamera';
import { mapAxiosError } from '@/src/core/api/client';
import {
  karenShelfOperationsRepository,
  type IssuedBucket,
} from '@/src/tenants/karen/repository/karen-shelf-operations-repository';
import { focusWhenReady } from '@/src/core/scanning/focus';
import { useToast } from '@/src/core/ui/Toast';
import {
  localDay,
  useKarenShelfOperationsStore,
  type ShelfOperationsMode,
} from '@/src/tenants/karen/state/karen-shelf-operations-store';
import type { StockTakeScanRow } from '@/src/tenants/karen/offline/karen-stock-take-db';
import { COLORS, fontFamily, scaleFont } from '@/src/core/theme';
import { Skeleton } from '@/src/core/ui/Skeleton';

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
  // Shelf Operations' Issue Offline without an OPL: a reason, then the bucket.
  const openRef = useRef<ScanFieldHandle>(null);
  const [openReason, setOpenReason] = useState('');
  const [openBusy, setOpenBusy] = useState(false);
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
    substitutes,
    substitutesLoading,
    chosenSubstitute,
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
    handOver,
    setShelfFromScan,
    clearShelf,
    submitTransfer,
    loadOpls,
    setOplFarm,
    setOplDeliveryDate,
    setOplTeam,
    selectOpl,
    selectAllocatedBucket,
    chooseSubstitute,
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
  const pickedOpl = opls.find((o) => o.oplName === opl) ?? null;
  // The buckets already issued to the picked OPL's line (the "bkt" button).
  const [issued, setIssued] = useState<{ opl: string; loading: boolean; buckets: IssuedBucket[]; error?: string } | null>(
    null,
  );
  const openIssued = async (oplName: string) => {
    setIssued({ opl: oplName, loading: true, buckets: [] });
    try {
      const buckets = await karenShelfOperationsRepository.fetchIssuedBuckets(oplName);
      setIssued((cur) => (cur?.opl === oplName ? { opl: oplName, loading: false, buckets } : cur));
    } catch (err) {
      setIssued((cur) =>
        cur?.opl === oplName ? { opl: oplName, loading: false, buckets: [], error: mapAxiosError(err).message } : cur,
      );
    }
  };
  // Issue Offline: the camera above the "Issue this bucket" sheet (not its own screen).
  const [camOpen, setCamOpen] = useState(false);
  if (camOpen && !allocatedBucket) setCamOpen(false);
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
      if (st.mode !== only) handOver(only);
      // Fresh OPLs on every visit (the page stays mounted between visits).
      if (only === 'issue-offline') {
        setOplFarm(userFarm);
        if (st.oplDeliveryDate !== localDay(1)) setOplDeliveryDate(localDay(1));
        else loadOpls();
      }
      return () => handOver('transfer');
    }, [only, userFarm, handOver, setOplFarm, setOplDeliveryDate, loadOpls]),
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
    }
    // Shelf Operations' Issue Offline needs no OPL: a reason and the bucket.
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

  const onBucketScanWithoutOpl = async (raw: string) => {
    const bucket = karenShelfOperationsRepository.extractBucketIdFromScan(raw);
    if (!bucket) {
      showError('Please scan a valid bucket QR code.');
    } else {
      setOpenBusy(true);
      try {
        const out = await karenShelfOperationsRepository.issueWithoutOpl(bucket, openReason.trim());
        if (out.ok) showSuccess(out.message);
        else showError(out.message);
      } catch (err) {
        showError(mapAxiosError(err).message);
      } finally {
        setOpenBusy(false);
      }
    }
    openRef.current?.clear();
    focusWhenReady(openRef);
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
        {mode === 'issue-offline' && only ? (
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
              stockTakeScans.length ? (
                <Text style={s.logHeader}>
                  Scanned ({stockTakeScans.length}) · {stockTakeStems(stockTakeScans)} stems
                </Text>
              ) : null
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
                <Text style={s.shelfStatusLabel} numberOfLines={2}>
                  Moving bucket(s) to {shelfId}
                </Text>
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
      ) : !only ? (
        // Shelf Operations' Issue Offline: no OPL -- the bucket just comes off its shelf.
        <Card title="Issue offline">
          <TextInput
            style={s.reasonInput}
            placeholder="Reason"
            placeholderTextColor={COLORS.textMuted}
            value={openReason}
            onChangeText={setOpenReason}
            onBlur={() => {
              if (openReason.trim()) focusWhenReady(openRef);
            }}
            multiline
            editable={!openBusy}
          />
          <ScanField
            ref={openRef}
            onScan={onBucketScanWithoutOpl}
            placeholder={openReason.trim() ? 'Scan bucket QR' : 'Enter a reason first'}
            editable={!openBusy && !!openReason.trim()}
          />
          {openBusy ? <Text style={s.muted}>Issuing…</Text> : null}
        </Card>
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
                // Row 1: varieties (what the OPL holds, without opening it), order,
                // team. Row 2: customer and OPL number.
                label: [o.varieties.join(', '), o.orderName, o.team || NO_TEAM, `${o.issuedPct}% issued`]
                  .filter(Boolean)
                  .join(' · '),
                // Varieties and team in bold, to read at a glance.
                labelParts: [
                  ...(o.varieties.length ? [{ text: o.varieties.join(', '), bold: true }, { text: ' · ' }] : []),
                  { text: `${o.orderName} · ` },
                  { text: o.team || NO_TEAM, bold: true },
                  { text: ` · ${o.issuedPct}% issued` },
                ],
                value: o.oplName,
                sublabel: [o.customer, o.oplName].filter(Boolean).join(' · '),
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
            {/* The OPL being worked on, spelled out under the picker (remembered when
                the page is left and reopened). */}
            {pickedOpl ? (
              <View style={s.pickedOpl}>
                <View style={s.pickedHead}>
                  <Text style={[s.pickedOrder, s.pickTitleFlex]} numberOfLines={1}>
                    {pickedOpl.orderName}
                  </Text>
                  {/* The buckets already issued to this line: tap for the list. */}
                  <Pressable
                    onPress={() => void openIssued(pickedOpl.oplName)}
                    style={s.bktBtn}
                    hitSlop={6}
                    accessibilityLabel="Buckets issued to this OPL"
                  >
                    <Text style={s.bktBtnText}>{pickedOpl.issuedBuckets} bkt</Text>
                  </Pressable>
                </View>
                <Text style={s.pickedMeta} numberOfLines={1}>
                  {[pickedOpl.oplName, pickedOpl.customer].filter(Boolean).join(' · ')}
                </Text>
                <Text style={s.pickedMeta} numberOfLines={1}>
                  {[pickedOpl.team || NO_TEAM, `${pickedOpl.issuedPct}% issued`, `${pickedOpl.openBuckets} bucket${pickedOpl.openBuckets === 1 ? '' : 's'} left`].join(' · ')}
                </Text>
                {pickedOpl.varieties.length ? (
                  <Text style={s.pickedVar} numberOfLines={2}>
                    {pickedOpl.varieties.join(', ')}
                  </Text>
                ) : null}
              </View>
            ) : null}
          </Card>

          {opl ? (
            <Card title="Allocated bucket that was not issued">
              {offlineBucketsLoading ? (
                <View style={{ gap: 10 }}>
                  <Skeleton width={'70%'} height={14} />
                  <Skeleton width={'55%'} height={14} />
                  <Skeleton width={'80%'} height={14} />
                </View>
              ) : offlineBuckets.length === 0 ? (
                <Text style={s.muted}>Every bucket on this OPL is issued.</Text>
              ) : (
                offlineBuckets.map((b) => {
                  const picked = allocatedBucket === b.bucket;
                  const done = b.issuedOffline;
                  return (
                    <Pressable
                      key={b.bucket}
                      style={[s.pickRow, picked && s.pickRowActive, done && s.pickRowDone]}
                      onPress={() =>
                        done
                          ? showError(`${b.bucket} was already issued offline to this OPL.`)
                          : selectAllocatedBucket(picked ? null : b.bucket)
                      }
                      disabled={loading}
                    >
                      <View style={s.pickBody}>
                        {/* Bucket on the left, its shelf on the right of the same line,
                            each with its label underneath. */}
                        <View style={s.pickTitleRow}>
                          <View style={s.pickTitleFlex}>
                            <Text style={s.pickTitle} numberOfLines={1}>
                              {b.bucket}
                            </Text>
                            <Text style={s.pickIdLabel}>Bucket</Text>
                          </View>
                          <View style={s.pickShelfCol}>
                            <Text
                              style={[
                                s.pickShelf,
                                (b.inTransit || !b.shelf) && s.pickShelfNone,
                                done && s.pickShelfDone,
                              ]}
                              numberOfLines={1}
                            >
                              {done ? 'Issued offline' : b.inTransit ? 'On the way' : (b.shelf ?? 'No shelf')}
                            </Text>
                            <Text style={s.pickIdLabel}>{done ? 'Done' : 'Shelf'}</Text>
                          </View>
                        </View>
                        <Text style={s.pickDetail}>
                          {[b.variety, b.stemLength, `${b.stems} stems`].filter(Boolean).join(' · ')}
                        </Text>
                      </View>
                      <Text style={[s.pickMark, picked && s.pickMarkActive]}>{done ? '✓' : picked ? '●' : '○'}</Text>
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
            visible={!!issued}
            onClose={() => setIssued(null)}
            title={`Issued to ${pickedOpl?.orderName ?? issued?.opl ?? ''}`}
            subtitle={
              issued && !issued.loading
                ? `${issued.buckets.length} bucket${issued.buckets.length === 1 ? '' : 's'} · ${Math.round(
                    issued.buckets.reduce((n, b) => n + b.contents.reduce((m, c) => m + c.stems, 0), 0),
                  )} stems`
                : undefined
            }
          >
            {issued?.loading ? (
              <View style={{ gap: 10 }}>
                <Skeleton width={'70%'} height={14} />
                <Skeleton width={'55%'} height={14} />
              </View>
            ) : issued?.error ? (
              <Alert tone="danger">{issued.error}</Alert>
            ) : issued && !issued.buckets.length ? (
              <Text style={s.muted}>Nothing issued to this OPL yet.</Text>
            ) : (
              issued?.buckets.map((b) => (
                <View key={b.bucket} style={s.issuedRow}>
                  <View style={s.pickTitleRow}>
                    <Text style={[s.pickTitle, s.pickTitleFlex]} numberOfLines={1}>
                      {b.bucket}
                    </Text>
                    <Text style={[s.issuedTag, b.issuedOffline && s.issuedTagOffline]}>
                      {b.issuedOffline ? 'Issued offline' : 'Issued'}
                    </Text>
                  </View>
                  {b.contents.map((c, i) => (
                    <View key={i} style={s.issuedLine}>
                      <Text style={[s.pickDetail, s.pickTitleFlex]} numberOfLines={1}>
                        {[c.variety, c.stemLength].filter(Boolean).join(' · ') || '—'}
                      </Text>
                      <Text style={s.issuedQty}>{Math.round(c.stems)} stems</Text>
                    </View>
                  ))}
                  {b.at ? <Text style={s.pickIdLabel}>{b.at.slice(0, 16).replace('T', ' ')}</Text> : null}
                </View>
              ))
            )}
          </BottomSheet>

          <BottomSheet
            visible={!!allocatedBucket}
            onClose={() => selectAllocatedBucket(null)}
            busy={loading}
            title="Issue this bucket"
            top={
              camOpen ? (
                <InlineCamera
                  onScan={(code) => {
                    setCamOpen(false);
                    void onBucketScanIssueOffline(code);
                  }}
                  onClose={() => setCamOpen(false)}
                />
              ) : undefined
            }
            subtitle={pickedBucket ? [pickedBucket.bucket, pickedBucket.variety, pickedBucket.stemLength, `${pickedBucket.stems} stems`].filter(Boolean).join(' · ') : undefined}
          >
            {/* Checked as soon as the bucket is picked: did it already go through
                offline issuing as not found or the wrong variety? */}
            {substitutes?.history.length ? (
              <Alert tone="warn">
                {substitutes.history
                  .map((h) =>
                    [
                      `Already reported ${h.reason === 'not_found' ? 'not found' : 'wrong variety / stem length'}`,
                      h.orderName || h.oplName,
                      h.newBucket ? `replaced by ${h.newBucket}` : '',
                      h.reportedBy,
                      h.reportedAt,
                      h.status,
                    ]
                      .filter(Boolean)
                      .join(' · '),
                  )
                  .join('\n')}
              </Alert>
            ) : null}
            {/* The bucket is there: scan it and it goes onto its line. Only when it
                can't be issued does a reason (and a substitute) come into it. */}
            {!reason ? (
              <View>
                <Text style={s.sheetLabel}>Scan the bucket</Text>
                <ScanField
                  ref={bucketRef}
                  onScan={onBucketScanIssueOffline}
                  onCameraPress={() => setCamOpen((o) => !o)}
                  cameraOpen={camOpen}
                  autoFocus
                  placeholder={`Scan ${allocatedBucket} to issue it to this line`}
                  editable={!loading}
                />
                {loading ? <Text style={s.muted}>Issuing…</Text> : null}
              </View>
            ) : null}
            <Text style={s.sheetLabel}>{reason ? 'Not issued because' : "Can't issue it?"}</Text>
            <View style={[s.modeRow, s.noMargin]}>
              <ModeButton
                label="Not found"
                active={reason === 'not_found'}
                onPress={() => setReason(reason === 'not_found' ? null : 'not_found')}
              />
              <ModeButton
                label="Wrong variety / stem length"
                active={reason === 'wrong_variety'}
                onPress={() => setReason(reason === 'wrong_variety' ? null : 'wrong_variety')}
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
                <Text style={s.sheetLabel}>Pick a substitute</Text>
                {substitutesLoading ? (
                  <View style={{ gap: 10, marginBottom: 8 }}>
                    <Skeleton width={'70%'} height={14} />
                    <Skeleton width={'55%'} height={14} />
                  </View>
                ) : substitutes?.candidates.length ? (
                  substitutes.candidates.map((c) => {
                    const picked = chosenSubstitute === c.bucket;
                    return (
                      <Pressable
                        key={c.bucket}
                        style={[s.pickRow, picked && s.pickRowActive]}
                        onPress={() => {
                          chooseSubstitute(picked ? null : c.bucket);
                          focusWhenReady(bucketRef);
                        }}
                        disabled={loading}
                      >
                        <View style={s.pickBody}>
                          <Text style={s.pickTitle} numberOfLines={1}>
                            {c.bucket}
                          </Text>
                          {/* What is inside first: variety and stem length, in bold. */}
                          <Text style={s.pickInside}>
                            {[c.variety, c.stemLength].filter(Boolean).join(' · ') || '—'}
                          </Text>
                          <Text style={s.pickDetail}>
                            {[c.stems != null ? `${c.stems} stems` : '', c.shelf ?? 'not on a shelf']
                              .filter(Boolean)
                              .join(' · ')}
                          </Text>
                        </View>
                        <Text style={[s.pickMark, picked && s.pickMarkActive]}>{picked ? '●' : '○'}</Text>
                      </Pressable>
                    );
                  })
                ) : (
                  <Text style={[s.muted, s.noTopMargin]}>
                    {substitutes?.message ?? 'No substitute bucket found.'}
                  </Text>
                )}
                <Text style={s.sheetLabel}>Scan substitute</Text>
                <ScanField
                  ref={bucketRef}
                  onScan={onBucketScanIssueOffline}
                  onCameraPress={() => setCamOpen((o) => !o)}
                  cameraOpen={camOpen}
                  autoFocus
                  placeholder={
                    chosenSubstitute
                      ? `Scan ${chosenSubstitute}`
                      : reason === 'not_found'
                        ? `Scan substitute (or ${allocatedBucket} if found)`
                        : 'Scan substitute'
                  }
                  editable={!loading}
                />
                {loading ? <Text style={s.muted}>Issuing…</Text> : null}
              </View>
            ) : null}
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
              value={[c.variety, c.stemLength, c.stems != null ? `${c.stems} stems` : null, c.shelf].filter(Boolean).join(' · ')}
            />
          ))}
        </Card>
      ) : null}
    </>
  );
}

/** Stems across the scanned buckets the server has resolved so far. */
function stockTakeStems(rows: StockTakeScanRow[]): number {
  return rows.reduce((sum, r) => sum + (r.serverQty ?? 0), 0);
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
  const detail = [row.serverVariety, row.serverStemLength, row.serverQty != null ? `${row.serverQty} stems` : null]
    .filter(Boolean)
    .join(' · ');
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
  farmBannerValue: { fontFamily: fontFamily.bold, fontSize: scaleFont(15), color: COLORS.text, flexShrink: 1 },
  teamSelect: { width: 170, maxWidth: '55%', marginLeft: 12 },
  modeRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  noMargin: { marginBottom: 0 },
  noTopMargin: { marginTop: 0 },
  sheetLabel: { fontFamily: fontFamily.semiBold, fontSize: scaleFont(13), color: COLORS.text, marginBottom: 6 },
  pickRowDone: { opacity: 0.6 },
  pickedHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  bktBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: COLORS.text,
  },
  bktBtnText: { fontFamily: fontFamily.semiBold, fontSize: scaleFont(12), color: COLORS.bg },
  issuedRow: {
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
    gap: 3,
  },
  issuedLine: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  issuedQty: { fontFamily: fontFamily.semiBold, fontSize: scaleFont(13), color: COLORS.text },
  issuedTag: { fontFamily: fontFamily.semiBold, fontSize: scaleFont(12), color: COLORS.textMuted },
  issuedTagOffline: { color: COLORS.success ?? '#067647' },
  pickShelfDone: { color: COLORS.success ?? '#067647' },
  pickTitleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  pickShelfCol: { alignItems: 'flex-end', flexShrink: 0 },
  pickIdLabel: { fontFamily: fontFamily.regular, fontSize: scaleFont(11), color: COLORS.textMuted, marginTop: 1 },
  pickTitleFlex: { flex: 1, minWidth: 0 },
  pickShelf: { fontFamily: fontFamily.bold, fontSize: scaleFont(14), color: COLORS.text, flexShrink: 0 },
  // Same bold size as the bucket, greyed when there is no shelf to go to.
  pickShelfNone: { color: COLORS.textMuted },
  pickedOpl: {
    marginTop: 10,
    padding: 12,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surfaceAlt,
    gap: 2,
  },
  pickedOrder: { fontFamily: fontFamily.bold, fontSize: scaleFont(15), color: COLORS.text },
  pickedMeta: { fontFamily: fontFamily.regular, fontSize: scaleFont(12), color: COLORS.textMuted },
  pickedVar: { fontFamily: fontFamily.semiBold, fontSize: scaleFont(12), color: COLORS.text, marginTop: 2 },
  filterLabel: { fontFamily: fontFamily.regular, fontSize: scaleFont(12), color: COLORS.textMuted, marginBottom: 6 },
  modeButton: {
    flex: 1,
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
  },
  modeButtonActive: { backgroundColor: COLORS.text, borderColor: COLORS.text },
  modeButtonLabel: { fontFamily: fontFamily.semiBold, fontSize: scaleFont(13), color: COLORS.text, textAlign: 'center' },
  modeButtonLabelActive: { color: COLORS.surface },
  shelfStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginTop: 8,
  },
  shelfStatusLabel: {
    flexShrink: 1,
    fontFamily: fontFamily.regular,
    fontSize: scaleFont(12),
    color: COLORS.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  changeLink: { fontFamily: fontFamily.semiBold, fontSize: scaleFont(13), color: COLORS.text },
  reasonInput: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    padding: 10,
    fontSize: 14,
    color: COLORS.text,
    minHeight: 60,
    textAlignVertical: 'top',
    marginBottom: 10,
  },
  muted: { fontFamily: fontFamily.regular, fontSize: scaleFont(12), color: COLORS.textMuted, marginTop: 8 },
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
  pickBody: { flex: 1, minWidth: 0 },
  pickTitle: { fontFamily: fontFamily.bold, fontSize: scaleFont(14), color: COLORS.text },
  pickDetail: { fontFamily: fontFamily.regular, fontSize: scaleFont(12), color: COLORS.textMuted, marginTop: 2 },
  pickInside: { fontFamily: fontFamily.bold, fontSize: scaleFont(14), color: COLORS.text, marginTop: 2 },
  pickMark: { fontFamily: fontFamily.regular, fontSize: scaleFont(16), color: COLORS.textMuted },
  pickMarkActive: { color: COLORS.text },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 4 },
  detailLabel: {
    fontFamily: fontFamily.regular,
    fontSize: scaleFont(12),
    color: COLORS.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  detailValue: { fontFamily: fontFamily.regular, fontSize: scaleFont(14), color: COLORS.text, flexShrink: 1, textAlign: 'right' },
  stockTakeRow: {
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  stockTakeHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  stockTakeBucketId: { fontFamily: fontFamily.bold, fontSize: scaleFont(14), color: COLORS.text },
  stockTakeStatus: { fontFamily: fontFamily.semiBold, fontSize: scaleFont(13), flexShrink: 1, textAlign: 'right' },
  stockTakeDetail: { fontFamily: fontFamily.regular, fontSize: scaleFont(12), color: COLORS.textMuted, marginTop: 2, flexShrink: 1 },
  syncRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  syncCount: { fontFamily: fontFamily.regular, fontSize: scaleFont(13), color: COLORS.text, flexShrink: 1 },
  logHeader: {
    fontFamily: fontFamily.bold,
    fontSize: scaleFont(12),
    
    color: COLORS.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginTop: 16,
    marginBottom: 4,
  },
});
