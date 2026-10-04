import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  AppState,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '@/src/core/ui/Screen';
import { Card, Alert } from '@/src/core/ui/Card';
import { Button } from '@/src/core/ui/Button';
import { Dialog } from '@/src/core/ui/Dialog';
import { ProgressBar } from '@/src/core/ui/ProgressBar';
import { Segmented } from '@/src/core/ui/Segmented';
import { ScanField, type ScanFieldHandle } from '@/src/core/scanning/ScanField';
import { showDialog } from '@/src/core/ui/DialogHost';
import { storage, StorageKeys } from '@/src/core/storage';
import { SkeletonCards } from '@/src/core/ui/SkeletonCards';
import { focusWhenReady } from '@/src/core/scanning/focus';
import { useToast } from '@/src/core/ui/Toast';
import { borderRadius, COLORS, fontFamily, fontSize, spacing, scaleFont } from '@/src/core/theme';
import {
  useKarenBucketRequestsStore,
  type OrderGroup,
  type TrolleyOpl,
  type PlannedTrip,
  type PlannedTripStop,
  type ReplacementCandidate,
} from '@/src/tenants/karen/state/karen-bucket-requests-store';
import {
  karenBucketRequestsRepository,
  REPLACE_REASONS,
  type CompletedTrip,
  type OplSchedule,
  type ReplaceReason,
  type BucketIssueInfo,
  type TripArrival,
  type ShelvedTrip,
} from '@/src/tenants/karen/repository/karen-bucket-requests-repository';
import { isoDay, setActiveFarm, type ReqOpl, type ReqBucket, type Vehicle } from '@/src/tenants/karen/offline/bucket-requests-db';
import { lineColors, type LineColor } from './line-colors';

type Tab = 'requests' | 'trolley' | 'transit' | 'shelved';

const SYNC_INTERVAL_MS = 30_000;

/** OPL name -> its planned trip, so the Requests tab can grey unscheduled ones. */
/** `label` is the trip id, or "Team A #2" for an order only on the Packhouse Schedule. */
type OplTripInfo = { label: string; confirmed: boolean; status: string; onTrip: boolean };
type OplTripMap = Record<string, OplTripInfo>;

export function KarenBucketRequestsScreen({ userFarm }: { userFarm: string }) {
  const scanRef = useRef<ScanFieldHandle>(null);
  const { showSuccess, showError } = useToast();
  const [tab, setTab] = useState<Tab>('requests');
  const [refreshing, setRefreshing] = useState(false);
  const [scanStatus, setScanStatus] = useState<{ ok: boolean; message: string } | null>(null);
  // Orders waiting for "Load to planned truck" to be confirmed (null = sheet closed).
  const [loadConfirm, setLoadConfirm] = useState<PlannedLoad[] | null>(null);
  const [replacingId, setReplacingId] = useState<number | null>(null);
  // The bucket being replaced and the matching buckets offered for it.
  const [replacePick, setReplacePick] = useState<{
    bucket: ReqBucket;
    pliId: string;
    neededQty: number | null;
    candidates: ReplacementCandidate[];
  } | null>(null);
  // Blocks a second preview/confirm before the disabled state re-renders.
  const replaceBusy = useRef(false);

  const {
    ready,
    error,
    requests,
    trolley,
    inTransit,
    vehicles,
    plannedTrips,
    schedules,
    reqCount,
    scannedBuckets,
    totalBuckets,
    allBuckets,
    addedBuckets,
    inTransitCount,
    activeTrolleyId,
    online,
    downloading,
    loadingTrips,
    syncingOpl,
    init,
    refresh,
    download,
    loadPlannedTrips,
    sync,
    setTrolleyFromScan,
    clearActiveTrolley,
    scanBucketFromScan,
    loadAllToTruck,
    findReplacement,
    replaceBucket,
    markNotFound,
    bucketIssueInfo,
    markIssued,
    closeStop,
    deliveryDate,
    setDeliveryDate,
    completedTrips,
    loadCompletedTrips,
    arrivals,
    tripArrival,
    shelvedTrips,
    shelvedHub,
    loadingShelved,
    loadShelvedBuckets,
  } = useKarenBucketRequestsStore();

  // Shelved: the selected delivery date's buckets, pulled with the screen (its tab
  // shows the count), again when the date or tab changes, and on pull-to-refresh.
  useEffect(() => {
    if (online && userFarm) loadShelvedBuckets(userFarm);
  }, [tab, deliveryDate, online, userFarm, loadShelvedBuckets]);
  const shelvedCount = useMemo(
    () => ({
      done: shelvedTrips.reduce((n, t) => n + t.shelved, 0),
      total: shelvedTrips.reduce((n, t) => n + t.total, 0),
    }),
    [shelvedTrips],
  );

  // In Transit: this farm's trips on the road (dispatched, not received yet), with
  // their arrival at the hub. Pulled when the tab opens.
  // Trucks on the road carrying an order for the delivery date on screen (Today /
  // Tomorrow) — a truck can carry several days' orders.
  const roadTrips = useMemo(
    () =>
      completedTrips.filter(
        (t) =>
          t.status === 'Dispatched' &&
          (!deliveryDate || t.orders.some((o) => !o.deliveryDate || o.deliveryDate === deliveryDate)),
      ),
    [completedTrips, deliveryDate],
  );
  useEffect(() => {
    if (tab !== 'transit' || !online || !userFarm) return;
    let live = true;
    loadCompletedTrips(userFarm).then(() => {
      if (!live) return;
      for (const t of useKarenBucketRequestsStore.getState().completedTrips) {
        if (t.status === 'Dispatched') tripArrival(t.tripId, userFarm, 'status');
      }
    });
    return () => {
      live = false;
    };
  }, [tab, online, userFarm, loadCompletedTrips, tripArrival]);
  const onArrival = async (tripId: string, action: 'status' | 'arrive' | 'complete') => {
    const r = await tripArrival(tripId, userFarm, action);
    if (!r.ok) showError(r.message);
    else if (r.message) showSuccess(r.message);
    return r.ok;
  };

  // Every bucket already on a trolley (or beyond), for "Added to trolley": the
  // requests' scanned ones plus every bucket of the orders on trolleys / trucks.
  const addedList = useMemo(() => {
    // Everything about each: bucket and qty, variety and length, order and customer.
    const out: { key: string; label: string; meta: string; sub?: string }[] = [];
    const add = (b: ReqBucket, order: string, customer: string) => {
      if (!b.scanned || b.notFound) return;
      out.push({
        key: `${order}-${b.id}`,
        label: `${b.bucketId.toUpperCase()} · ${Math.round(b.qty)} ${b.uom || 'stems'}`,
        meta: [
          bucketMeta(b.variety, b.stemLength),
          b.shelf ? `shelf ${b.shelf.toUpperCase()}` : '',
          b.trolleyId ? `trolley ${b.trolleyId.toUpperCase()}` : '',
        ]
          .filter(Boolean)
          .join(' · '),
        sub: [order, customer].filter(Boolean).join(' · '),
      });
    };
    for (const g of requests) for (const o of g.opls) for (const b of o.buckets) add(b, g.orderName, o.customer || '');
    for (const o of [...trolley, ...inTransit]) for (const b of o.buckets) add(b, o.orderName, o.customer || '');
    return out;
  }, [requests, trolley, inTransit]);
  // Shelved at the hub for the day: bucket, shelf and time, order and customer.
  const shelvedList = useMemo(
    () =>
      shelvedTrips.flatMap((t) =>
        t.buckets
          .filter((b) => b.shelved)
          .map((b) => ({
            key: `${t.tripId}-${b.opl}-${b.bucketId}`,
            label: b.bucketId.toUpperCase(),
            meta: [
              b.shelf ? `shelf ${b.shelf.toUpperCase()}` : '',
              b.shelvedAt ? `shelved ${b.shelvedAt.slice(11, 16)}` : '',
              t.vehicle ? `truck ${t.vehicle}` : '',
            ]
              .filter(Boolean)
              .join(' · '),
            sub: [b.orderName, b.customer].filter(Boolean).join(' · '),
          })),
      ),
    [shelvedTrips],
  );
  // The buckets already loaded and on the road (Trolley's summary: what left the trolley).
  const transitList = useMemo(() => {
    const keys = new Set(inTransit.flatMap((o) => o.buckets.map((b) => `${o.orderName}-${b.id}`)));
    return addedList.filter((it) => keys.has(it.key));
  }, [addedList, inTransit]);


  // Bucket Requests is for the remote farms; at the sales farm (the transfer hub) the
  // buckets arrive instead, so the page shows a note and nothing else.
  const [savedHub, setSavedHub] = useState<string | null>(null);
  useEffect(() => {
    storage.get(StorageKeys.transferHub).then(setSavedHub).catch(() => {});
  }, []);
  const hubFarm = shelvedHub || savedHub || '';
  const atHub = !!userFarm && !!hubFarm && userFarm === hubFarm;

  // A trip the truck has left this farm on is done here until its next run.
  const openTrips = useMemo(() => plannedTrips.filter((t) => !t.yourStopClosed), [plannedTrips]);

  // The farms work on tomorrow's deliveries: one Tomorrow chip, nothing else. A
  // date left over from yesterday (or "every date") snaps back to tomorrow.
  const tomorrow = isoDay(1);
  useEffect(() => {
    if (deliveryDate !== tomorrow) setDeliveryDate(tomorrow, userFarm);
  }, [deliveryDate, tomorrow, userFarm, setDeliveryDate]);

  // OPL name -> the planned trip it sits on (for greying the Requests tab).
  const oplTrip = useMemo(() => {
    const m: OplTripMap = {};
    // Packhouse Schedule first; a trip for the same order overrides it.
    for (const sc of schedules) {
      if (!sc.scheduled) continue;
      m[sc.oplName] = {
        label: `${sc.team || 'Scheduled'}${sc.sequence ? ` #${sc.sequence}` : ''}`,
        confirmed: false,
        status: 'Scheduled',
        onTrip: false,
      };
    }
    for (const t of plannedTrips) {
      for (const o of t.orders ?? []) {
        if (o.opl) m[o.opl] = { label: t.tripId, confirmed: t.confirmed, status: t.status, onTrip: true };
      }
    }
    return m;
  }, [plannedTrips, schedules]);

  // OPL -> its packing line's colour (same palette on every tab).
  const oplLine = useMemo(() => lineColors(schedules).byOpl, [schedules]);

  // OPL -> "Team A #1" (schedule slot) or just the team stamped at allocation.
  const oplTeam = useMemo(() => {
    const m: Record<string, string> = {};
    for (const sc of schedules) {
      if (sc.team) m[sc.oplName] = sc.sequence ? `${sc.team} #${sc.sequence}` : sc.team;
    }
    return m;
  }, [schedules]);

  // Picklists load by themselves: open the local DB, then pull straight away
  // (the focus effect below keeps them live). The download icon only forces a
  // pull with a result toast.
  useEffect(() => {
    // Only this station's farm is listed, scanned and loaded (bucket-requests-db).
    setActiveFarm(userFarm);
    init().then(() => sync(userFarm));
  }, [init, sync, userFarm]);

  useFocusEffect(
    useCallback(() => {
      focusWhenReady(scanRef);
    }, []),
  );

  // Keep the page live while it is open: pull new picklists, the trip plan,
  // schedules and order states in the background, and again on return to the app.
  useFocusEffect(
    useCallback(() => {
      sync(userFarm);
      const timer = setInterval(() => sync(userFarm), SYNC_INTERVAL_MS);
      const sub = AppState.addEventListener('change', (st) => {
        if (st === 'active') sync(userFarm);
      });
      return () => {
        clearInterval(timer);
        sub.remove();
      };
    }, [sync, userFarm]),
  );
  useEffect(() => {
    focusWhenReady(scanRef);
  }, [activeTrolleyId]);

  const onTrolleyScan = (raw: string) => {
    const r = setTrolleyFromScan(raw);
    if (!r.ok) {
      const msg = r.message ?? 'Invalid trolley QR.';
      setScanStatus({ ok: false, message: msg });
      showError(msg);
      scanRef.current?.clear();
      focusWhenReady(scanRef);
    } else {
      const msg = `Trolley ${r.trolleyId} active`;
      setScanStatus({ ok: true, message: msg });
      showSuccess(`Trolley ${r.trolleyId}`);
      scanRef.current?.clear();
      focusWhenReady(scanRef);
    }
  };

  // Route by QR content, not by which field caught it: Android can leave focus
  // on the (now read-only) trolley field, so a bucket QR must still land as a
  // bucket, and a trolley QR in the bucket field switches the trolley.
  const onAnyScan = (raw: string) => {
    if (karenBucketRequestsRepository.extractBucketIdFromScan(raw)) return onBucketScan(raw);
    if (karenBucketRequestsRepository.extractTrolleyIdFromScan(raw)) return onTrolleyScan(raw);
    return activeTrolleyId ? onBucketScan(raw) : onTrolleyScan(raw);
  };

  const onBucketScan = async (raw: string) => {
    const r = await scanBucketFromScan(raw);
    setScanStatus({ ok: r.ok, message: r.message });
    if (r.ok) showSuccess(r.message);
    else showError(r.message);
    scanRef.current?.clear();
    focusWhenReady(scanRef);
  };

  // "Load to truck" loads onto the truck each order is PLANNED on (its Bucket Request
  // Trip on the Remote Transfers dashboard) — no vehicle list to pick from. An order
  // with no planned trip can't be loaded until it is planned.
  const onLoad = (opls: TrolleyOpl[]) => {
    // Orders without a planned trip are offered too: the farm picks the truck that came.
    setLoadConfirm(planLoads(opls, plannedTrips));
  };
  const onConfirmLoad = async (groups: PlannedLoad[]) => {
    setLoadConfirm(null);
    if (!groups.length) return;
    for (const g of groups) {
      // "Change truck": move the planned trip to the truck that came, then load it.
      if (g.tripId !== UNPLANNED && g.vehicle !== g.plannedVehicle) {
        const moved = await karenBucketRequestsRepository.changeTripVehicle({ tripId: g.tripId, vehicle: g.vehicle });
        if (moved.kind !== 'ok') {
          showError(moved.message);
          return;
        }
      }
      const r = await loadAllToTruck(g.opls, g.vehicle);
      if (r.ok) showSuccess(r.message);
      else {
        showError(r.message);
        return;
      }
    }
  };

  const onReplace = async (b: ReqBucket) => {
    if (!b.pliId) {
      showError('Download the picklist again to replace this bucket.');
      return;
    }
    if (replaceBusy.current) return;
    const pliId = b.pliId;
    replaceBusy.current = true;
    setReplacingId(b.id);
    const found = await findReplacement(pliId);
    setReplacingId(null);
    replaceBusy.current = false;
    if (!found.ok) {
      showError(found.message);
      return;
    }
    // No match still opens the sheet: the bucket can be marked not found there.
    setReplacePick({ bucket: b, pliId, neededQty: found.neededQty, candidates: found.candidates });
  };

  // Every change from the Info modal is confirmed first: none can be undone here.
  const confirm = (title: string, message: string, label: string, run: () => void) =>
    showDialog(title, message, [{ text: 'Cancel', style: 'cancel' }, { text: label, onPress: run }], {
      name: 'help-circle-outline',
      tone: 'warn',
    });

  const onNotFound = () => {
    const pick = replacePick;
    if (!pick) return;
    confirm(
      'Not found, no replacement?',
      `${pick.bucket.bucketId.toUpperCase()} is left out of the transfer and the order loads with the buckets you have.`,
      'Mark not found',
      () => void doNotFound(),
    );
  };
  const doNotFound = async () => {
    const pick = replacePick;
    if (!pick || replaceBusy.current) return;
    replaceBusy.current = true;
    setReplacePick(null);
    setReplacingId(pick.bucket.id);
    const r = await markNotFound(pick.bucket.bucketId, pick.pliId);
    setReplacingId(null);
    replaceBusy.current = false;
    if (r.ok) showSuccess(`${pick.bucket.bucketId} marked not found — load the order with the buckets you have.`);
    else showError(r.message);
  };

  // The stop closes by itself (no "truck leaving" button): once every bucket this
  // farm has for the truck's current trip is on it, the truck has its load here.
  // Once per trip per screen; a failed close is tried again on the next update.
  const autoClosed = useRef(new Set<string>());
  useEffect(() => {
    if (!online || !userFarm) return;
    for (const t of plannedTrips) {
      const stop = (t.stops ?? []).find((st) => st.isYou);
      if (!stop || t.yourStopClosed || !t.current || autoClosed.current.has(t.tripId)) continue;
      const forStop = stop.total || stop.planned;
      const onTruck = stop.loaded + stop.transit + stop.shelved;
      if (forStop <= 0 || onTruck < forStop) continue;
      autoClosed.current.add(t.tripId);
      closeStop(t.tripId, userFarm).then((r) => {
        if (r.ok) showSuccess(r.message || 'All buckets are on the truck — stop closed.');
        else autoClosed.current.delete(t.tripId);
      });
    }
  }, [plannedTrips, online, userFarm, closeStop, showSuccess]);

  const onMarkIssued = (line: string) => {
    const pick = replacePick;
    if (!pick) return;
    confirm(
      'Mark as issued?',
      `${pick.bucket.bucketId.toUpperCase()} was issued offline to ${line || 'this line'}. It is marked issued for this order — nothing is replaced.`,
      'Mark issued',
      async () => {
        if (replaceBusy.current) return;
        replaceBusy.current = true;
        setReplacePick(null);
        setReplacingId(pick.bucket.id);
        const r = await markIssued(pick.bucket.id, pick.pliId);
        setReplacingId(null);
        replaceBusy.current = false;
        if (r.ok) showSuccess(r.message);
        else showError(r.message);
      },
    );
  };

  const onConfirmReplace = (c: ReplacementCandidate, reason: ReplaceReason, notes?: string) => {
    const pick = replacePick;
    if (!pick) return;
    confirm(
      'Replace this bucket?',
      `${pick.bucket.bucketId.toUpperCase()} is replaced with ${c.bucketId.toUpperCase()}${c.shelf ? ` (shelf ${c.shelf.toUpperCase()})` : ''} — ${reason.toLowerCase()}.`,
      'Replace',
      () => void doReplace(c, reason, notes),
    );
  };
  const doReplace = async (c: ReplacementCandidate, reason: ReplaceReason, notes?: string) => {
    const pick = replacePick;
    if (!pick || replaceBusy.current) return;
    replaceBusy.current = true;
    setReplacePick(null);
    setReplacingId(pick.bucket.id);
    const r = await replaceBucket(pick.bucket.id, pick.pliId, c.bucketId, reason, notes);
    setReplacingId(null);
    replaceBusy.current = false;
    if (r.ok) showSuccess(r.message);
    else showError(r.message);
    // The server may still commit the swap; the sync picks up the new bucket.
    if (r.pending) sync(userFarm);
  };

  const onDownload = async () => {
    const r = await download(userFarm);
    if (r.ok) showSuccess(r.message);
    else showError(r.message);
  };

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      // On the Trips tab a pull also re-pulls the live plan (when online).
      if (tab === 'requests' && online) await loadPlannedTrips(userFarm);
      if (tab === 'shelved' && online) await loadShelvedBuckets(userFarm);
      await refresh();
    } finally {
      setRefreshing(false);
    }
  };

  if (!ready && error) {
    return (
      <Screen title="Bucket Requests" scroll={false}>
        <Alert tone="danger">{error}</Alert>
        <Card>
          <Button label="Retry" iconLeft="refresh" onPress={() => init()} />
        </Card>
      </Screen>
    );
  }

  // Refresh and download in the header; no clearing of downloaded data.
  const headerActions = (
    <View style={s.headerActions}>
      <Pressable
        style={[s.headerBtn, refreshing && s.headerBtnBusy]}
        hitSlop={6}
        onPress={onRefresh}
        disabled={refreshing}
        accessibilityRole="button"
        accessibilityLabel="Refresh"
      >
        {refreshing ? (
          <ActivityIndicator size="small" color={COLORS.text} />
        ) : (
          <Ionicons name="refresh" size={20} color={COLORS.text} />
        )}
      </Pressable>
      <Pressable
        style={[s.headerBtn, downloading && s.headerBtnBusy]}
        hitSlop={6}
        onPress={onDownload}
        disabled={downloading}
        accessibilityRole="button"
        accessibilityLabel="Download picklists"
      >
        {downloading ? (
          <ActivityIndicator size="small" color={COLORS.text} />
        ) : (
          <Ionicons name="cloud-download-outline" size={20} color={COLORS.text} />
        )}
      </Pressable>
    </View>
  );

  if (atHub) {
    return (
      <Screen title="Bucket Requests">
        <Card>
          <View style={s.empty}>
            <Ionicons name="business-outline" size={26} color={COLORS.textMuted} />
            <Text style={s.emptyTitle}>Not for {hubFarm}</Text>
            <Text style={s.emptyHint}>
              {hubFarm} is the sales farm: remote farms send their buckets here. Bucket Requests is used at the remote
              farms.
            </Text>
          </View>
        </Card>
      </Screen>
    );
  }

  return (
    <Screen title="Bucket Requests" scroll={false} headerRight={headerActions}>
      {/* Fixed above the list: the scan field and the farm badge on its edge stay
          put while the requests scroll. */}
      {!online ? (
        <Text style={s.offline}>Offline — you can still scan; downloads need internet.</Text>
      ) : null}

      <View style={s.scanWrap}>
      <Card>
        {/* One field for both steps: scan the trolley first, then it
            switches to buckets for that trolley. Routing is by QR content
            (onAnyScan), so a trolley QR scanned mid-way switches trolleys. */}
        <View style={s.scanHead}>
          <Text style={s.scanLabel}>
            {activeTrolleyId ? 'Scan bucket' : 'Scan trolley'}
          </Text>
          {activeTrolleyId ? (
            <View style={s.trolleyChip}>
              <Ionicons name="cart" size={13} color={COLORS.text} />
              <Text style={s.trolleyChipText} numberOfLines={1}>
                {activeTrolleyId}
              </Text>
              <Pressable
                onPress={() => {
                  clearActiveTrolley();
                  setScanStatus(null);
                  focusWhenReady(scanRef);
                }}
                hitSlop={8}
                style={s.changeRow}
                accessibilityRole="button"
                accessibilityLabel="Change trolley"
              >
                <Ionicons name="swap-horizontal" size={13} color={COLORS.text} />
                <Text style={s.changeLink}>Change</Text>
              </Pressable>
            </View>
          ) : null}
        </View>
        <ScanField
          ref={scanRef}
          onScan={onAnyScan}
          autoFocus
          placeholder={activeTrolleyId ? 'Scan bucket QR' : 'Scan trolley QR'}
        />
      </Card>
      {/* The farm these requests are for (the list only ever holds this station's
          farm), pinned on the scan card's top-right edge. */}
      {userFarm ? (
        <View style={s.farmEdge} pointerEvents="none">
          <Ionicons name="location-outline" size={13} color={COLORS.textMuted} />
          <Text style={s.farmText} numberOfLines={1}>
            {userFarm}
          </Text>
        </View>
      ) : null}
      </View>
      {/* Tabs, fixed under the scan card (only the list below scrolls). Short
          names with the count underneath fit any width, a ~320dp scanner included. */}
      <Segmented
        radius={10}
        value={tab}
        onChange={(v) => setTab(v as Tab)}
        options={[
          { value: 'requests', label: 'Requests', count: reqCount },
          { value: 'trolley', label: 'Trolley', count: `${scannedBuckets}/${totalBuckets}` },
          { value: 'transit', label: 'Transit', count: inTransitCount },
          {
            value: 'shelved',
            label: 'Shelved',
            count: shelvedCount.total ? `${shelvedCount.done}/${shelvedCount.total}` : '—',
          },
        ]}
      />
      <ScrollView
        contentContainerStyle={s.scroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.text} />
        }
      >
        {scanStatus ? (
          <View style={[s.statusBanner, scanStatus.ok ? s.statusOk : s.statusErr]}>
            <Ionicons
              name={scanStatus.ok ? 'checkmark-circle' : 'alert-circle'}
              size={18}
              color={scanStatus.ok ? (COLORS.success ?? '#12B76A') : (COLORS.danger ?? '#EF4444')}
            />
            <Text
              style={[
                s.statusText,
                { color: scanStatus.ok ? (COLORS.success ?? '#067647') : (COLORS.danger ?? '#B42318') },
              ]}
              numberOfLines={2}
            >
              {scanStatus.message}
            </Text>
          </View>
        ) : null}


        {tab === 'requests' ? (
          <RequestsTab
            farm={userFarm}
            hub={shelvedHub}
            groups={requests}
            schedules={schedules}
            plannedTrips={plannedTrips}
            trips={openTrips}
            oplTrip={oplTrip}
            oplTeam={oplTeam}
            oplLine={oplLine}
            online={online}
            loading={downloading || loadingTrips}
            replacingId={replacingId}
            onReplace={onReplace}
          />
        ) : tab === 'trolley' ? (
          <TrolleyTab
            items={trolley}
            allScanned={reqCount === 0}
            syncingOpl={syncingOpl}
            oplTeam={oplTeam}
            oplLine={oplLine}
            onLoad={onLoad}
            scanned={scannedBuckets}
            total={totalBuckets}
          />
        ) : tab === 'shelved' ? (
          <ShelvedTab
            trips={shelvedTrips}
            hub={shelvedHub}
            loading={loadingShelved}
            online={online}
            day={deliveryDate ? dateLabel(deliveryDate) : ''}
          />
        ) : (
          <InTransitTab
            hub={shelvedHub}
            items={inTransit}
            oplTeam={oplTeam}
            oplLine={oplLine}
            trips={roadTrips}
            arrivals={arrivals}
            deliveryDate={deliveryDate}
            online={online}
            loading={loadingTrips}
            onArrival={onArrival}
          />
        )}

        {/* The same summary of the day's OPLs at the end of Requests, Trolley and In Transit. */}
        {tab !== 'shelved' ? (
          <Card title="Summary of today's OPLs">
            <StageSummary
              icon="cart-outline"
              label="Added to trolley"
              done={addedBuckets}
              total={allBuckets}
              items={addedList}
            />
            <StageSummary
              icon="car-outline"
              label="Loaded and in transit"
              done={transitList.length}
              total={allBuckets}
              items={transitList}
            />
            <StageSummary
              icon="checkmark-done-outline"
              label={`Shelved at ${shelvedHub || 'Kapkolia'}`}
              done={shelvedCount.done}
              total={shelvedCount.total || allBuckets}
              items={shelvedList}
            />
          </Card>
        ) : null}
      </ScrollView>

      <LoadConfirm
        loads={loadConfirm}
        vehicles={vehicles}
        online={online}
        onClose={() => setLoadConfirm(null)}
        onConfirm={onConfirmLoad}
      />
      <ReplacePicker
        pick={replacePick}
        onClose={() => setReplacePick(null)}
        onPick={onConfirmReplace}
        onNotFound={onNotFound}
        issueInfo={() => (replacePick ? bucketIssueInfo(replacePick.pliId) : Promise.resolve(null))}
        onMarkIssued={onMarkIssued}
      />
    </Screen>
  );
}

/** One truck's share of a load: the orders planned on that truck's trip. */
type PlannedLoad = { vehicle: string; plannedVehicle: string; tripId: string; status: string; opls: TrolleyOpl[] };

/** Orders on no planned trip load onto the truck the farm picks; the server puts them
 *  on that truck's run visiting the farm (or an unscheduled trip). */
const UNPLANNED = 'unplanned';

/** Group the orders being loaded by the truck their planned trip uses. An order on
 *  several trips takes the run the truck is loading now, else the earliest one still
 *  open (the list comes date- and run-sorted); a trip whose stop here is closed is done. */
function planLoads(opls: TrolleyOpl[], trips: PlannedTrip[]): PlannedLoad[] {
  const byTrip = new Map<string, PlannedLoad>();
  const open = trips.filter((tr) => tr.vehicle && !tr.yourStopClosed);
  for (const o of opls) {
    const has = (tr: PlannedTrip) => (tr.orders ?? []).some((x) => x.opl === o.oplName);
    const t = open.find((tr) => tr.current && has(tr)) ?? open.find(has);
    if (!t) {
      const g = byTrip.get(UNPLANNED) ?? { vehicle: '', plannedVehicle: '', tripId: UNPLANNED, status: '', opls: [] };
      g.opls.push(o);
      byTrip.set(UNPLANNED, g);
      continue;
    }
    const g = byTrip.get(t.tripId) ?? {
      vehicle: t.vehicle,
      plannedVehicle: t.vehicle,
      tripId: t.tripId,
      status: t.status,
      opls: [],
    };
    g.opls.push(o);
    byTrip.set(t.tripId, g);
  }
  return [...byTrip.values()];
}

/** Distinct buckets of an order (a bucket spans several pick rows, one per box). */
const bucketCount = (o: TrolleyOpl) => new Set(o.buckets.map((b) => b.bucketId)).size;

/** Confirms loading onto the planned truck(s): each order with its buckets, and a
 *  "Change truck" for when the planned pick-up truck isn't the one that came. */
function LoadConfirm({
  loads,
  vehicles,
  online,
  onClose,
  onConfirm,
}: {
  loads: PlannedLoad[] | null;
  vehicles: Vehicle[];
  online: boolean;
  onClose: () => void;
  onConfirm: (loads: PlannedLoad[]) => void;
}) {
  const [draft, setDraft] = useState<PlannedLoad[]>([]);
  const [changing, setChanging] = useState<string | null>(null); // tripId whose truck is being changed
  const [query, setQuery] = useState('');
  useEffect(() => {
    setDraft(loads ?? []);
    // No planned trip: open the truck list straight away.
    setChanging((loads ?? []).some((g) => g.tripId === UNPLANNED && !g.vehicle) ? UNPLANNED : null);
    setQuery('');
  }, [loads]);

  const plate = (name: string) => vehicles.find((v) => v.name === name)?.licensePlate || name;
  const total = draft.reduce((n, g) => n + g.opls.reduce((m, o) => m + bucketCount(o), 0), 0);
  const taken = new Set(draft.map((g) => g.vehicle));
  const q = query.trim().toLowerCase();
  const choices = vehicles.filter(
    (v) =>
      (!taken.has(v.name) || draft.find((g) => g.tripId === changing)?.vehicle === v.name) &&
      (!q || v.name.toLowerCase().includes(q) || v.licensePlate.toLowerCase().includes(q)),
  );
  const pick = (vehicle: string) => {
    setDraft((d) => d.map((g) => (g.tripId === changing ? { ...g, vehicle } : g)));
    setChanging(null);
    setQuery('');
  };
  const trucks = draft.map((g) => plate(g.vehicle));

  return (
    <Dialog
      visible={!!loads}
      onClose={onClose}
      title="Load to planned truck"
      align="left"
      closeButton
      subtitle={
        <View style={s.dialogSubBlock}>
          <Text style={s.sheetSub} numberOfLines={1}>
            {total} bucket{total === 1 ? '' : 's'} · {draft.reduce((n, g) => n + g.opls.length, 0)} order
            {draft.reduce((n, g) => n + g.opls.length, 0) === 1 ? '' : 's'}
          </Text>
          {!online ? (
            <Text style={s.sheetOffline}>You’re offline — connect to load to the truck.</Text>
          ) : null}
        </View>
      }
      actions={
        <>
          <Button label="Cancel" variant="outline" onPress={onClose} style={{ flex: 1 }} />
          <Button
            label={trucks.length === 1 ? `Load ${total} to ${trucks[0]}` : `Load ${total}`}
            iconLeft="car-outline"
            onPress={() => onConfirm(draft)}
            disabled={!online || !!changing || !draft.length || draft.some((g) => !g.vehicle)}
            style={{ flex: 2 }}
          />
        </>
      }
    >
      {draft.map((g) => (
        <View key={g.tripId} style={s.loadGroup}>
          <View style={s.truckRow}>
            <Ionicons name="car-outline" size={18} color={COLORS.text} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={s.truckName} numberOfLines={1}>
                {g.vehicle ? plate(g.vehicle) : 'Pick the truck'}
              </Text>
              <Text style={s.sheetHintText} numberOfLines={1}>
                {g.tripId === UNPLANNED ? 'No trip planned' : g.tripId}
                {g.tripId !== UNPLANNED && g.vehicle !== g.plannedVehicle ? ` · planned ${plate(g.plannedVehicle)}` : ''}
              </Text>
            </View>
            <Pressable
              onPress={() => {
                setChanging(changing === g.tripId ? null : g.tripId);
                setQuery('');
              }}
              hitSlop={8}
            >
              <Text style={s.loadChange}>
                {changing === g.tripId ? 'Cancel' : g.vehicle ? 'Change truck' : 'Pick truck'}
              </Text>
            </Pressable>
          </View>
          {changing === g.tripId ? (
            <View>
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Search truck / plate"
                placeholderTextColor={COLORS.textMuted}
                autoCorrect={false}
                autoCapitalize="characters"
                style={s.sheetSearch}
              />
              {choices.map((v) => (
                <Pressable key={v.name} style={s.truckRow} onPress={() => pick(v.name)}>
                  <Ionicons
                    name={v.name === g.vehicle ? 'radio-button-on' : 'radio-button-off'}
                    size={18}
                    color={COLORS.text}
                  />
                  <Text style={s.truckName}>{v.licensePlate || v.name}</Text>
                </Pressable>
              ))}
              {choices.length === 0 ? (
                <Text style={s.emptyHint}>{vehicles.length ? `No truck matches “${query}”.` : 'No trucks downloaded.'}</Text>
              ) : null}
            </View>
          ) : null}
          {g.opls.map((o) => (
            <View key={o.oplName} style={s.loadOrder}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={s.loadOrderName} numberOfLines={1}>
                  {o.orderName || o.oplName}
                </Text>
                <Text style={s.sheetHintText} numberOfLines={1}>
                  {[o.oplName, o.customer].filter(Boolean).join(' · ')}
                </Text>
              </View>
              <Text style={s.loadOrderCount}>
                {bucketCount(o)} bkt
              </Text>
            </View>
          ))}
        </View>
      ))}
    </Dialog>
  );
}

/** Bottom sheet listing every shelved bucket that matches the missing one
 *  (same variety, same or nearest longer length, same farm, enough stems;
 *  best match first). Pick one, then Replace. */
function ReplacePicker({
  pick,
  onClose,
  onPick,
  onNotFound,
  issueInfo,
  onMarkIssued,
}: {
  pick: {
    bucket: ReqBucket;
    neededQty: number | null;
    candidates: ReplacementCandidate[];
  } | null;
  onClose: () => void;
  onPick: (c: ReplacementCandidate, reason: ReplaceReason, notes?: string) => void;
  /** Not in the cold room and nothing to replace it: leave it out of the transfer. */
  onNotFound: () => void;
  /** "Issued offline": where the bucket was issued (which line). */
  issueInfo: () => Promise<BucketIssueInfo | { kind: 'error'; message: string } | null>;
  /** Issued to this order's own line: mark it issued instead of replacing it. */
  onMarkIssued: (line: string) => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  // Why the bucket is being replaced — goes on the Bucket Replacement record.
  const [reason, setReason] = useState<ReplaceReason>('Missing');
  const candidates = pick?.candidates ?? [];
  // Default to the best match each time the sheet opens for a bucket.
  const firstId = candidates[0]?.bucketId ?? null;
  useEffect(() => {
    setSelected(firstId);
    setReason('Missing');
  }, [pick, firstId]);
  // "Issued offline": look up which line it went to. Same line — mark it issued,
  // nothing to replace; another line — replace it as usual.
  type IssueResult = BucketIssueInfo | { kind: 'error'; message: string } | null;
  const issueKey = pick && reason === 'Issued offline' ? pick : null;
  const [issueRes, setIssueRes] = useState<{ key: object; info: IssueResult } | null>(null);
  useEffect(() => {
    if (!issueKey) return;
    let live = true;
    issueInfo().then((info) => {
      if (live) setIssueRes({ key: issueKey, info });
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issueKey]);
  const issued = issueKey && issueRes?.key === issueKey ? issueRes.info : null;
  const issuedLoading = !!issueKey && issueRes?.key !== issueKey;
  const issuedOk = issued && issued.kind === 'ok' ? issued : null;
  const sameLine = !!issuedOk?.sameLine;
  const issuedWhere = issuedOk
    ? issuedOk.issuedTo.map((r) => `${r.team || 'no team'} (${r.orderName})`).join(', ')
    : '';

  const chosen = candidates.find((c) => c.bucketId === selected) ?? null;
  const b = pick?.bucket;
  const needed = pick?.neededQty ?? b?.qty ?? null;

  return (
    <Dialog
      visible={!!pick}
      onClose={onClose}
      title={`Replace ${b?.bucketId ?? ''}`}
      align="left"
      closeButton
      subtitle={
        <View style={s.dialogSubBlock}>
          <Text style={s.sheetSub} numberOfLines={2}>
            {[
              b ? bucketMeta(b.variety, b.stemLength) : '',
              needed != null ? `${Math.round(needed)} ${b?.uom || 'stems'} needed` : '',
            ]
              .filter(Boolean)
              .join(' · ')}
          </Text>
          <View style={s.reasonRow}>
            {REPLACE_REASONS.map((r) => (
              <Pressable
                key={r}
                onPress={() => setReason(r)}
                style={[s.reasonChip, reason === r && s.reasonChipOn]}
                accessibilityRole="radio"
                accessibilityState={{ selected: reason === r }}
              >
                <Text style={[s.reasonText, reason === r && s.reasonTextOn]}>{r}</Text>
              </Pressable>
            ))}
          </View>
          {reason === 'Issued offline' ? (
            <Text style={[s.issuedNote, sameLine && s.issuedNoteSame]}>
              {issuedLoading
                ? 'Checking where it was issued…'
                : issued && issued.kind === 'error'
                  ? issued.message
                  : issuedOk?.thisIssued
                    ? 'Already issued to this order.'
                    : issuedWhere
                      ? `Issued to ${issuedWhere}.${sameLine ? ' Same line — mark it issued, nothing to replace.' : ' Another line — replace it.'}`
                      : 'Not issued anywhere yet — replace it or mark it not found.'}
            </Text>
          ) : null}
          <Text style={s.repCount}>
            {candidates.length} matching bucket{candidates.length === 1 ? '' : 's'}
          </Text>
        </View>
      }
      actions={
        <View style={s.dialogActionsCol}>
          {!candidates.length ? (
            <Text style={s.repNone}>
              No bucket matches {b?.bucketId}. If it isn’t in the cold room, mark it not found — the order
              then loads with the buckets you have.
            </Text>
          ) : null}
          {candidates.length ? (
            <View style={s.repActions}>
              <Button label="Cancel" variant="outline" size="sm" singleLine onPress={onClose} style={{ flex: 1 }} />
              {sameLine ? (
                <Button
                  size="sm"
                  singleLine
                  label="Mark as issued"
                  iconLeft="checkmark-done-outline"
                  onPress={() => onMarkIssued(issuedOk?.issuedTo.find((r) => r.sameLine)?.team || issuedOk?.line || '')}
                  style={{ flex: 2 }}
                />
              ) : (
                <Button
                  size="sm"
                  singleLine
                  label={chosen ? `Replace with ${chosen.bucketId}` : 'Replace'}
                  iconLeft="swap-horizontal"
                  onPress={() => chosen && onPick(chosen, reason)}
                  disabled={!chosen || (reason === 'Issued offline' && issuedLoading)}
                  style={{ flex: 2 }}
                />
              )}
            </View>
          ) : null}
          <View style={s.repActions}>
            {!candidates.length ? <Button label="Cancel" variant="outline" size="sm" singleLine onPress={onClose} style={{ flex: 1 }} /> : null}
            <Button
              size="sm"
              singleLine
              label="Not found — no replacement"
              iconLeft="close-circle-outline"
              variant={candidates.length ? 'outline' : undefined}
              onPress={onNotFound}
              style={{ flex: 2 }}
            />
          </View>
        </View>
      }
    >
      {candidates.map((c, i) => {
        const on = c.bucketId === selected;
        return (
          <Pressable
            key={`${c.bucketId}-${i}`}
            onPress={() => setSelected(c.bucketId)}
            style={[s.repRow, on && s.repRowOn]}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
          >
            <Ionicons
              name={on ? 'radio-button-on' : 'radio-button-off'}
              size={20}
              color={on ? COLORS.text : COLORS.textMuted}
            />
            <View style={{ flex: 1, minWidth: 0 }}>
              <View style={s.repTop}>
                <Text style={s.repId} numberOfLines={1}>
                  {c.bucketId}
                </Text>
                {i === 0 ? (
                  <View style={s.repBest}>
                    <Text style={s.repBestText}>Best match</Text>
                  </View>
                ) : null}
                {/* Its shelf, bold, on the right: where to go and get it. */}
                {c.shelf ? (
                  <Text style={s.repShelfRight} numberOfLines={1}>
                    {c.shelf}
                  </Text>
                ) : null}
              </View>
              <Text style={s.repMeta} numberOfLines={1}>
                {[
                  c.stemLength ? (/^\d+(\.\d+)?$/.test(c.stemLength) ? `${c.stemLength}cm` : c.stemLength) : '',
                  c.availableQty != null ? `${Math.round(c.availableQty)} stems` : '',
                  c.harvestDate ? `Harvested ${c.harvestDate}` : '',
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
            </View>
          </Pressable>
        );
      })}
    </Dialog>
  );
}


/** Picklists to scan, under the planned trip that collects them (trip header with the
 *  truck, this farm's stop and "Truck leaving"), then the orders not on a trip yet —
 *  one list, so trips and requests are not two places to look. */
function RequestsTab({
  farm,
  hub,
  groups,
  schedules,
  plannedTrips,
  trips,
  oplTrip,
  oplTeam,
  oplLine,
  online,
  loading,
  replacingId,
  onReplace,
}: {
  /** This station's farm and the packhouse it sends to: an order's trip reads "farm → hub". */
  farm: string;
  hub: string;
  groups: OrderGroup[];
  schedules: OplSchedule[];
  plannedTrips: PlannedTrip[];
  /** Open trips for this farm (stop not closed yet). */
  trips: PlannedTrip[];
  oplTrip: OplTripMap;
  oplTeam: Record<string, string>;
  oplLine: Record<string, LineColor>;
  online: boolean;
  /** A download or trip-plan pull is running: skeletons while the list is empty. */
  loading: boolean;
  replacingId: number | null;
  onReplace: (b: ReqBucket) => void;
}) {
  const lineColor = useMemo(() => lineColors(schedules), [schedules]);

  if (!groups.length && !trips.length) {
    if (loading) return <SkeletonCards />;
    return (
      <Card>
        <View style={s.empty}>
          <Ionicons name="download-outline" size={26} color={COLORS.textMuted} />
          <Text style={s.emptyTitle}>No new requests</Text>
        </View>
      </Card>
    );
  }

  // Shown in schedule order: team, then slot (Team A #1, #2 …, Team B #1 …);
  // orders only on a trip follow in trip order; unscheduled ones sink to the
  // bottom (greyed).
  const isScheduled = (g: OrderGroup) => g.opls.some((o) => !!oplTrip[o.oplName]);
  const slot = new Map<string, [string, number]>();
  for (const sc of schedules) {
    if (sc.scheduled) slot.set(sc.oplName, [sc.team || '~', sc.sequence || Number.MAX_SAFE_INTEGER]);
  }
  plannedTrips.forEach((t, ti) =>
    (t.orders ?? []).forEach((o, oi) => {
      if (o.opl && !slot.has(o.opl)) slot.set(o.opl, ['~~', ti * 1000 + oi]);
    }),
  );
  const rankOf = (g: OrderGroup): [string, number] => {
    let best: [string, number] = ['~~~', Number.MAX_SAFE_INTEGER];
    for (const o of g.opls) {
      const r = slot.get(o.oplName);
      if (r && (r[0] < best[0] || (r[0] === best[0] && r[1] < best[1]))) best = r;
    }
    return best;
  };
  const bySlot = (ra: [string, number], rb: [string, number]) =>
    ra[0] === rb[0] ? ra[1] - rb[1] : ra[0] < rb[0] ? -1 : 1;
  const unslotted: [string, number] = ['~~~', Number.MAX_SAFE_INTEGER];
  const sorted = [...groups]
    .sort((a, b) => {
      const byScheduled = Number(isScheduled(b)) - Number(isScheduled(a));
      if (byScheduled) return byScheduled;
      return bySlot(rankOf(a), rankOf(b));
    })
    // An order's picklists in their own schedule order too.
    .map((g) => ({
      ...g,
      opls: [...g.opls].sort((a, b) => bySlot(slot.get(a.oplName) ?? unslotted, slot.get(b.oplName) ?? unslotted)),
    }));
  // Trips as steps in the order they collect: by day, the run the truck is loading
  // now first, then its later runs.
  const steps = [...trips].sort(
    (a, b) =>
      (a.tripDate || '').localeCompare(b.tripDate || '') ||
      Number(b.current) - Number(a.current) ||
      (a.run || 0) - (b.run || 0) ||
      (a.vehicle || '').localeCompare(b.vehicle || ''),
  );
  // Each open trip with its orders' picklists still to scan; an order split over two
  // trips shows its picklists under each. What is left goes below the trips.
  const tripOf = new Map<string, string>();
  for (const t of steps) for (const o of t.orders ?? []) if (o.opl && !tripOf.has(o.opl)) tripOf.set(o.opl, t.tripId);
  const onTrip = (tripId: string) =>
    sorted
      .map((g) => ({ ...g, opls: g.opls.filter((o) => tripOf.get(o.oplName) === tripId) }))
      .filter((g) => g.opls.length);
  const rest = sorted
    .map((g) => ({ ...g, opls: g.opls.filter((o) => !tripOf.has(o.oplName)) }))
    .filter((g) => g.opls.length);
  const firstUnschedIdx = rest.findIndex((g) => !isScheduled(g));
  const renderGroup = (g: OrderGroup, dim: boolean, inTrip = false) => {
    const customer = g.opls.find((o) => o.customer)?.customer;
    const teams = [...new Set(g.opls.map((o) => oplTeam[o.oplName]).filter(Boolean))];
    const dot = g.opls.map((o) => lineColor.byOpl[o.oplName]).find(Boolean);
    // Order name (customer, then trip, under it) on the left, the team always on the right.
    const head = (
      <View>
        {/* Row 1: order name left, team right; the customer under it. */}
        <View style={s.groupLine}>
          <Text style={[s.groupHdr, s.groupNames, dim ? s.groupHdrDim : null]}>
            {g.orderName}
          </Text>
          {teams.length ? <TeamChip team={teams.join(', ')} color={dot?.color} fill /> : null}
        </View>
        {customer ? (
          <Text style={[s.groupCustomer, dim ? s.groupHdrDim : null]}>
            {customer}
          </Text>
        ) : null}
      </View>
    );
    if (inTrip) {
      return (
        <View key={g.orderName} style={s.groupInTrip}>
          {head}
          {g.opls.map((o) => (
            <OplCard
              key={o.oplName}
              opl={o}
              trip={oplTrip[o.oplName]}
              team={oplTeam[o.oplName]}
              line={lineColor.byOpl[o.oplName]}
              replacingId={replacingId}
              onReplace={onReplace}
              inTrip
            />
          ))}
        </View>
      );
    }
    return (
      <View key={g.orderName}>
        {head}
        {g.opls.map((o) => (
          <OplCard
            key={o.oplName}
            opl={o}
            trip={oplTrip[o.oplName]}
            team={oplTeam[o.oplName]}
            line={lineColor.byOpl[o.oplName]}
            replacingId={replacingId}
            onReplace={onReplace}
          />
        ))}
      </View>
    );
  };

  return (
    <>

      {steps.map((t, i) => {
        const tripGroups = onTrip(t.tripId);
        return (
          <View key={t.tripId} style={s.step}>
            <View style={[s.stepBody, !t.current ? s.stepBodyLater : null]}>
              {/* One card per trip: the trip, then its picklists still to scan. */}
              <TripCard
                trip={t}
                route={farm ? `${farm} → ${hub || 'Kapkolia'}` : undefined}
                scanned={tripGroups.reduce((n, g) => n + g.opls.reduce((m, o) => m + o.scanned, 0), 0)}
                scanTotal={tripGroups.reduce((n, g) => n + g.opls.reduce((m, o) => m + o.total, 0), 0)}
              >
                {tripGroups.length ? (
                  tripGroups.map((g) => renderGroup(g, false, true))
                ) : (
                  <Text style={s.tripAllScanned}>Every bucket for this trip is scanned — see Trolley.</Text>
                )}
              </TripCard>
            </View>
            {/* The trip's number, floating on the card's top-left corner. */}
            <View style={[s.stepDot, s.stepDotFloat, t.current ? s.stepDotCurrent : null]} pointerEvents="none">
              <Text style={[s.stepNum, t.current ? s.stepNumCurrent : null]}>{i + 1}</Text>
            </View>
          </View>
        );
      })}

      {rest.length && trips.length ? (
        <Text style={s.sectionHdr}>{firstUnschedIdx === 0 ? 'Not on a trip yet' : 'Scheduled — not on a trip yet'}</Text>
      ) : null}
      {rest.map((g, idx) => (
        <View key={g.orderName}>
          {firstUnschedIdx > 0 && idx === firstUnschedIdx ? <Text style={s.sectionHdr}>Not on a trip yet</Text> : null}
          {renderGroup(g, !isScheduled(g))}
        </View>
      ))}
    </>
  );
}

/** Bucket meta line: "Variety · 40cm", omitting any empty part. A bare numeric
 *  stem length gets a "cm" suffix; anything else is shown as-is. Shelf renders as
 *  its own line below this one (see s.bShelf) rather than joined in here. */
/** "Today", "Tomorrow" or "Fri 3 Oct" for a YYYY-MM-DD delivery date. */
function dateLabel(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  const day = new Date(y, m - 1, d);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((day.getTime() - today.getTime()) / 864e5);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  return day.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

function bucketMeta(variety: string, stemLength: string): string {
  const stem = (stemLength || '').trim();
  const stemLabel = stem ? (/^\d+(\.\d+)?$/.test(stem) ? `${stem}cm` : stem) : '';
  return [variety, stemLabel].filter(Boolean).join(' · ');
}

function OplCard({
  opl,
  trip,
  team,
  line,
  replacingId,
  onReplace,
  inTrip,
}: {
  opl: ReqOpl;
  trip?: OplTripInfo;
  team?: string;
  /** The packing line's colour: a thin stripe down the card and a dot on its tag. */
  line?: LineColor;
  replacingId: number | null;
  onReplace: (b: ReqBucket) => void;
  /** Inside its trip's card: drawn flat (no card of its own), and the trip tag,
   *  which only repeats the card's trip, is left out. */
  inTrip?: boolean;
}) {
  const pct = opl.total > 0 ? Math.round((opl.scanned / opl.total) * 100) : 0;
  const dimmed = !trip;
  const Wrap = inTrip ? View : Card;
  // Scanned buckets fold away under one green "N scanned" line (tap to see them,
  // struck through): what is left to find stays on top.
  const [showScanned, setShowScanned] = useState(false);
  const toScan = opl.buckets.filter((b) => !b.scanned);
  const done = opl.buckets.filter((b) => b.scanned);
  // A thin line between buckets (not above the first).
  const bucketRow = (b: ReqBucket, i: number) => (
    <View key={b.id} style={[s.bRow, i > 0 && s.bRowSep]}>
      <Ionicons
        name={b.notFound ? 'close-circle' : b.scanned ? 'checkmark-circle' : 'ellipse-outline'}
        size={18}
        color={b.notFound ? COLORS.danger : b.scanned ? SHELVED_GREEN : COLORS.textMuted}
      />
      <View style={{ flex: 1, minWidth: 0 }}>
        {/* Shelf (left, big and bold: what they look for in the cold room)
            and the bucket on it (right) on one line. */}
        <View style={s.shelfBucketRow}>
          {/* Each id with its small word label under it. */}
          <View style={s.idCol}>
            <Text style={[s.bShelfLead, b.scanned && s.bDone]}>
              {(b.shelf || 'none').toUpperCase()}
            </Text>
            <Text style={s.idWord}>SHELF</Text>
          </View>
          <View style={[s.idCol, s.idColRight]}>
            <Text style={[s.bIdRight, b.scanned && s.bDone]}>
              {b.bucketId.toUpperCase()} ({Math.round(b.qty)})
            </Text>
            <Text style={s.idWord}>BUCKET</Text>
          </View>
        </View>
        {/* Variety and stem length, with Info (replace / not found) on the same line (not beside the
            shelf and bucket). */}
        <View style={s.metaReplaceRow}>
          <Text style={[s.bMeta, s.metaGrow, b.scanned && s.bDone]}>
            {bucketMeta(b.variety, b.stemLength)}
            {b.notFound ? <Text style={s.bNotFound}>  · not found</Text> : null}
          </Text>
          {!b.scanned ? (
            <Pressable
              onPress={() => onReplace(b)}
              disabled={replacingId !== null}
              hitSlop={8}
              style={s.replaceBtn}
            >
              {replacingId === b.id ? (
                <ActivityIndicator size="small" color={COLORS.text} />
              ) : (
                <>
                  <Ionicons name="information-circle-outline" size={14} color={COLORS.text} />
                  <Text style={s.changeLink}>Info</Text>
                </>
              )}
            </Pressable>
          ) : null}
        </View>
      </View>
    </View>
  );
  return (
    <View style={dimmed ? s.dimmed : undefined}>
    <Wrap style={inTrip ? s.oplFlat : undefined}>
      {/* In its trip's card the order line carries the team and the trip shows the
          progress (at "Your stop"); a picklist card on its own keeps both. */}
      {!inTrip ? (
        <>
          <View style={s.oplTagRow}>
            {trip ? (
              <View style={[s.oplTag, trip.confirmed ? s.oplTagConfirmed : s.oplTagPlanned]}>
                {line ? <View style={[s.lineDot, { backgroundColor: line.color }]} /> : null}
                <Ionicons
                  name={trip.onTrip ? 'car' : 'calendar-outline'}
                  size={12}
                  color={trip.confirmed ? (COLORS.textOnPrimary ?? '#fff') : COLORS.text}
                />
                <Text style={[s.oplTagText, trip.confirmed ? s.oplTagTextConfirmed : null]}>
                  {trip.label} · {trip.onTrip ? (trip.confirmed ? 'Confirmed' : 'Planned') : 'Scheduled'}
                </Text>
              </View>
            ) : (
              <View style={s.oplTagUnsched}>
                <Ionicons name="ellipse-outline" size={11} color={COLORS.textMuted} />
                <Text style={s.oplTagUnschedText}>Unscheduled</Text>
              </View>
            )}
          </View>
          <View style={s.oplHead}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={s.oplMeta}>
                {opl.scanned}/{opl.total} scanned
              </Text>
            </View>
            <Text style={s.pct}>{pct}%</Text>
          </View>
          <View style={s.track}>
            <View style={[s.fill, { width: `${pct}%` }]} />
          </View>
          <View style={s.divider} />
        </>
      ) : null}
      {toScan.map(bucketRow)}
      {done.length ? (
        <Pressable
          onPress={() => setShowScanned((v) => !v)}
          style={s.doneToggle}
          accessibilityRole="button"
          accessibilityState={{ expanded: showScanned }}
        >
          <Ionicons name="checkmark-done" size={16} color={SHELVED_GREEN} />
          <Text style={s.doneToggleText}>{done.length} scanned</Text>
          <Ionicons name={showScanned ? 'chevron-up' : 'chevron-down'} size={14} color={SHELVED_GREEN} />
        </Pressable>
      ) : null}
      {showScanned ? done.map(bucketRow) : null}
    </Wrap>
    </View>
  );
}

/** The team chip. `fill`: the packing line's colour as its background (white
 *  text) instead of a small dot — the colour key without a separate legend. */
function TeamChip({ team, color, fill }: { team?: string; color?: string; fill?: boolean }) {
  if (!team) return null;
  const filled = fill && !!color;
  return (
    <View style={[s.oplTag, s.oplTagPlanned, filled && { backgroundColor: color, borderColor: color }]}>
      {color && !filled ? <View style={[s.lineDot, { backgroundColor: color }]} /> : null}
      <Ionicons name="people-outline" size={12} color={filled ? '#FFFFFF' : COLORS.text} />
      <Text style={[s.oplTagText, filled && { color: '#FFFFFF' }]} numberOfLines={1}>
        {team}
      </Text>
    </View>
  );
}

function CompletedCard({
  o,
  team,
  line,
  footer,
}: {
  o: TrolleyOpl;
  team?: string;
  line?: LineColor;
  footer: ReactNode;
}) {
  return (
    <Card>
      {team ? (
        <View style={s.oplTagRow}>
          <TeamChip team={team} color={line?.color} />
        </View>
      ) : null}
      <View style={s.oplHead}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={s.bId} numberOfLines={1}>
            {o.orderName}
          </Text>
          <Text style={s.oplMeta} numberOfLines={1}>
            Trolley {o.trolleys.join(', ') || '—'}
          </Text>
        </View>
        <View style={s.badge}>
          <Text style={s.badgeTxt}>{o.buckets.length}</Text>
        </View>
      </View>
      <View style={s.divider} />
      {o.buckets.map((b: ReqBucket) => (
        <View key={b.id} style={s.bRow}>
          <Ionicons name="checkmark-circle" size={16} color={COLORS.success ?? '#12B76A'} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={s.bId} numberOfLines={1}>
              {b.bucketId}
            </Text>
            <Text style={s.bMeta} numberOfLines={1}>
              {bucketMeta(b.variety, b.stemLength)}
            </Text>
            {!!b.shelf && (
              <Text style={s.bShelf} numberOfLines={1}>
                {b.shelf}
              </Text>
            )}
          </View>
          <Text style={[s.bQty, s.bTrolley]} numberOfLines={1}>
            {b.trolleyId || ''}
          </Text>
        </View>
      ))}
      <View style={s.divider} />
      {footer}
    </Card>
  );
}

function TrolleyTab({
  items,
  allScanned,
  syncingOpl,
  oplTeam,
  oplLine,
  onLoad,
  scanned,
  total,
}: {
  items: TrolleyOpl[];
  /** Every requested bucket is on a trolley: one button loads them all. */
  allScanned: boolean;
  syncingOpl: string | null;
  oplTeam: Record<string, string>;
  oplLine: Record<string, LineColor>;
  onLoad: (opls: TrolleyOpl[]) => void;
  /** The tab's count: buckets on trolleys of those requested (not yet on a truck). */
  scanned: number;
  total: number;
}) {
  if (!items.length) {
    // An order is listed here once every one of its buckets is on a trolley.
    return (
      <Card>
        <View style={s.empty}>
          <Ionicons name="cart-outline" size={26} color={COLORS.textMuted} />
          <Text style={s.emptyTitle}>{scanned ? 'No order fully on a trolley yet' : 'Nothing on a trolley yet'}</Text>
          {scanned ? (
            <Text style={s.emptyHint}>
              {scanned} of {total} requested buckets scanned — an order shows here once all its buckets are on a
              trolley.
            </Text>
          ) : null}
        </View>
      </Card>
    );
  }
  // Loaded onto the truck but not dispatched yet: stays here (the dashboard sends it
  // on its way), so only the orders still on trolleys can be loaded.
  const toLoad = items.filter((o) => !o.loadedToTruck);
  const bulk = allScanned && toLoad.length > 1;
  return (
    <>
      {bulk ? (
        <Card>
          <Button
            label="Load to truck"
            iconLeft="car-outline"
            loading={syncingOpl === '*'}
            disabled={!!syncingOpl}
            onPress={() => onLoad(toLoad)}
          />
        </Card>
      ) : null}
      {items.map((o) => (
        <CompletedCard
          key={o.oplName}
          o={o}
          team={oplTeam[o.oplName]}
          line={oplLine[o.oplName]}
          footer={
            o.loadedToTruck ? (
              <View style={s.loadedInline}>
                <Ionicons name="car-outline" size={16} color={COLORS.text} />
                <Text style={s.loadedInlineText}>Loaded on truck · waiting for dispatch</Text>
              </View>
            ) : bulk ? (
              <View style={s.loadedInline}>
                <Ionicons name="cart-outline" size={16} color={COLORS.text} />
                <Text style={s.loadedInlineText}>On trolley</Text>
              </View>
            ) : (
              <Button
                label="Load to truck"
                iconLeft="car-outline"
                loading={syncingOpl === o.oplName}
                disabled={!!syncingOpl}
                onPress={() => onLoad([o])}
              />
            )
          }
        />
      ))}
    </>
  );
}

function InTransitTab({
  hub,
  items,
  oplTeam,
  oplLine,
  trips,
  arrivals,
  deliveryDate,
  online,
  loading,
  onArrival,
}: {
  /** The transfer hub (Kapkolia). */
  hub: string;
  items: TrolleyOpl[];
  oplTeam: Record<string, string>;
  oplLine: Record<string, LineColor>;
  /** This farm's trips on the road (dispatched, not received). */
  trips: CompletedTrip[];
  arrivals: Record<string, TripArrival>;
  deliveryDate: string;
  online: boolean;
  /** Trip plan is being pulled: skeletons while nothing is shown yet. */
  loading: boolean;
  onArrival: (tripId: string, action: 'status' | 'arrive' | 'complete') => Promise<boolean>;
}) {
  // Grouped per truck: each truck's card lists its own orders and buckets, then its
  // "arrived" button. Picklists whose truck isn't known yet get a card of their own.
  const orderRows = (opls: TrolleyOpl[]) =>
    opls.map((o) => (
      <View key={o.oplName} style={s.groupInTrip}>
        {/* Team, order name, customer, then the OPL and its buckets. */}
        <View style={s.groupLine}>
          <Text style={[s.groupHdr, s.groupNames]} numberOfLines={1}>
            {o.orderName}
          </Text>
          <TeamChip team={oplTeam[o.oplName]} color={oplLine[o.oplName]?.color} fill />
        </View>
        {o.customer ? (
          <Text style={s.groupCustomer} numberOfLines={1}>
            {o.customer}
          </Text>
        ) : null}
        <Text style={s.transitOpl} numberOfLines={1}>
          {o.oplName}
        </Text>
        {o.buckets
          .filter((b) => !b.notFound)
          .map((b, i) => (
            <View key={b.id} style={[s.bRow, i > 0 && s.bRowSep]}>
              <Ionicons name="car-outline" size={16} color={COLORS.textMuted} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={s.bShelfLead} numberOfLines={1}>
                  {b.bucketId.toUpperCase()} ({Math.round(b.qty)})
                </Text>
                <Text style={s.bMeta} numberOfLines={1}>
                  {bucketMeta(b.variety, b.stemLength)}
                </Text>
              </View>
            </View>
          ))}
      </View>
    ));
  const onTruck = new Set<string>();
  // Trucks still on the road first, the one that left earliest on top; trucks that
  // have arrived at Kapkolia after them.
  const ordered = [...trips].sort((a, b) => {
    const aIn = arrivals[a.tripId]?.arrivedAt ? 1 : 0;
    const bIn = arrivals[b.tripId]?.arrivedAt ? 1 : 0;
    return aIn - bIn || (a.leftAt || '').localeCompare(b.leftAt || '') || a.tripId.localeCompare(b.tripId);
  });
  const tripCards = ordered.map((t) => {
    const mine = items.filter((o) => (t.orders ?? []).some((x) => x.opl === o.oplName));
    mine.forEach((o) => onTruck.add(o.oplName));
    return (
      <TripArrivalCard
        key={t.tripId}
        trip={t}
        arrival={arrivals[t.tripId]}
        deliveryDate={deliveryDate}
        online={online}
        onArrival={onArrival}
        hubName={hub}
      >
        {orderRows(mine)}
      </TripArrivalCard>
    );
  });
  const noTruck = items.filter((o) => !onTruck.has(o.oplName));
  if (!items.length && !trips.length) {
    if (loading) return <SkeletonCards cards={2} />;
    return (
      <Card>
        <View style={s.empty}>
          <Ionicons name="car-outline" size={26} color={COLORS.textMuted} />
          <Text style={s.emptyTitle}>Nothing in transit</Text>
        </View>
      </Card>
    );
  }
  return (
    <>
      {tripCards}
      {noTruck.length ? (
        <Card>
          <View style={s.tripHead}>
            <View style={s.tripTruck}>
              <Ionicons name="car" size={16} color={COLORS.textMuted} />
              <Text style={s.tripTruckText} numberOfLines={1}>
                Truck not recorded
              </Text>
            </View>
          </View>
          {orderRows(noTruck)}
        </Card>
      ) : null}
    </>
  );
}

/** After transit: did this farm's dispatched buckets get shelved at the hub? One card
 *  per recent trip, buckets still waiting first, then shelved ones with shelf and time. */
function ShelvedTab({
  trips,
  hub,
  loading,
  online,
  day,
}: {
  trips: ShelvedTrip[];
  hub: string;
  loading: boolean;
  online: boolean;
  /** Selected delivery date ("Tomorrow", "Today", "Fri 3 Oct"); '' = every date. */
  day: string;
}) {
  // Two tabs: Shelved / Not shelved. Opens on Not shelved while anything waits.
  const [view, setView] = useState<'shelved' | 'waiting' | null>(null);
  const where = hub || 'Kapkolia';
  const time = (iso: string) => (iso ? `${iso.slice(5, 10).split('-').reverse().join('/')} ${iso.slice(11, 16)}` : '');

  if (!trips.length) {
    if (loading && online) return <SkeletonCards cards={2} rows={4} />;
    return (
      <Card>
        <View style={s.empty}>
          <Ionicons name="file-tray-full-outline" size={26} color={COLORS.textMuted} />
          <Text style={s.emptyTitle}>
            {loading
              ? 'Loading…'
              : !online
                ? 'Connect to see shelved buckets'
                : day
                  ? `No buckets dispatched for ${day.toLowerCase() === 'today' || day.toLowerCase() === 'tomorrow' ? day.toLowerCase() : day}'s orders yet`
                  : 'No dispatched buckets yet'}
          </Text>
        </View>
      </Card>
    );
  }

  // A truck's buckets grouped by order (and its customer), in the order they come.
  const byOrder = (rows: ShelvedTrip['buckets']) => {
    const groups: { orderName: string; customer: string; buckets: ShelvedTrip['buckets'] }[] = [];
    for (const b of rows) {
      let g = groups.find((x) => x.orderName === b.orderName);
      if (!g) groups.push((g = { orderName: b.orderName, customer: b.customer, buckets: [] }));
      g.buckets.push(b);
    }
    return groups;
  };
  const total = trips.reduce((n, t) => n + t.total, 0);
  const shelved = trips.reduce((n, t) => n + t.shelved, 0);
  const waiting = total - shelved;
  const tab = view ?? (waiting ? 'waiting' : 'shelved');
  const rowsOf = (t: ShelvedTrip) => t.buckets.filter((b) => (tab === 'shelved' ? b.shelved : !b.shelved));
  const anyRows = trips.some((t) => rowsOf(t).length);
  return (
    <>
      <Card>
        <View style={s.arrivalRow}>
          <Text style={[s.routeLabel, s.arrivalLabel]} numberOfLines={1}>
            Shelved at {where}
          </Text>
          <Text style={s.arrivalCount}>
            {shelved} / {total}
          </Text>
        </View>
        <ProgressBar value={total ? shelved / total : 0} />
        <View style={s.reasonRow}>
          {[
            { on: tab === 'shelved', label: `Shelved (${shelved})`, press: () => setView('shelved') },
            { on: tab === 'waiting', label: `Not shelved (${waiting})`, press: () => setView('waiting') },
          ].map((c) => (
            <Pressable key={c.label} onPress={c.press} style={[s.reasonChip, c.on && s.reasonChipOn]}>
              <Text style={[s.reasonText, c.on && s.reasonTextOn]}>{c.label}</Text>
            </Pressable>
          ))}
        </View>
      </Card>

      {!anyRows ? (
        <Card>
          <View style={s.empty}>
            <Ionicons
              name={tab === 'waiting' ? 'checkmark-done-outline' : 'file-tray-outline'}
              size={26}
              color={COLORS.textMuted}
            />
            <Text style={s.emptyTitle}>
              {tab === 'waiting' ? 'Every bucket is shelved' : 'No bucket shelved yet'}
            </Text>
          </View>
        </Card>
      ) : null}

      {trips.map((t) => {
        const rows = rowsOf(t);
        if (!rows.length) return null;
        const done = t.shelved === t.total;
        return (
          <Card key={t.tripId}>
            <View style={s.tripHead}>
              <View style={s.tripTruck}>
                <Ionicons name="car" size={16} color={COLORS.text} />
                <Text style={s.tripTruckText} numberOfLines={1}>
                  {t.vehicle || 'Truck'}
                </Text>
              </View>
              <View style={[s.tripPill, done ? s.tripPillConfirmed : s.tripPillDraft]}>
                <Text style={[s.tripPillText, done ? s.tripPillTextConfirmed : s.tripPillTextDraft]}>
                  {done ? 'All shelved' : `${t.shelved}/${t.total} shelved`}
                </Text>
              </View>
            </View>
            <Text style={s.tripMeta} numberOfLines={1}>
              {[
                t.tripId,
                t.dispatchedAt ? `left ${time(t.dispatchedAt)}` : '',
                t.arrivedAt ? `arrived ${time(t.arrivedAt)}` : '',
                t.status === 'Received' ? 'received' : '',
              ]
                .filter(Boolean)
                .join(' · ')}
            </Text>
            {/* Per order (customer under it), then that order's buckets. */}
            {byOrder(rows).map((g) => (
              <View key={`${t.tripId}-${g.orderName}`} style={s.groupInTrip}>
                <Text style={[s.groupHdr, s.groupNames]} numberOfLines={1}>
                  {g.orderName}
                </Text>
                {g.customer ? (
                  <Text style={s.groupCustomer} numberOfLines={1}>
                    {g.customer}
                  </Text>
                ) : null}
                {g.buckets.map((b) => (
                  <View key={`${t.tripId}-${b.opl}-${b.bucketId}`} style={s.shelvedRow}>
                    <Ionicons
                      name={b.shelved ? 'checkmark-circle' : 'time-outline'}
                      size={18}
                      color={b.shelved ? COLORS.text : COLORS.warn}
                    />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={s.bId} numberOfLines={1}>
                        {b.bucketId.toUpperCase()}
                      </Text>
                    </View>
                    <View style={s.shelvedWhere}>
                      {b.shelved ? (
                        // Shelved: its shelf in a green pill.
                        <View style={s.shelvedPill}>
                          <Ionicons name="checkmark" size={12} color={SHELVED_GREEN} />
                          <Text style={s.shelvedPillText} numberOfLines={1}>
                            {b.shelf || 'Shelved'}
                          </Text>
                        </View>
                      ) : (
                        <Text style={[s.shelvedState, s.shelvedStateWaiting]} numberOfLines={1}>
                          Not shelved
                        </Text>
                      )}
                      {b.shelved && b.shelvedAt ? <Text style={s.bMeta}>{time(b.shelvedAt)}</Text> : null}
                    </View>
                  </View>
                ))}
              </View>
            ))}
          </Card>
        );
      })}
    </>
  );
}

/** A trip on the road to the hub: confirm the truck arrived, watch its buckets get
 *  shelved there, then complete the trip — only once every bucket is shelved. */
function TripArrivalCard({
  trip,
  arrival,
  deliveryDate,
  online,
  onArrival,
  hubName,
  children,
}: {
  trip: CompletedTrip;
  /** The transfer hub's name, until this trip's own arrival details load. */
  hubName?: string;
  arrival?: TripArrival;
  /** This truck's orders and buckets, shown above its arrival button. */
  children?: ReactNode;
  /** Delivery date on screen ('' = every date): only its buckets are counted / listed. */
  deliveryDate: string;
  online: boolean;
  onArrival: (tripId: string, action: 'status' | 'arrive' | 'complete') => Promise<boolean>;
}) {
  const [ask, setAsk] = useState<'complete' | null>(null);
  // Each truck starts folded: tap its header to show (or hide again) its orders.
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // The hub by name (Kapkolia), never a generic "the packhouse".
  const hub = arrival?.hub || hubName || 'Kapkolia';
  const arrived = !!arrival?.arrivedAt;
  // The buckets for the delivery date on screen; Complete still needs the whole trip
  // shelved (the server checks every bucket on the truck).
  const forDay = (arrival?.buckets ?? []).filter((b) => !deliveryDate || !b.deliveryDate || b.deliveryDate === deliveryDate);
  const dated = !!deliveryDate && !!arrival?.buckets?.length;
  const total = dated ? forDay.length : (arrival?.total ?? 0);
  const shelved = dated ? forDay.filter((b) => b.shelved).length : (arrival?.shelved ?? 0);
  const waiting = dated ? forDay.filter((b) => !b.shelved && !b.offTruck).map((b) => b.bucket) : (arrival?.waiting ?? []);
  const otherWaiting = Math.max(0, (arrival?.waiting.length ?? 0) - waiting.length);
  const allShelved = !!arrival && (arrival.total ?? 0) > 0 && arrival.waiting.length === 0 && (arrival.shelved ?? 0) > 0;
  const time = (iso: string) => (iso ? iso.slice(11, 16) : '');

  const run = async (action: 'status' | 'arrive' | 'complete') => {
    setBusy(true);
    const ok = await onArrival(trip.tripId, action);
    setBusy(false);
    if (ok || action !== 'status') setAsk(null);
  };

  return (
    <Card>
      {/* Tap anywhere on the truck's top part (name and check marks) to open or close it. */}
      <Pressable onPress={() => setOpen((v) => !v)} accessibilityRole="button" accessibilityState={{ expanded: open }}>
      <View style={s.tripHead}>
        <View style={s.tripTruck}>
          <Ionicons name="car" size={16} color={COLORS.text} />
          <Text style={s.tripTruckText} numberOfLines={1}>
            {trip.vehicle || 'Truck'}
          </Text>
        </View>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={COLORS.textMuted} />
      </View>

      {/* Where the truck is, as check marks: in transit, then arrived — arrival is
          confirmed by itself once shelving at the hub starts (no button). */}
      <View style={s.stageList}>
        <View style={s.stageRow}>
          <Ionicons name="checkmark-circle" size={18} color={SHELVED_GREEN} />
          <Text style={s.stageText}>In transit{trip.leftAt ? ` · left ${time(trip.leftAt)}` : ''}</Text>
        </View>
        <View style={s.stageRow}>
          <Ionicons
            name={arrived ? 'checkmark-circle' : 'ellipse-outline'}
            size={18}
            color={arrived ? SHELVED_GREEN : COLORS.textMuted}
          />
          <Text style={[s.stageText, !arrived && s.stageTextPending]}>
            Arrived at {hub}
            {arrived ? ` · ${time(arrival?.arrivedAt ?? '')}` : ''}
          </Text>
        </View>
      </View>

      </Pressable>

      {open ? children : null}

      {arrived ? (
        <>
          <View style={s.divider} />
          <View style={s.arrivalRow}>
            <Text style={[s.routeLabel, s.arrivalLabel]} numberOfLines={1}>
              Shelved at {hub}
            </Text>
            <Text style={s.arrivalCount}>
              {shelved} / {total}
            </Text>
          </View>
          <ProgressBar value={total ? shelved / total : 0} />
          {waiting.length ? (
            <>
              <Text style={s.arrivalHint}>
                Still on the truck — shelve {waiting.length === 1 ? 'it' : 'them'} at {hub}:
              </Text>
              <View style={s.reasonRow}>
                {waiting.slice(0, 24).map((b) => (
                  <View key={b} style={s.reasonChip}>
                    <Text style={s.reasonText}>{b}</Text>
                  </View>
                ))}
                {waiting.length > 24 ? <Text style={s.arrivalHint}>+{waiting.length - 24} more</Text> : null}
              </View>
            </>
          ) : allShelved ? (
            <Text style={s.arrivalHint}>Every bucket is shelved — the trip can be completed.</Text>
          ) : otherWaiting ? (
            <Text style={s.arrivalHint}>
              {otherWaiting} bucket{otherWaiting === 1 ? '' : 's'} for other delivery dates still on the truck — the
              trip completes once they are shelved too.
            </Text>
          ) : null}
          <View style={[s.repActions, { justifyContent: 'flex-end' }]}>
            <Button
              label="Check"
              variant="outline"
              iconLeft="refresh"
              size="sm"
              disabled={!online || busy}
              onPress={() => run('status')}
            />
            <Button
              label="Complete"
              iconLeft="checkmark-done"
              size="sm"
              disabled={!online || busy || !allShelved}
              onPress={() => setAsk('complete')}
            />
          </View>
        </>
      ) : null}



      <Dialog
        visible={ask === 'complete'}
        onClose={() => setAsk(null)}
        busy={busy}
        icon={{ name: 'checkmark-done', tone: 'success' }}
        title="Complete the trip?"
        subtitle={`All ${total} bucket${total === 1 ? '' : 's'} from ${trip.tripId} are shelved at ${hub}. The trip is marked received.`}
        actions={
          <>
            <Button label="Cancel" variant="outline" onPress={() => setAsk(null)} disabled={busy} style={{ flex: 1 }} />
            <Button label="Complete trip" loading={busy} onPress={() => run('complete')} style={{ flex: 1 }} />
          </>
        }
      />
    </Card>
  );
}

/** Upcoming planned trips coming to collect from this farm — so the attendant
 *  can pre-stage trolleys before the truck arrives. */
/** Visual treatment per stop status. */
const STOP_UI: Record<
  PlannedTripStop['status'],
  { label: string; color: string; icon: keyof typeof Ionicons.glyphMap }
> = {
  waiting: { label: 'Not staged', color: COLORS.danger, icon: 'ellipse-outline' },
  loading: { label: 'Staging', color: COLORS.warn, icon: 'time-outline' },
  ready: { label: 'Trolleys ready', color: COLORS.text, icon: 'checkmark-circle' },
  transit: { label: 'On the truck', color: '#2E90FA', icon: 'car' },
  done: { label: 'Delivered', color: COLORS.textMuted, icon: 'checkmark-done-circle' },
};


function TripCard({
  trip,
  route,
  scanned = 0,
  scanTotal = 0,
  children,
}: {
  trip: PlannedTrip;
  /** Where this farm's buckets go on the trip ("Chepsito → Kapkolia"): the
   *  heading of this farm's stop section. */
  route?: string;
  /** This farm's buckets on the trip scanned so far, of `scanTotal`: the
   *  progress shown at "Your stop". */
  scanned?: number;
  scanTotal?: number;
  /** The trip's orders, shown in the card between the route and "Your stop". */
  children?: ReactNode;
}) {
  const yourStop = (trip.stops ?? []).find((st) => st.isYou);
  const ui = yourStop ? (STOP_UI[yourStop.status] ?? STOP_UI.waiting) : null;
  const pct = scanTotal > 0 ? Math.round((scanned / scanTotal) * 100) : 0;
  return (
    <Card>
      {/* Truck and trip number first; nothing the farm doesn't act on. */}
      <View style={s.tripHead}>
        <View style={s.tripTruck}>
          <Ionicons name="car" size={16} color={COLORS.text} />
          <Text style={s.tripTruckText}>
            {trip.vehicle || 'No truck yet'}
            {trip.run ? `  ·  Trip ${trip.run}${trip.runs > 1 ? ` of ${trip.runs}` : ''}` : ''}
          </Text>
        </View>
        <View style={[s.tripPill, trip.current ? s.tripPillConfirmed : s.tripPillDraft]}>
          <Text style={[s.tripPillText, trip.current ? s.tripPillTextConfirmed : s.tripPillTextDraft]}>
            {trip.current ? 'Current' : 'Next'}
          </Text>
        </View>
      </View>

      {children}

      <View style={s.divider} />
      {/* Only this farm's stop: other farms' transfers on the same truck stay with them. */}
      <View style={s.yourStopHead}>
        <Text style={[s.routeLabel, s.stopRoute]}>
          {route || 'Your stop'}
        </Text>
        {ui ? <Text style={[s.yourStopStatus, { color: ui.color }]}>{ui.label}</Text> : null}
      </View>
      {scanTotal > 0 ? (
        <>
          <View style={s.yourStopScan}>
            <Text style={s.oplMeta}>
              {scanned}/{scanTotal} scanned
            </Text>
            <Text style={s.pct}>{pct}%</Text>
          </View>
          <View style={s.track}>
            <View style={[s.fill, { width: `${pct}%` }]} />
          </View>
        </>
      ) : null}
      {/* No button: the stop closes by itself once all its buckets are on the truck. */}
      {trip.yourStopClosed ? (
        <Text style={s.tripClosed}>Stop closed — the truck has left this farm.</Text>
      ) : null}
    </Card>
  );
}

/** A tab's closing line: how many requested buckets have finished this stage. */
function StageSummary({
  icon,
  label,
  done,
  total,
  items,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  done: number;
  total: number;
  /** The buckets that finished this stage: tap the summary to list them, checked. */
  items?: { key: string; label: string; meta: string; sub?: string }[];
}) {
  const [open, setOpen] = useState(false);
  // Shown even at 0 (e.g. everything already on a truck): the tab always ends with it.
  const complete = total > 0 && done >= total;
  const canOpen = !!items?.length;
  return (
    <View style={s.summaryStage}>
      {/* The whole stage (title, count and bar) opens and closes its list. */}
      <Pressable
        onPress={() => canOpen && setOpen((v) => !v)}
        disabled={!canOpen}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
      >
      <View style={s.summaryRow}>
        <Ionicons name={complete ? 'checkmark-circle' : icon} size={18} color={complete ? SHELVED_GREEN : COLORS.text} />
        <Text style={s.summaryLabel}>
          {label}
        </Text>
        <Text style={[s.summaryCount, complete && { color: SHELVED_GREEN }]}>
          {done}/{total}
        </Text>
        {canOpen ? <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={16} color={COLORS.textMuted} /> : null}
      </View>
      <ProgressBar value={total ? Math.min(1, done / total) : 0} />
      </Pressable>
      {open
        ? items?.map((it, i) => (
            <View key={it.key} style={[s.bRow, i > 0 && s.bRowSep]}>
              <Ionicons name="checkmark-circle" size={18} color={SHELVED_GREEN} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={s.bIdRight}>
                  {it.label}
                </Text>
                <Text style={s.bMeta}>
                  {it.meta}
                </Text>
                {it.sub ? (
                  <Text style={s.bMetaSub}>
                    {it.sub}
                  </Text>
                ) : null}
              </View>
            </View>
          ))
        : null}
    </View>
  );
}

/** Text and border of the "shelved" pill: a darker green that reads on its pale fill. */
const SHELVED_GREEN = '#067647';

const s = StyleSheet.create({
  // Room above and left of each trip card for its floating number.
  step: { position: 'relative', marginTop: spacing.md, marginLeft: spacing.md },
  stepDot: {
    width: 28,
    height: 28,
    borderRadius: borderRadius.full,
    borderWidth: 2,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepDotFloat: { position: 'absolute', top: -10, left: -10, zIndex: 2, elevation: 3 },
  stepDotCurrent: { borderColor: COLORS.text, backgroundColor: COLORS.text },
  stepNum: { fontFamily: fontFamily.bold, fontSize: fontSize.sm, color: COLORS.textMuted },
  stepNumCurrent: { color: COLORS.surface },
  stepBody: { flex: 1, minWidth: 0, paddingBottom: spacing.lg },
  stepBodyLater: { opacity: 0.75 },
  // An order inside its trip's card: a section under a thin rule, its picklists
  // flat rather than cards of their own.
  groupInTrip: {
    paddingTop: spacing.sm,
    marginTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.border,
  },
  oplFlat: { paddingTop: spacing.xs, marginBottom: spacing.sm },
  tripAllScanned: {
    fontFamily: fontFamily.medium,
    fontSize: fontSize.xs,
    color: COLORS.textMuted,
    marginTop: spacing.xs,
    marginLeft: spacing.xs,
  },
  shelvedRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm },
  shelvedWhere: { alignItems: 'flex-end', maxWidth: '45%' },
  shelvedState: { fontFamily: fontFamily.semiBold, fontSize: fontSize.sm, color: COLORS.text },
  shelvedStateWaiting: { color: COLORS.warn },
  // Requests trip card
  yourStopHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  stopRoute: { flexShrink: 1 },
  yourStopStatus: { fontFamily: fontFamily.semiBold, fontSize: fontSize.sm },
  yourStopScan: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginTop: spacing.xs },
  groupLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  groupNames: { flex: 1, minWidth: 0 },
  // Scanned buckets: folded under one green line, struck through when shown.
  bDone: { color: SHELVED_GREEN, textDecorationLine: 'line-through' },
  doneToggle: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: spacing.sm },
  doneToggleText: { fontFamily: fontFamily.semiBold, fontSize: fontSize.sm, color: SHELVED_GREEN },
  shelvedPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    maxWidth: '100%',
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: SHELVED_GREEN,
    backgroundColor: '#ECFDF3',
  },
  shelvedPillText: { fontFamily: fontFamily.semiBold, fontSize: fontSize.sm, color: SHELVED_GREEN, flexShrink: 1 },
  arrivalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  arrivalLabel: { flexShrink: 1, marginBottom: 0 },
  arrivalCount: { fontFamily: fontFamily.bold, fontSize: fontSize.sm, color: COLORS.text },
  arrivalHint: { fontFamily: fontFamily.medium, fontSize: fontSize.xs, color: COLORS.textMuted, marginTop: spacing.sm },
  tripClosed: { fontFamily: fontFamily.medium, fontSize: fontSize.xs, color: COLORS.textMuted, marginTop: spacing.sm },
  repNone: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.sm,
    color: COLORS.textMuted,
    marginVertical: spacing.sm,
  },
  bNotFound: { fontFamily: fontFamily.medium, fontSize: fontSize.xs, color: COLORS.danger },
  scroll: { paddingBottom: 40 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  headerBtn: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  headerBtnBusy: { opacity: 0.6 },
  offline: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.xs,
    color: COLORS.textMuted,
    marginBottom: spacing.sm,
  },
  // Above the scroll view, so the farm badge on its top edge sits in the page
  // padding and nothing clips it.
  scanWrap: { position: 'relative' },
  farmEdge: {
    position: 'absolute',
    top: -11,
    right: spacing.md,
    maxWidth: '55%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surfaceAlt,
    zIndex: 2,
    elevation: 4,
  },
  scanHead: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginBottom: spacing.xs,
    minHeight: 26,
  },
  scanLabel: {
    fontFamily: fontFamily.semiBold,
    fontSize: fontSize.xs,
    color: COLORS.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  trolleyChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 1,
    paddingVertical: 3,
    paddingLeft: spacing.sm,
    paddingRight: 4,
    borderRadius: 10,
    backgroundColor: COLORS.surfaceAlt,
  },
  trolleyChipText: { fontFamily: fontFamily.semiBold, fontSize: fontSize.xs, color: COLORS.text, flexShrink: 1 },
  changeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingVertical: 2,
    paddingHorizontal: 6,
    borderRadius: 8,
    backgroundColor: COLORS.surface,
  },
  changeLink: { fontFamily: fontFamily.medium, fontSize: fontSize.xs, color: COLORS.text },
  groupHdr: {
    fontFamily: fontFamily.bold,
    fontSize: fontSize.sm,
    color: COLORS.text,
    marginTop: spacing.md,
    marginBottom: 2,
    marginLeft: spacing.xs,
  },
  groupHdrDim: { color: COLORS.textMuted },
  sectionHdr: {
    fontFamily: fontFamily.semiBold,
    fontSize: fontSize.xs,
    color: COLORS.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: spacing.lg,
    marginBottom: spacing.xs,
    marginLeft: spacing.xs,
  },
  dimmed: { opacity: 0.5 },
  lineDot: { width: 10, height: 10, borderRadius: 5 },
  oplTagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: spacing.xs },
  oplTag: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 1,
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: borderRadius.full,
  },
  oplTagConfirmed: { backgroundColor: COLORS.text },
  oplTagPlanned: { backgroundColor: COLORS.surfaceAlt },
  oplTagText: { fontFamily: fontFamily.semiBold, fontSize: scaleFont(11), color: COLORS.text, flexShrink: 1 },
  oplTagTextConfirmed: { color: COLORS.textOnPrimary ?? '#fff' },
  oplTagUnsched: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: borderRadius.full,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.border,
  },
  oplTagUnschedText: { fontFamily: fontFamily.medium, fontSize: scaleFont(11), color: COLORS.textMuted },
  groupCustomer: {
    fontFamily: fontFamily.medium,
    fontSize: fontSize.xs,
    color: COLORS.textMuted,
    marginBottom: spacing.xs,
    marginLeft: spacing.xs,
  },
  oplHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  oplMeta: { fontFamily: fontFamily.regular, fontSize: fontSize.xs, color: COLORS.textMuted },
  pct: { fontFamily: fontFamily.bold, fontSize: fontSize.md, color: COLORS.text },
  track: {
    height: 6,
    borderRadius: 3,
    backgroundColor: COLORS.surfaceAlt,
    marginTop: spacing.sm,
    overflow: 'hidden',
  },
  fill: { height: 6, backgroundColor: COLORS.text },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: COLORS.border,
    marginVertical: spacing.sm,
  },
  bRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 6 },
  bRowSep: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLORS.border, paddingTop: spacing.sm },
  bId: { fontFamily: fontFamily.bold, fontSize: fontSize.sm, color: COLORS.text },
  bMeta: { fontFamily: fontFamily.medium, fontSize: fontSize.sm, color: COLORS.textSecondary },
  bShelf: { fontFamily: fontFamily.medium, fontSize: fontSize.xs, color: COLORS.textMuted, marginTop: 1 },
  // Shelf and bucket ids: same size, upper case, each after a small word label.
  bShelfLead: { fontFamily: fontFamily.bold, fontSize: fontSize.md, color: COLORS.text, flexShrink: 1 },
  idWord: { fontFamily: fontFamily.medium, fontSize: scaleFont(9), color: COLORS.textMuted, letterSpacing: 0.4 },
  idCol: { flexShrink: 1, minWidth: 0 },
  idColRight: { marginLeft: 'auto', alignItems: 'flex-end' },
  metaReplaceRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  metaGrow: { flex: 1, minWidth: 0 },
  shelfBucketRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  bIdRight: { fontFamily: fontFamily.bold, fontSize: fontSize.md, color: COLORS.text },
  bQty: { fontFamily: fontFamily.semiBold, fontSize: fontSize.xs, color: COLORS.textSecondary },
  bTrolley: { maxWidth: '35%' },
  replaceBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: borderRadius.sm,
    minHeight: 24,
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: borderRadius.full,
    backgroundColor: COLORS.text,
  },
  badgeTxt: { fontFamily: fontFamily.bold, fontSize: scaleFont(11), color: COLORS.textOnPrimary ?? '#fff' },
  // Trips tab
  tripHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  tripTruck: { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 },
  tripTruckText: { fontFamily: fontFamily.semiBold, fontSize: fontSize.md, color: COLORS.text, flexShrink: 1 },
  tripPill: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: borderRadius.full },
  tripPillConfirmed: { backgroundColor: COLORS.text },
  tripPillDraft: { backgroundColor: COLORS.surfaceAlt },
  tripPillText: { fontFamily: fontFamily.bold, fontSize: scaleFont(10), letterSpacing: 0.4, textTransform: 'uppercase' },
  tripPillTextConfirmed: { color: COLORS.textOnPrimary ?? '#fff' },
  tripPillTextDraft: { color: COLORS.textMuted },
  routeLabel: {
    fontFamily: fontFamily.semiBold,
    fontSize: fontSize.xs,
    color: COLORS.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 4,
  },
  tripMeta: { flex: 1, fontFamily: fontFamily.regular, fontSize: fontSize.xs, color: COLORS.textMuted },
  empty: { alignItems: 'center', paddingVertical: spacing.lg, gap: spacing.xs },
  emptyTitle: { fontFamily: fontFamily.semiBold, fontSize: fontSize.md, color: COLORS.text },
  emptyHint: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.sm,
    color: COLORS.textMuted,
    textAlign: 'center',
  },
  statusBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.md,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: spacing.sm,
  },
  statusOk: { backgroundColor: '#ECFDF3', borderColor: '#ABEFC6' },
  statusErr: { backgroundColor: '#FEF3F2', borderColor: '#FECDCA' },
  statusText: { flex: 1, fontFamily: fontFamily.semiBold, fontSize: fontSize.sm },
  loadedInline: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    padding: spacing.sm,
    borderRadius: borderRadius.md,
    backgroundColor: COLORS.surfaceAlt,
  },
  loadedInlineText: { fontFamily: fontFamily.semiBold, fontSize: fontSize.sm, color: COLORS.text, flexShrink: 1 },
  dialogSubBlock: { alignSelf: 'stretch' },
  dialogActionsCol: { flex: 1, gap: spacing.sm },
  sheetSub: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.xs,
    color: COLORS.textMuted,
    marginTop: 2,
  },
  sheetHintText: { fontFamily: fontFamily.medium, fontSize: fontSize.xs, color: COLORS.textMuted },
  sheetOffline: {
    fontFamily: fontFamily.semiBold,
    fontSize: fontSize.xs,
    color: COLORS.danger ?? '#B42318',
    marginTop: spacing.xs,
  },
  sheetSearch: {
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surfaceAlt,
    fontFamily: fontFamily.medium,
    fontSize: fontSize.sm,
    color: COLORS.text,
  },
  repCount: {
    fontFamily: fontFamily.semiBold,
    fontSize: fontSize.xs,
    color: COLORS.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginTop: spacing.md,
  },
  repRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: spacing.sm,
  },
  repRowOn: { borderColor: COLORS.text, backgroundColor: COLORS.surfaceAlt },
  repTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  repId: { fontFamily: fontFamily.bold, fontSize: fontSize.sm, color: COLORS.text, flexShrink: 1 },
  repBest: { paddingHorizontal: 6, paddingVertical: 1, borderRadius: 6, backgroundColor: '#ECFDF3' },
  repBestText: { fontFamily: fontFamily.semiBold, fontSize: scaleFont(10), color: '#067647' },
  repMeta: { fontFamily: fontFamily.regular, fontSize: fontSize.xs, color: COLORS.textSecondary, marginTop: 2 },
  issuedNote: { fontFamily: fontFamily.medium, fontSize: fontSize.sm, color: COLORS.textSecondary, marginTop: spacing.xs },
  issuedNoteSame: { color: SHELVED_GREEN },
  // In transit and Arrived side by side on one line (wrapping only if they can't fit).
  stageList: { flexDirection: 'row', flexWrap: 'wrap', columnGap: spacing.lg, rowGap: 4, marginTop: spacing.sm },
  stageRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  stageText: { fontFamily: fontFamily.semiBold, fontSize: fontSize.sm, color: COLORS.text },
  stageTextPending: { fontFamily: fontFamily.medium, color: COLORS.textMuted },
  transitOpl: { fontFamily: fontFamily.medium, fontSize: fontSize.xs, color: COLORS.textMuted, marginBottom: 2 },
  summaryStage: { paddingVertical: spacing.xs },
  summaryRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.xs },
  summaryLabel: { flex: 1, minWidth: 0, fontFamily: fontFamily.semiBold, fontSize: fontSize.sm, color: COLORS.text },
  summaryCount: { fontFamily: fontFamily.bold, fontSize: fontSize.sm, color: COLORS.text },
  bMetaSub: { fontFamily: fontFamily.medium, fontSize: fontSize.xs, color: COLORS.textMuted },
  repShelfRight: { fontFamily: fontFamily.bold, fontSize: fontSize.md, color: COLORS.text, marginLeft: 'auto', flexShrink: 1 },
  repActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  loadGroup: { borderWidth: 1, borderColor: COLORS.border, borderRadius: borderRadius.md, marginBottom: spacing.sm, paddingHorizontal: spacing.sm, paddingBottom: spacing.xs },
  loadChange: { fontFamily: fontFamily.semiBold, fontSize: fontSize.xs, color: COLORS.primary },
  loadOrder: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xs, borderTopWidth: 1, borderTopColor: COLORS.border },
  loadOrderName: { fontFamily: fontFamily.bold, fontSize: fontSize.sm, color: COLORS.text },
  loadOrderCount: { fontFamily: fontFamily.bold, fontSize: fontSize.sm, color: COLORS.text },
  reasonRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.sm },
  reasonChip: { paddingHorizontal: spacing.sm, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: COLORS.border },
  reasonChipOn: { backgroundColor: COLORS.text, borderColor: COLORS.text },
  reasonText: { fontFamily: fontFamily.semiBold, fontSize: fontSize.xs, color: COLORS.text },
  reasonTextOn: { color: '#fff' },
  farmText: { fontFamily: fontFamily.semiBold, fontSize: fontSize.xs, color: COLORS.text, flexShrink: 1 },
  truckRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  truckName: { flex: 1, fontFamily: fontFamily.semiBold, fontSize: fontSize.sm, color: COLORS.text },
});
