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
import { Dialog, DialogList, DialogRow } from '@/src/core/ui/Dialog';
import { ProgressBar } from '@/src/core/ui/ProgressBar';
import { Segmented } from '@/src/core/ui/Segmented';
import { ScanField, type ScanFieldHandle } from '@/src/core/scanning/ScanField';
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
  type TripArrival,
  type ShelvedTrip,
} from '@/src/tenants/karen/repository/karen-bucket-requests-repository';
import { isoDay, setActiveFarm, type ReqOpl, type ReqBucket, type Vehicle } from '@/src/tenants/karen/offline/bucket-requests-db';
import { lineColors, type LineColor } from './line-colors';
import { CompletedView } from './CompletedView';

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
    trolleyCount,
    inTransitCount,
    activeTrolleyId,
    online,
    downloading,
    loadingTrips,
    syncingOpl,
    manualDownloaded,
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
    closeStop,
    clearAll,
    deliveryDate,
    setDeliveryDate,
    completedTrips,
    loadingCompleted,
    loadCompletedTrips,
    reopenStop,
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

  // "Completed" (after the date chips): finished trips and picklists, every date.
  const [completedView, setCompletedView] = useState(false);
  // A trip the truck has left this farm on is done here until the next run: it moves
  // from Trips to Completed.
  const openTrips = useMemo(() => plannedTrips.filter((t) => !t.yourStopClosed), [plannedTrips]);

  // The farms work on tomorrow's deliveries: one Tomorrow chip, nothing else. A
  // date left over from yesterday (or "every date") snaps back to tomorrow.
  const tomorrow = isoDay(1);
  const dateChoices = useMemo(() => [tomorrow], [tomorrow]);
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

  const onNotFound = async () => {
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

  const onCloseStop = async (t: PlannedTrip, reason?: string) => {
    const r = await closeStop(t.tripId, userFarm, reason);
    if (r.ok) showSuccess(r.message);
    else showError(r.message);
    return r.ok;
  };

  const onConfirmReplace = async (c: ReplacementCandidate, reason: ReplaceReason) => {
    const pick = replacePick;
    if (!pick || replaceBusy.current) return;
    replaceBusy.current = true;
    setReplacePick(null);
    setReplacingId(pick.bucket.id);
    const r = await replaceBucket(pick.bucket.id, pick.pliId, c.bucketId, reason);
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

  const [clearOpen, setClearOpen] = useState(false);
  const [clearing, setClearing] = useState(false);
  const onClear = () => setClearOpen(true);
  const onConfirmClear = async () => {
    setClearing(true);
    try {
      await clearAll();
      showSuccess('Cleared.');
      setClearOpen(false);
      // Scheduled picklists come straight back from the server.
      sync(userFarm);
    } catch (e) {
      showError((e as Error)?.message || 'Could not clear the data.');
    } finally {
      setClearing(false);
    }
  };

  // "Completed" is a toggle beside the date chips: the date stays selected and the
  // Completed page follows it.
  const openCompleted = async () => {
    if (completedView) {
      setCompletedView(false);
      return;
    }
    setCompletedView(true);
    if (!deliveryDate) await setDeliveryDate(isoDay(1), userFarm);
    const r = await loadCompletedTrips(userFarm);
    if (!r.ok && r.message) showError(r.message);
  };

  const onReopen = async (t: CompletedTrip) => {
    const r = await reopenStop(t.tripId, userFarm);
    if (r.ok) showSuccess(r.message);
    else showError(r.message);
  };

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      if (completedView && online) await loadCompletedTrips(userFarm);
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

  // Refresh and download are always there; clear only after the download
  // button brought in at least one picklist (reset by clearing), and only
  // while picklists are actually on the device.
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
      {manualDownloaded && reqCount + trolleyCount + inTransitCount > 0 ? (
        <Pressable
          style={s.headerBtn}
          hitSlop={6}
          onPress={onClear}
          accessibilityRole="button"
          accessibilityLabel="Clear downloaded data"
        >
          <Ionicons name="trash-outline" size={19} color={COLORS.danger} />
        </Pressable>
      ) : null}
    </View>
  );

  return (
    <Screen title="Bucket Requests" scroll={false} headerRight={headerActions}>
      <ScrollView
        contentContainerStyle={s.scroll}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.text} />
        }
      >
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

        {dateChoices.length ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.dateRow}>
            {dateChoices.map((d) => (
              <Pressable
                key={d}
                onPress={() => setDeliveryDate(d, userFarm)}
                style={[s.dateChip, deliveryDate === d && s.dateChipOn]}
                accessibilityRole="radio"
                accessibilityState={{ selected: deliveryDate === d }}
              >
                <Text style={[s.dateText, deliveryDate === d && s.dateTextOn]}>{dateLabel(d)}</Text>
              </Pressable>
            ))}
            <Pressable
              onPress={openCompleted}
              style={[s.dateChip, completedView && s.dateChipOn]}
              accessibilityRole="radio"
              accessibilityState={{ selected: completedView }}
            >
              <Text style={[s.dateText, completedView && s.dateTextOn]}>Completed</Text>
            </Pressable>
          </ScrollView>
        ) : null}

        {completedView ? (
          <CompletedView
            farm={userFarm}
            deliveryDate={deliveryDate}
            trips={completedTrips}
            loading={loadingCompleted}
            trolley={trolley}
            inTransit={inTransit}
            oplLine={oplLine}
            onReopen={onReopen}
          />
        ) : (
          <>
        <Segmented
          radius={10}
          value={tab}
          onChange={(v) => setTab(v as Tab)}
          options={[
            { value: 'requests', label: `Requests (${reqCount})` },
            { value: 'trolley', label: `Trolley (${trolleyCount})` },
            { value: 'transit', label: `In Transit (${inTransitCount})` },
            {
              value: 'shelved',
              label: shelvedCount.total ? `Shelved (${shelvedCount.done}/${shelvedCount.total})` : 'Shelved',
            },
          ]}
        />

        {tab === 'requests' ? (
          <RequestsTab
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
            onCloseStop={onCloseStop}
          />
        ) : tab === 'trolley' ? (
          <TrolleyTab
            items={trolley}
            allScanned={reqCount === 0}
            syncingOpl={syncingOpl}
            oplTeam={oplTeam}
            oplLine={oplLine}
            onLoad={onLoad}
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
          </>
        )}
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
      />
      <ClearDataModal
        visible={clearOpen}
        busy={clearing}
        counts={{ requests: reqCount, trolley: trolleyCount, transit: inTransitCount }}
        onCancel={() => !clearing && setClearOpen(false)}
        onConfirm={onConfirmClear}
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
            <View style={{ flex: 1 }}>
              <Text style={s.truckName}>{g.vehicle ? plate(g.vehicle) : 'Pick the truck'}</Text>
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
              <View style={{ flex: 1 }}>
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
}: {
  pick: {
    bucket: ReqBucket;
    neededQty: number | null;
    candidates: ReplacementCandidate[];
  } | null;
  onClose: () => void;
  onPick: (c: ReplacementCandidate, reason: ReplaceReason) => void;
  /** Not in the cold room and nothing to replace it: leave it out of the transfer. */
  onNotFound: () => void;
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
              <Button label="Cancel" variant="outline" onPress={onClose} style={{ flex: 1 }} />
              <Button
                label={chosen ? `Replace with ${chosen.bucketId}` : 'Replace'}
                iconLeft="swap-horizontal"
                onPress={() => chosen && onPick(chosen, reason)}
                disabled={!chosen}
                style={{ flex: 2 }}
              />
            </View>
          ) : null}
          <View style={s.repActions}>
            {!candidates.length ? <Button label="Cancel" variant="outline" onPress={onClose} style={{ flex: 1 }} /> : null}
            <Button
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
            <View style={{ flex: 1 }}>
              <View style={s.repTop}>
                <Text style={s.repId}>{c.bucketId}</Text>
                {i === 0 ? (
                  <View style={s.repBest}>
                    <Text style={s.repBestText}>Best match</Text>
                  </View>
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
              {c.shelf ? (
                <View style={s.repShelf}>
                  <Ionicons name="location-outline" size={12} color={COLORS.textMuted} />
                  <Text style={s.repShelfText} numberOfLines={1}>
                    {c.shelf}
                  </Text>
                </View>
              ) : null}
            </View>
          </Pressable>
        );
      })}
    </Dialog>
  );
}

/** Centered destructive-confirm dialog for wiping this device's bucket data. */
function ClearDataModal({
  visible,
  busy,
  counts,
  onCancel,
  onConfirm,
}: {
  visible: boolean;
  busy: boolean;
  counts: { requests: number; trolley: number; transit: number };
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const items: { icon: keyof typeof Ionicons.glyphMap; label: string; count: number }[] = [
    { icon: 'document-text-outline', label: 'Picklists', count: counts.requests },
    { icon: 'cart-outline', label: 'Trolley scans', count: counts.trolley },
    { icon: 'car-outline', label: 'In transit', count: counts.transit },
  ];
  return (
    <Dialog
      visible={visible}
      onClose={onCancel}
      busy={busy}
      icon={{ name: 'trash-outline', tone: 'danger' }}
      title="Clear downloaded data?"
      subtitle="This removes everything below from this device. Scheduled picklists download again automatically; unsynced scans are lost."
      actions={
        <>
          <Button label="Cancel" variant="outline" onPress={onCancel} disabled={busy} style={{ flex: 1 }} />
          <Button
            label="Clear"
            color={COLORS.danger}
            iconLeft="trash-outline"
            onPress={onConfirm}
            loading={busy}
            style={{ flex: 1 }}
          />
        </>
      }
    >
      <View style={s.dialogList}>
        {items.map((it) => (
          <View key={it.label} style={s.dialogRow}>
            <Ionicons name={it.icon} size={16} color={COLORS.textMuted} />
            <Text style={s.dialogRowLabel}>{it.label}</Text>
            <Text style={s.dialogRowCount}>{it.count}</Text>
          </View>
        ))}
      </View>
    </Dialog>
  );
}

/** Picklists to scan, under the planned trip that collects them (trip header with the
 *  truck, this farm's stop and "Truck leaving"), then the orders not on a trip yet —
 *  one list, so trips and requests are not two places to look. */
function RequestsTab({
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
  onCloseStop,
}: {
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
  onCloseStop: (t: PlannedTrip, reason?: string) => Promise<boolean>;
}) {
  const [query, setQuery] = useState('');
  const lineColor = useMemo(() => lineColors(schedules), [schedules]);

  if (!groups.length && !trips.length) {
    if (loading) return <SkeletonCards />;
    return (
      <Card>
        <View style={s.empty}>
          <Ionicons name="download-outline" size={26} color={COLORS.textMuted} />
          <Text style={s.emptyTitle}>No picklists</Text>
        </View>
      </Card>
    );
  }

  const q = query.trim().toLowerCase();
  const filtered = q
    ? groups.filter((g) => {
        const inName = g.orderName.toLowerCase().includes(q);
        const inCustomer = g.opls.some((o) => (o.customer || '').toLowerCase().includes(q));
        return inName || inCustomer;
      })
    : groups;

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
  const sorted = [...filtered].sort((a, b) => {
    const byScheduled = Number(isScheduled(b)) - Number(isScheduled(a));
    if (byScheduled) return byScheduled;
    const [ta, sa] = rankOf(a);
    const [tb, sb] = rankOf(b);
    return ta === tb ? sa - sb : ta < tb ? -1 : 1;
  });
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
  const renderGroup = (g: OrderGroup, dim: boolean) => {
    const customer = g.opls.find((o) => o.customer)?.customer;
    return (
      <View key={g.orderName}>
        <Text style={[s.groupHdr, dim ? s.groupHdrDim : null]}>{g.orderName}</Text>
        {customer ? <Text style={[s.groupCustomer, dim ? s.groupHdrDim : null]}>{customer}</Text> : null}
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
      <View style={s.searchRow}>
        <Ionicons name="search" size={16} color={COLORS.textMuted} />
        <TextInput
          style={s.searchInput}
          value={query}
          onChangeText={setQuery}
          placeholder="Search by order or customer"
          placeholderTextColor={COLORS.textMuted}
          autoCorrect={false}
          autoCapitalize="none"
        />
        {query ? (
          <Pressable onPress={() => setQuery('')} hitSlop={8}>
            <Ionicons name="close-circle" size={18} color={COLORS.textMuted} />
          </Pressable>
        ) : null}
      </View>

      {lineColor.lines.length > 1 ? (
        <View style={s.lineLegend}>
          {lineColor.lines.map((l) => (
            <View key={l.team} style={s.lineLegendItem}>
              <View style={[s.lineDot, { backgroundColor: l.color }]} />
              <Text style={s.lineLegendText} numberOfLines={1}>
                {l.team}
              </Text>
            </View>
          ))}
        </View>
      ) : null}

      {q && sorted.length === 0 ? (
        <Card>
          <View style={s.empty}>
            <Text style={s.emptyHint}>No orders match “{query}”.</Text>
          </View>
        </Card>
      ) : null}

      {steps.map((t, i) => {
        const tripGroups = onTrip(t.tripId);
        // Searching hides trips with nothing matching.
        if (q && !tripGroups.length) return null;
        const last = i === steps.length - 1;
        return (
          <View key={t.tripId} style={s.step}>
            {/* Step rail: number, then a line down to the next trip. */}
            <View style={s.stepRail}>
              <View style={[s.stepDot, t.current ? s.stepDotCurrent : null]}>
                <Text style={[s.stepNum, t.current ? s.stepNumCurrent : null]}>{i + 1}</Text>
              </View>
              {!last ? <View style={s.stepLine} /> : null}
            </View>
            <View style={[s.stepBody, !t.current ? s.stepBodyLater : null]}>
              <View style={s.stepHead}>
                <Text style={[s.stepLabel, t.current ? s.stepLabelCurrent : null]}>
                  {t.current ? 'Current trip' : 'Next trip'}
                </Text>
                <Text style={s.stepMeta} numberOfLines={1}>
                  {[
                    t.vehicle,
                    t.run ? `trip ${t.run}${t.runs > 1 ? ` of ${t.runs}` : ''}` : '',
                    `${t.farmBuckets} bkt`,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </Text>
              </View>
              <TripCard trip={t} oplTeam={oplTeam} oplLine={oplLine} online={online} onCloseStop={onCloseStop} compact />
              {tripGroups.length ? (
                tripGroups.map((g) => renderGroup(g, false))
              ) : (
                <Text style={s.tripAllScanned}>Every bucket for this trip is scanned — see Trolley.</Text>
              )}
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
}: {
  opl: ReqOpl;
  trip?: OplTripInfo;
  team?: string;
  /** The packing line's colour: a thin stripe down the card and a dot on its tag. */
  line?: LineColor;
  replacingId: number | null;
  onReplace: (b: ReqBucket) => void;
}) {
  const pct = opl.total > 0 ? Math.round((opl.scanned / opl.total) * 100) : 0;
  const dimmed = !trip;
  return (
    <View style={dimmed ? s.dimmed : undefined}>
    <Card>
      <View style={s.oplTagRow}>
        {trip ? (
          <View style={[s.oplTag, trip.confirmed ? s.oplTagConfirmed : s.oplTagPlanned]}>
            {line ? <View style={[s.lineDot, { backgroundColor: line.color }]} /> : null}
            <Ionicons
              name={trip.onTrip ? 'car' : 'calendar-outline'}
              size={12}
              color={trip.confirmed ? (COLORS.textOnPrimary ?? '#fff') : COLORS.text}
            />
            <Text style={[s.oplTagText, trip.confirmed ? s.oplTagTextConfirmed : null]} numberOfLines={1}>
              {trip.label} · {trip.onTrip ? (trip.confirmed ? 'Confirmed' : 'Planned') : 'Scheduled'}
            </Text>
          </View>
        ) : (
          <View style={s.oplTagUnsched}>
            <Ionicons name="ellipse-outline" size={11} color={COLORS.textMuted} />
            <Text style={s.oplTagUnschedText}>Unscheduled</Text>
          </View>
        )}
        {!trip || trip.onTrip ? <TeamChip team={team} color={trip ? undefined : line?.color} /> : null}
      </View>
      <View style={s.oplHead}>
        <View style={{ flex: 1 }}>
          <Text style={s.oplDate}>{opl.createdOn || '—'}</Text>
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
      {opl.buckets.map((b) => (
        <View key={b.id} style={s.bRow}>
          <Ionicons
            name={b.notFound ? 'close-circle' : b.scanned ? 'checkmark-circle' : 'ellipse-outline'}
            size={18}
            color={b.notFound ? COLORS.danger : b.scanned ? (COLORS.success ?? '#12B76A') : COLORS.textMuted}
          />
          <View style={{ flex: 1 }}>
            <Text style={s.bId}>
              {b.bucketId}
              {b.notFound ? <Text style={s.bNotFound}>  · not found</Text> : null}
            </Text>
            <Text style={s.bMeta} numberOfLines={1}>
              {bucketMeta(b.variety, b.stemLength)}
            </Text>
            {!!(b.farm || b.shelf) && (
              <Text style={s.bShelf} numberOfLines={1}>
                {[b.farm, b.shelf].filter(Boolean).join(' · ')}
              </Text>
            )}
          </View>
          <View style={s.bSide}>
            <Text style={s.bQty}>
              {Math.round(b.qty)} {b.uom}
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
                    <Ionicons name="swap-horizontal" size={13} color={COLORS.text} />
                    <Text style={s.changeLink}>Replace</Text>
                  </>
                )}
              </Pressable>
            ) : null}
          </View>
        </View>
      ))}
    </Card>
    </View>
  );
}

function TeamChip({ team, color }: { team?: string; color?: string }) {
  if (!team) return null;
  return (
    <View style={[s.oplTag, s.oplTagPlanned]}>
      {color ? <View style={[s.lineDot, { backgroundColor: color }]} /> : null}
      <Ionicons name="people-outline" size={12} color={COLORS.text} />
      <Text style={s.oplTagText} numberOfLines={1}>
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
        <View style={{ flex: 1 }}>
          <Text style={s.bId}>{o.orderName}</Text>
          <Text style={s.oplMeta}>
            {o.createdOn} · trolley {o.trolleys.join(', ') || '—'}
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
          <View style={{ flex: 1 }}>
            <Text style={s.bId}>{b.bucketId}</Text>
            <Text style={s.bMeta} numberOfLines={1}>
              {bucketMeta(b.variety, b.stemLength)}
            </Text>
            {!!(b.farm || b.shelf) && (
              <Text style={s.bShelf} numberOfLines={1}>
                {[b.farm, b.shelf].filter(Boolean).join(' · ')}
              </Text>
            )}
          </View>
          <Text style={s.bQty}>{b.trolleyId || ''}</Text>
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
}: {
  items: TrolleyOpl[];
  /** Every requested bucket is on a trolley: one button loads them all. */
  allScanned: boolean;
  syncingOpl: string | null;
  oplTeam: Record<string, string>;
  oplLine: Record<string, LineColor>;
  onLoad: (opls: TrolleyOpl[]) => void;
}) {
  if (!items.length) {
    return (
      <Card>
        <View style={s.empty}>
          <Ionicons name="cart-outline" size={26} color={COLORS.textMuted} />
          <Text style={s.emptyTitle}>No completed orders</Text>
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
  const tripCards = trips.map((t) => (
    <TripArrivalCard
      key={t.tripId}
      trip={t}
      arrival={arrivals[t.tripId]}
      deliveryDate={deliveryDate}
      online={online}
      onArrival={onArrival}
    />
  ));
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
      {items.map((o) => (
        <CompletedCard
          key={o.oplName}
          o={o}
          team={oplTeam[o.oplName]}
          line={oplLine[o.oplName]}
          footer={
            <View style={s.loadedInline}>
              <Ionicons name={o.arrived ? 'checkmark-done' : 'car'} size={16} color={COLORS.text} />
              <Text style={s.loadedInlineText}>{o.arrived ? 'Arrived at packhouse' : 'In transit'}</Text>
            </View>
          }
        />
      ))}
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
  const where = hub || 'the packhouse';
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
          <Text style={s.routeLabel}>
            Shelved at {where}
            {day ? ` · ${day}` : ''}
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
            <View style={s.divider} />
            {rows.map((b) => (
              <View key={`${t.tripId}-${b.opl}-${b.bucketId}`} style={s.shelvedRow}>
                <Ionicons
                  name={b.shelved ? 'checkmark-circle' : 'time-outline'}
                  size={18}
                  color={b.shelved ? COLORS.text : COLORS.warn}
                />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={s.bId} numberOfLines={1}>
                    {b.bucketId}
                  </Text>
                  <Text style={s.bMeta} numberOfLines={1}>
                    {b.orderName}
                  </Text>
                </View>
                <View style={s.shelvedWhere}>
                  <Text style={[s.shelvedState, !b.shelved && s.shelvedStateWaiting]} numberOfLines={1}>
                    {b.shelved ? b.shelf || 'Shelved' : 'Not shelved'}
                  </Text>
                  {b.shelved && b.shelvedAt ? <Text style={s.bMeta}>{time(b.shelvedAt)}</Text> : null}
                </View>
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
}: {
  trip: CompletedTrip;
  arrival?: TripArrival;
  /** Delivery date on screen ('' = every date): only its buckets are counted / listed. */
  deliveryDate: string;
  online: boolean;
  onArrival: (tripId: string, action: 'status' | 'arrive' | 'complete') => Promise<boolean>;
}) {
  const [ask, setAsk] = useState<'arrive' | 'complete' | null>(null);
  const [busy, setBusy] = useState(false);
  const hub = arrival?.hub || 'the packhouse';
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
      <View style={s.tripHead}>
        <View style={s.tripTruck}>
          <Ionicons name="car" size={16} color={COLORS.text} />
          <Text style={s.tripTruckText} numberOfLines={1}>
            {trip.vehicle || 'Truck'}
          </Text>
        </View>
        <View style={[s.tripPill, arrived ? s.tripPillConfirmed : s.tripPillDraft]}>
          <Text style={[s.tripPillText, arrived ? s.tripPillTextConfirmed : s.tripPillTextDraft]}>
            {arrived ? `At ${hub}` : 'On the road'}
          </Text>
        </View>
      </View>
      <Text style={s.tripMeta} numberOfLines={1}>
        {trip.tripId}
        {trip.leftAt ? ` · left ${time(trip.leftAt)}` : ''}
        {arrived ? ` · arrived ${time(arrival?.arrivedAt ?? '')}` : ''}
      </Text>

      {!arrived ? (
        <Button
          label={`Truck arrived at ${hub}?`}
          iconLeft="flag-outline"
          disabled={!online || busy || !arrival}
          onPress={() => setAsk('arrive')}
          style={{ marginTop: spacing.md }}
        />
      ) : (
        <>
          <View style={s.divider} />
          <View style={s.arrivalRow}>
            <Text style={s.routeLabel}>Shelved at {hub}</Text>
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
      )}

      <Dialog
        visible={ask === 'arrive'}
        onClose={() => setAsk(null)}
        busy={busy}
        icon={{ name: 'flag-outline', tone: 'info' }}
        title={`Truck at ${hub}?`}
        subtitle={`Confirm ${trip.vehicle || 'the truck'} has arrived at ${hub} with trip ${trip.tripId}.`}
        actions={
          <>
            <Button label="Not yet" variant="outline" onPress={() => setAsk(null)} disabled={busy} style={{ flex: 1 }} />
            <Button label="Yes, it's here" loading={busy} onPress={() => run('arrive')} style={{ flex: 1 }} />
          </>
        }
      >
        <DialogList>
          <DialogRow label="Buckets on the trip" value={String(total)} />
          <DialogRow label="Shelved so far" value={String(shelved)} />
        </DialogList>
      </Dialog>

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

function StopRow({ stop }: { stop: PlannedTripStop }) {
  const ui = STOP_UI[stop.status] ?? STOP_UI.waiting;
  const progress = stop.total > 0 ? `${stop.doneCount}/${stop.total}` : `${stop.planned}`;
  return (
    <View style={[s.stopRow, stop.isYou ? s.stopRowYou : null]}>
      <Text style={[s.stopNum, stop.isYou ? s.stopNumYou : null]}>{stop.stop}</Text>
      <View style={{ flex: 1 }}>
        <Text style={s.stopFarm} numberOfLines={1}>
          {stop.farm}
          {stop.isYou ? '  · you' : ''}
          {stop.delaying ? '  ⚠︎' : ''}
        </Text>
        <Text style={[s.stopStatus, { color: ui.color }]} numberOfLines={1}>
          {ui.label} · {progress}
          {stop.delaying ? ' · holding up the trip' : ''}
        </Text>
      </View>
      <Ionicons name={ui.icon} size={16} color={ui.color} />
    </View>
  );
}

/** Why a farm's stop leaves with fewer buckets than planned (saved on the trip). */
const SHORT_REASONS = ['Bucket not found', 'Not ready yet', 'Quality reject', 'Truck full', 'Other'] as const;
type ShortReason = (typeof SHORT_REASONS)[number];

function TripCard({
  trip,
  oplTeam,
  oplLine,
  online,
  onCloseStop,
  compact,
}: {
  trip: PlannedTrip;
  oplTeam: Record<string, string>;
  oplLine: Record<string, LineColor>;
  online: boolean;
  onCloseStop: (t: PlannedTrip, reason?: string) => Promise<boolean>;
  /** Trip header in the Requests list: its picklists are listed right below, so
   *  the "Your orders" summary is left out. */
  compact?: boolean;
}) {
  const yourStop = (trip.stops ?? []).find((st) => st.isYou);
  const [closing, setClosing] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  // Short stop (not every planned bucket on the truck): why, before it leaves.
  const [shortReason, setShortReason] = useState<ShortReason | null>(null);
  const [shortNote, setShortNote] = useState('');
  const onTruck = yourStop ? yourStop.loaded + yourStop.transit + yourStop.shelved : 0;
  const forStop = yourStop ? yourStop.total || yourStop.planned : 0;
  const short = forStop > onTruck;
  const reasonText = shortReason
    ? [shortReason === 'Other' ? '' : shortReason, shortNote.trim()].filter(Boolean).join(' — ')
    : '';
  const reasonReady = !short || (!!shortReason && (shortReason !== 'Other' || !!shortNote.trim()));
  const openLeave = () => {
    setShortReason(null);
    setShortNote('');
    setConfirmLeave(true);
  };
  // "Truck leaving" once something of this farm is on the truck (the rest, if any, goes
  // on the truck's next run).
  const canClose =
    !!yourStop && !trip.yourStopClosed && trip.current && yourStop.loaded + yourStop.transit + yourStop.shelved > 0;
  return (
    <Card>
      <View style={s.tripHead}>
        <View style={s.tripTruck}>
          <Ionicons name="car" size={16} color={COLORS.text} />
          <Text style={s.tripTruckText} numberOfLines={1}>
            {trip.vehicle || 'No truck yet'}
          </Text>
        </View>
        {/* This farm's own stop, not the whole trip: another farm's buckets on the
            truck must not make an unstaged farm read "loading". */}
        {yourStop ? (
          <View style={[s.tripPill, { borderColor: STOP_UI[yourStop.status]?.color, borderWidth: 1 }]}>
            <Text style={[s.tripPillText, { color: STOP_UI[yourStop.status]?.color }]}>
              {(STOP_UI[yourStop.status] ?? STOP_UI.waiting).label}
            </Text>
          </View>
        ) : null}
        <View style={[s.tripPill, trip.confirmed ? s.tripPillConfirmed : s.tripPillDraft]}>
          <Text
            style={[s.tripPillText, trip.confirmed ? s.tripPillTextConfirmed : s.tripPillTextDraft]}
          >
            {trip.confirmed ? 'Confirmed' : 'Planned'}
          </Text>
        </View>
      </View>

      {trip.run ? (
        <View style={s.tripRunRow}>
          <Text style={s.tripRun}>
            Trip {trip.run}
            {trip.runs > 1 ? ` of ${trip.runs}` : ''}
            {trip.window ? ` · ${trip.window}` : ''}
          </Text>
          {trip.runChain ? (
            <Text style={s.tripChain} numberOfLines={2}>
              {trip.runChain}
            </Text>
          ) : null}
          {!trip.current ? (
            <Text style={s.tripLater}>
              Next trip — the truck comes after trip {trip.afterRun || trip.run - 1} is back
            </Text>
          ) : null}
        </View>
      ) : null}

      <View style={s.tripMetaRow}>
        <Text style={s.tripMeta} numberOfLines={1}>
          {trip.tripId}
          {trip.tripDate ? ` · ${trip.tripDate}` : ''}
        </Text>
        {trip.yourStop > 0 && trip.totalStops > 1 ? (
          <Text style={s.tripStop}>
            You’re stop {trip.yourStop} of {trip.totalStops} · {trip.farmBuckets} bkt
          </Text>
        ) : (
          <Text style={s.tripStop}>{trip.farmBuckets} bkt for you</Text>
        )}
      </View>

      {!compact && (trip.orders ?? []).length ? (
        <>
          <View style={s.divider} />
          <Text style={s.routeLabel}>Your orders</Text>
          {(trip.orders ?? []).map((o) => (
            <View
              key={`${trip.tripId}-${o.opl}`}
              style={s.tripOrderRow}
            >
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={s.bId} numberOfLines={1}>
                  {o.orderName || o.opl}
                </Text>
                <Text style={s.bMeta} numberOfLines={1}>
                  {[o.varieties, `${o.buckets} bkt`].filter(Boolean).join(' · ')}
                </Text>
              </View>
              <TeamChip team={oplTeam[o.opl]} color={oplLine[o.opl]?.color} />
            </View>
          ))}
        </>
      ) : null}

      <View style={s.divider} />
      {/* Only this farm's stop: other farms' transfers on the same truck stay with them. */}
      <Text style={s.routeLabel}>
        Your stop · stop {trip.yourStop} of {trip.totalStops}
      </Text>
      {(trip.stops ?? [])
        .filter((st) => st.isYou)
        .map((st) => (
          <StopRow key={`${trip.tripId}-${st.stop}-${st.farm}`} stop={st} />
        ))}
      {trip.yourStopClosed ? (
        <Text style={s.tripClosed}>Stop closed — the truck has left this farm.</Text>
      ) : canClose ? (
        <Button
          label={closing ? 'Closing…' : 'Truck leaving — close my stop'}
          iconLeft="exit-outline"
          disabled={closing || !online}
          onPress={openLeave}
          style={{ marginTop: spacing.sm }}
        />
      ) : null}
      {/* Closing the stop can't be undone from the farm, so ask first. */}
      {yourStop ? (
        <Dialog
          visible={confirmLeave}
          onClose={() => setConfirmLeave(false)}
          busy={closing}
          icon={{ name: 'exit-outline', tone: 'warn' }}
          title="Truck leaving the farm?"
          subtitle={`${trip.vehicle || 'The truck'} leaves ${yourStop.farm} and this stop is closed.`}
          actions={
            <>
              <Button
                label="Cancel"
                variant="outline"
                onPress={() => setConfirmLeave(false)}
                disabled={closing}
                style={{ flex: 1 }}
              />
              <Button
                label="Yes, it's leaving"
                iconLeft="exit-outline"
                loading={closing}
                disabled={!online || !reasonReady}
                onPress={async () => {
                  setClosing(true);
                  const ok = await onCloseStop(trip, short ? reasonText : undefined);
                  setClosing(false);
                  // A failed close keeps the dialog (and the reason typed) for a retry.
                  if (ok) setConfirmLeave(false);
                }}
                style={{ flex: 1 }}
              />
            </>
          }
        >
          <DialogList>
            <DialogRow label="On the truck" value={`${onTruck} bkt`} />
            <DialogRow label="For this stop" value={`${forStop} bkt`} />
          </DialogList>
          {short ? (
            <>
              <Text style={s.leaveNote}>
                {forStop - onTruck} bucket{forStop - onTruck === 1 ? '' : 's'} not on the truck — they go on its
                next trip. Why is it leaving short?
              </Text>
              <View style={s.reasonRow}>
                {SHORT_REASONS.map((r) => (
                  <Pressable
                    key={r}
                    onPress={() => setShortReason(r)}
                    disabled={closing}
                    style={[s.reasonChip, shortReason === r && s.reasonChipOn]}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: shortReason === r }}
                  >
                    <Text style={[s.reasonText, shortReason === r && s.reasonTextOn]}>{r}</Text>
                  </Pressable>
                ))}
              </View>
              <TextInput
                value={shortNote}
                onChangeText={setShortNote}
                placeholder={shortReason === 'Other' ? 'Say why (required)' : 'Add a note (optional)'}
                placeholderTextColor={COLORS.textMuted}
                editable={!closing}
                multiline
                maxLength={300}
                style={s.leaveInput}
              />
            </>
          ) : null}
        </Dialog>
      ) : null}
    </Card>
  );
}

const s = StyleSheet.create({
  step: { flexDirection: 'row', gap: spacing.sm },
  stepRail: { width: 28, alignItems: 'center' },
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
  stepDotCurrent: { borderColor: COLORS.text, backgroundColor: COLORS.text },
  stepNum: { fontFamily: fontFamily.bold, fontSize: fontSize.sm, color: COLORS.textMuted },
  stepNumCurrent: { color: COLORS.surface },
  stepLine: { flex: 1, width: 2, backgroundColor: COLORS.border, marginVertical: spacing.xs },
  stepBody: { flex: 1, minWidth: 0, paddingBottom: spacing.lg },
  stepBodyLater: { opacity: 0.75 },
  stepHead: { minHeight: 28, justifyContent: 'center', marginBottom: spacing.xs },
  stepLabel: { fontFamily: fontFamily.bold, fontSize: fontSize.md, color: COLORS.textMuted },
  stepLabelCurrent: { color: COLORS.text },
  stepMeta: { fontFamily: fontFamily.medium, fontSize: fontSize.xs, color: COLORS.textMuted },
  tripAllScanned: {
    fontFamily: fontFamily.medium,
    fontSize: fontSize.xs,
    color: COLORS.textMuted,
    marginTop: spacing.xs,
    marginLeft: spacing.xs,
  },
  tripRunRow: { marginTop: spacing.xs, gap: 2 },
  tripRun: { fontFamily: fontFamily.semiBold, fontSize: fontSize.sm, color: COLORS.text },
  tripChain: { fontFamily: fontFamily.regular, fontSize: fontSize.xs, color: COLORS.textMuted },
  tripLater: { fontFamily: fontFamily.medium, fontSize: fontSize.xs, color: COLORS.warn },
  shelvedRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm },
  shelvedWhere: { alignItems: 'flex-end', maxWidth: '45%' },
  shelvedState: { fontFamily: fontFamily.semiBold, fontSize: fontSize.sm, color: COLORS.text },
  shelvedStateWaiting: { color: COLORS.warn },
  arrivalRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.xs },
  arrivalCount: { fontFamily: fontFamily.bold, fontSize: fontSize.sm, color: COLORS.text },
  arrivalHint: { fontFamily: fontFamily.medium, fontSize: fontSize.xs, color: COLORS.textMuted, marginTop: spacing.sm },
  leaveNote: {
    fontFamily: fontFamily.medium,
    fontSize: fontSize.xs,
    color: COLORS.warn,
    marginTop: spacing.md,
    textAlign: 'center',
  },
  leaveInput: {
    marginTop: spacing.sm,
    minHeight: 56,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surfaceAlt,
    fontFamily: fontFamily.medium,
    fontSize: fontSize.sm,
    color: COLORS.text,
    textAlignVertical: 'top',
  },
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
  // Room above the card for the farm badge on its top edge: the scroll view
  // clips anything above its content.
  scanWrap: { position: 'relative', marginTop: spacing.lg },
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
    borderRadius: 999,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surfaceAlt,
    zIndex: 2,
    elevation: 4,
  },
  scanHead: {
    flexDirection: 'row',
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
  lineLegend: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: spacing.sm },
  lineLegendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  lineLegendText: { fontFamily: fontFamily.medium, fontSize: scaleFont(12), color: COLORS.text },
  lineDot: { width: 10, height: 10, borderRadius: 5 },
  oplTagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: spacing.xs },
  oplTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: borderRadius.full,
  },
  oplTagConfirmed: { backgroundColor: COLORS.text },
  oplTagPlanned: { backgroundColor: COLORS.surfaceAlt },
  oplTagText: { fontFamily: fontFamily.semiBold, fontSize: scaleFont(11), color: COLORS.text },
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
  oplDate: { fontFamily: fontFamily.semiBold, fontSize: fontSize.sm, color: COLORS.text },
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
  bId: { fontFamily: fontFamily.bold, fontSize: fontSize.sm, color: COLORS.text },
  bMeta: { fontFamily: fontFamily.medium, fontSize: fontSize.sm, color: COLORS.textSecondary },
  bShelf: { fontFamily: fontFamily.medium, fontSize: fontSize.xs, color: COLORS.textMuted, marginTop: 1 },
  bQty: { fontFamily: fontFamily.semiBold, fontSize: fontSize.xs, color: COLORS.textSecondary },
  bSide: { alignItems: 'flex-end', gap: 4 },
  tripOrderRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 4 },
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
  tripTruck: { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 },
  tripTruckText: { fontFamily: fontFamily.semiBold, fontSize: fontSize.md, color: COLORS.text },
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
  stopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 7,
    paddingHorizontal: 8,
    borderRadius: borderRadius.sm,
  },
  stopRowYou: { backgroundColor: COLORS.surfaceAlt },
  stopNum: {
    width: 20,
    height: 20,
    borderRadius: 10,
    textAlign: 'center',
    lineHeight: scaleFont(20),
    fontFamily: fontFamily.bold,
    fontSize: scaleFont(11),
    color: COLORS.textMuted,
    backgroundColor: COLORS.surfaceAlt,
    overflow: 'hidden',
  },
  stopNumYou: { color: COLORS.textOnPrimary ?? '#fff', backgroundColor: COLORS.text },
  stopFarm: { fontFamily: fontFamily.semiBold, fontSize: fontSize.sm, color: COLORS.text },
  stopStatus: { fontFamily: fontFamily.medium, fontSize: fontSize.xs, marginTop: 1 },
  tripMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginTop: 4,
  },
  tripMeta: { flex: 1, fontFamily: fontFamily.regular, fontSize: fontSize.xs, color: COLORS.textMuted },
  tripStop: { fontFamily: fontFamily.semiBold, fontSize: fontSize.xs, color: COLORS.text },
  tripBucketsRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
  tripBucketsText: { fontFamily: fontFamily.semiBold, fontSize: fontSize.sm, color: COLORS.text },
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
  loadedInlineText: { fontFamily: fontFamily.semiBold, fontSize: fontSize.sm, color: COLORS.text },
  dialogList: {
    alignSelf: 'stretch',
    marginTop: spacing.lg,
    borderRadius: borderRadius.md,
    backgroundColor: COLORS.surfaceAlt,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
  },
  dialogRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm },
  dialogRowLabel: { flex: 1, fontFamily: fontFamily.medium, fontSize: fontSize.sm, color: COLORS.text },
  dialogRowCount: { fontFamily: fontFamily.semiBold, fontSize: fontSize.sm, color: COLORS.text },
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
  repId: { fontFamily: fontFamily.bold, fontSize: fontSize.sm, color: COLORS.text },
  repBest: { paddingHorizontal: 6, paddingVertical: 1, borderRadius: 6, backgroundColor: '#ECFDF3' },
  repBestText: { fontFamily: fontFamily.semiBold, fontSize: scaleFont(10), color: '#067647' },
  repMeta: { fontFamily: fontFamily.regular, fontSize: fontSize.xs, color: COLORS.textSecondary, marginTop: 2 },
  repShelf: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 3 },
  repShelfText: { fontFamily: fontFamily.medium, fontSize: fontSize.xs, color: COLORS.textMuted, flexShrink: 1 },
  repActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surfaceAlt,
    marginBottom: spacing.xs,
  },
  searchInput: {
    flex: 1,
    fontFamily: fontFamily.medium,
    fontSize: fontSize.sm,
    color: COLORS.text,
    padding: 0,
  },
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
  dateRow: { gap: spacing.xs, paddingVertical: spacing.xs, paddingHorizontal: 2 },
  dateChip: { paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.bg },
  dateChipOn: { backgroundColor: COLORS.text, borderColor: COLORS.text },
  dateText: { fontFamily: fontFamily.semiBold, fontSize: fontSize.xs, color: COLORS.text },
  dateTextOn: { color: '#fff' },
  farmText: { fontFamily: fontFamily.semiBold, fontSize: fontSize.xs, color: COLORS.text },
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
