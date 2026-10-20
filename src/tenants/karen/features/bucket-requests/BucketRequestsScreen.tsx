import {
  memo,
  startTransition,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import {
  ActivityIndicator,
  AppState,
  BackHandler,
  Pressable,
  RefreshControl,
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
import { Dropdown } from '@/src/core/ui/Dropdown';
import { karenShelfOperationsRepository } from '@/src/tenants/karen/repository/karen-shelf-operations-repository';
import { ProgressBar } from '@/src/core/ui/ProgressBar';
import { Segmented } from '@/src/core/ui/Segmented';
import { ScanField, type ScanFieldHandle } from '@/src/core/scanning/ScanField';
import { showDialog } from '@/src/core/ui/DialogHost';
import { useTransferHub } from '@/src/core/tenant/transfer-hub';
import { SkeletonCards } from '@/src/core/ui/SkeletonCards';
import { useShallow } from 'zustand/react/shallow';
import { focusWhenReady } from '@/src/core/scanning/focus';
import { useToast } from '@/src/core/ui/Toast';
import { borderRadius, COLORS, fontFamily, fontSize, spacing, scaleFont } from '@/src/core/theme';
import {
  useKarenBucketRequestsStore,
  onTrip as oplOnTrip,
  heldOnTrip,
  ridingOnlyOpls,
  stopBuckets,
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
  type ReplaceCorrection,
  type BucketIssueInfo,
  type TripArrival,
  type ShelvedTrip,
} from '@/src/tenants/karen/repository/karen-bucket-requests-repository';
import { setActiveFarm, type ReqOpl, type ReqBucket, type Vehicle } from '@/src/tenants/karen/offline/bucket-requests-db';
import { lineColors, type LineColor } from './line-colors';
import { CardList, FadeIn, useStableCallback, type CardItem } from './CardList';

type Tab = 'requests' | 'trolley' | 'transit' | 'shelved';

const SYNC_INTERVAL_MS = 30_000;

/** OPL name -> its planned trip, so the Requests tab can grey unscheduled ones. */
/** `label` is the trip id, or "Team A #2" for an order only on the Packhouse Schedule. */
type OplTripInfo = { label: string; confirmed: boolean; status: string; onTrip: boolean };
type OplTripMap = Record<string, OplTripInfo>;

export function KarenBucketRequestsScreen({ userFarm }: { userFarm: string }) {
  const scanRef = useRef<ScanFieldHandle>(null);
  const { showSuccess, showError, showInfo } = useToast();
  const [tab, setTabState] = useState<Tab>('requests');
  // The bar moves at once (`picked`); the tab's content follows as a transition, so
  // a heavy list never holds up the tap. A tab is mounted the first time it opens and
  // kept (hidden) after, so switching back to it is instant.
  const [picked, setPicked] = useState<Tab>('requests');
  const [opened, setOpened] = useState<Tab[]>(['requests']);
  const setTab = useCallback((t: Tab) => {
    setPicked(t);
    startTransition(() => {
      setTabState(t);
      setOpened((o) => (o.includes(t) ? o : [...o, t]));
    });
  }, []);
  const [refreshing, setRefreshing] = useState(false);
  const [scanStatus, setScanStatus] = useState<{ ok: boolean; message: string } | null>(null);
  // A good scan's banner goes after a second; a refusal stays until the next scan.
  useEffect(() => {
    if (!scanStatus?.ok) return;
    const shown = scanStatus;
    const t = setTimeout(() => setScanStatus((cur) => (cur === shown ? null : cur)), 1000);
    return () => clearTimeout(t);
  }, [scanStatus]);
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
    hydrated,
    synced,
    savedData,
    error,
    requests,
    notScheduled,
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
    transitBuckets,
    activeTrolleyId,
    selectedTripId,
    tripOpls,
    tripCounts,
    selectTrip,
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
    loadShelvedBuckets,
  } = useKarenBucketRequestsStore(
    // Only what this screen reads: an update to anything else does not re-render it.
    useShallow((st) => ({
      ready: st.ready,
      hydrated: st.hydrated,
      synced: st.synced,
      savedData: st.savedData,
      error: st.error,
      requests: st.requests,
      notScheduled: st.notScheduled,
      trolley: st.trolley,
      inTransit: st.inTransit,
      vehicles: st.vehicles,
      plannedTrips: st.plannedTrips,
      schedules: st.schedules,
      reqCount: st.reqCount,
      scannedBuckets: st.scannedBuckets,
      totalBuckets: st.totalBuckets,
      allBuckets: st.allBuckets,
      addedBuckets: st.addedBuckets,
      transitBuckets: st.transitBuckets,
      activeTrolleyId: st.activeTrolleyId,
      selectedTripId: st.selectedTripId,
      tripOpls: st.tripOpls,
      tripCounts: st.tripCounts,
      selectTrip: st.selectTrip,
      online: st.online,
      downloading: st.downloading,
      loadingTrips: st.loadingTrips,
      syncingOpl: st.syncingOpl,
      init: st.init,
      refresh: st.refresh,
      download: st.download,
      loadPlannedTrips: st.loadPlannedTrips,
      sync: st.sync,
      setTrolleyFromScan: st.setTrolleyFromScan,
      clearActiveTrolley: st.clearActiveTrolley,
      scanBucketFromScan: st.scanBucketFromScan,
      loadAllToTruck: st.loadAllToTruck,
      findReplacement: st.findReplacement,
      replaceBucket: st.replaceBucket,
      markNotFound: st.markNotFound,
      bucketIssueInfo: st.bucketIssueInfo,
      markIssued: st.markIssued,
      closeStop: st.closeStop,
      deliveryDate: st.deliveryDate,
      setDeliveryDate: st.setDeliveryDate,
      completedTrips: st.completedTrips,
      loadCompletedTrips: st.loadCompletedTrips,
      arrivals: st.arrivals,
      tripArrival: st.tripArrival,
      shelvedTrips: st.shelvedTrips,
      shelvedHub: st.shelvedHub,
      loadShelvedBuckets: st.loadShelvedBuckets,
    })),
  );

  // Skeletons only when the device has nothing saved to show and a pull (or download)
  // is running. Saved trips / requests show at once and update in place as pulls land;
  // while the saved lists are still being read (a moment) neither skeletons nor an
  // empty state show.
  const hasData =
    plannedTrips.length > 0 || requests.length > 0 || notScheduled.length > 0 || trolley.length > 0 || inTransit.length > 0;
  const fetching = !synced || downloading || loadingTrips;
  const firstLoad = hydrated ? fetching && !hasData : savedData === false;
  const settling = !hydrated && savedData !== false;

  // Shelved: the selected delivery date's buckets, pulled with the screen (its tab
  // shows the count), again when the date or tab changes, and on pull-to-refresh.
  // Not on every tab switch: opening Shelved re-pulls only once the last pull is older
  // than the sync interval (pull-to-refresh always pulls).
  const shelvedAt = useRef(0);
  // The first pull of the shelved buckets and of the trips on the road has come back:
  // until then an empty Shelved / Transit / History list shows skeletons, after it the
  // empty state (a later background pull never brings the skeletons back).
  const [shelvedPulled, setShelvedPulled] = useState(false);
  const [transitPulled, setTransitPulled] = useState(false);
  useEffect(() => {
    if (!online || !userFarm) return;
    shelvedAt.current = Date.now();
    loadShelvedBuckets(userFarm)
      .catch(() => {})
      .finally(() => setShelvedPulled(true));
  }, [deliveryDate, online, userFarm, loadShelvedBuckets]);
  useEffect(() => {
    if (tab !== 'shelved' || !online || !userFarm || Date.now() - shelvedAt.current < SYNC_INTERVAL_MS) return;
    shelvedAt.current = Date.now();
    loadShelvedBuckets(userFarm).catch(() => {});
  }, [tab, online, userFarm, loadShelvedBuckets]);
  // The trip opened from the Trips page (none = the Trips page). Every tab, count and
  // scan below is that trip's only: its orders (`tripOpls`, from the store).
  const selectedTrip = useMemo(
    () => (selectedTripId ? (plannedTrips.find((t) => t.tripId === selectedTripId) ?? null) : null),
    [plannedTrips, selectedTripId],
  );
  // Not Scheduled orders, opened read-only from the Trips page.
  const [showWaiting, setShowWaiting] = useState(false);
  // A History trip opened from the Trips page: the buckets it carried (read only).
  const [historyTripId, setHistoryTripId] = useState<string | null>(null);
  const scope = useMemo(() => (selectedTrip ? new Set(tripOpls) : null), [selectedTrip, tripOpls]);
  // An order on this trip only for a bucket it shares with another of the trip's orders
  // (one bucket, several orders): only those buckets show under it here.
  const ridingOnly = useMemo(
    () => ridingOnlyOpls(selectedTrip),
    [selectedTrip],
  );
  const sharedIds = useMemo(() => {
    if (!scope || !ridingOnly.size) return null;
    const ids = new Set<string>();
    const add = (o: { oplName: string; buckets: ReqBucket[] }) => {
      if (scope.has(o.oplName) && !ridingOnly.has(o.oplName)) for (const b of o.buckets) ids.add(b.bucketId.toUpperCase());
    };
    for (const g of requests) g.opls.forEach(add);
    [...trolley, ...inTransit].forEach(add);
    return ids;
  }, [scope, ridingOnly, requests, trolley, inTransit]);
  const tRequests = useMemo(
    () =>
      scope
        ? requests
            .map((g) => ({
              ...g,
              opls: g.opls
                .filter((o) => scope.has(o.oplName))
                .map((o) => {
                  if (!sharedIds || !ridingOnly.has(o.oplName)) return o;
                  const buckets = o.buckets.filter((b) => sharedIds.has(b.bucketId.toUpperCase()));
                  return { ...o, buckets, total: buckets.length, scanned: buckets.filter((b) => b.scanned).length };
                })
                .filter((o) => o.buckets.length),
            }))
            .filter((g) => g.opls.length)
        : requests,
    [requests, scope, sharedIds, ridingOnly],
  );
  const onlyShared = useCallback(
    (list: TrolleyOpl[]) =>
      list
        .map((o) => {
          if (!sharedIds || !ridingOnly.has(o.oplName)) return o;
          const buckets = o.buckets.filter((b) => sharedIds.has(b.bucketId.toUpperCase()));
          const ids = new Set(buckets.map((b) => b.pliId).filter(Boolean));
          return {
            ...o,
            buckets,
            pliIds: o.pliIds.filter((p) => ids.has(p)),
            ownPliIds: o.ownPliIds.filter((p) => ids.has(p)),
          };
        })
        .filter((o) => o.buckets.length),
    [sharedIds, ridingOnly],
  );
  const tTrolley = useMemo(
    () => (scope ? onlyShared(trolley.filter((o) => scope.has(o.oplName))) : trolley),
    [trolley, scope, onlyShared],
  );
  const tInTransit = useMemo(
    () => (scope ? onlyShared(inTransit.filter((o) => scope.has(o.oplName))) : inTransit),
    [inTransit, scope, onlyShared],
  );
  const tShelvedTrips = useMemo(
    () => (selectedTrip ? shelvedTrips.filter((t) => t.tripId === selectedTrip.tripId) : shelvedTrips),
    [shelvedTrips, selectedTrip],
  );
  const shelvedOf = (list: ShelvedTrip[]) => ({
    done: list.reduce((n, t) => n + t.shelved, 0),
    total: list.reduce((n, t) => n + t.total, 0),
  });
  // Every trip (the Trips page summary), and the open trip's (its tabs).
  const shelvedAll = useMemo(() => shelvedOf(shelvedTrips), [shelvedTrips]);
  const shelvedCount = useMemo(() => shelvedOf(tShelvedTrips), [tShelvedTrips]);
  // The open trip's bucket counts (zero until its first count comes back).
  const k = useMemo(
    () =>
      selectedTrip
        ? (tripCounts ?? NO_COUNTS)
        : { allBuckets, addedBuckets, transitBuckets, scannedBuckets, totalBuckets, requests: reqCount },
    [selectedTrip, tripCounts, allBuckets, addedBuckets, transitBuckets, scannedBuckets, totalBuckets, reqCount],
  );
  const requestedTotal = Math.max(k.allBuckets, shelvedCount.done);

  // In Transit: this farm's trips on the road (dispatched, not received yet), with
  // their arrival at the hub. Pulled when the tab opens.
  // Trucks on the road carrying an order for the delivery date on screen (Today /
  // Tomorrow) — a truck can carry several days' orders.
  const roadTrips = useMemo(
    () =>
      completedTrips.filter(
        (t) =>
          t.status === 'Dispatched' &&
          (!selectedTrip || t.tripId === selectedTrip.tripId) &&
          (!deliveryDate || t.orders.some((o) => !o.deliveryDate || o.deliveryDate === deliveryDate)),
      ),
    [completedTrips, deliveryDate, selectedTrip],
  );
  const transitAt = useRef(0);
  useEffect(() => {
    if (tab !== 'transit' || !online || !userFarm) return;
    let live = true;
    const pull = () => {
      transitAt.current = Date.now();
      return loadCompletedTrips(userFarm)
        .then(() => {
          setTransitPulled(true);
          if (!live) return;
          for (const t of useKarenBucketRequestsStore.getState().completedTrips) {
            if (t.status === 'Dispatched') tripArrival(t.tripId, userFarm, 'status').catch(() => {});
          }
        })
        .catch(() => {});
    };
    // Reopening the tab shows what it had; it pulls again only when that is stale.
    if (Date.now() - transitAt.current >= SYNC_INTERVAL_MS) pull();
    // Keep "Arrived at Kapkolia" live: it ticks as soon as shelving starts there.
    const timer = setInterval(pull, SYNC_INTERVAL_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [tab, online, userFarm, loadCompletedTrips, tripArrival]);
  // A History trip opened: re-pull the buckets dispatched from here, so it lists them.
  useEffect(() => {
    if (historyTripId && online && userFarm) loadShelvedBuckets(userFarm).catch(() => {});
  }, [historyTripId, online, userFarm, loadShelvedBuckets]);
  // Trips page: the trips already dispatched from this farm (History), pulled on
  // opening it and every SYNC_INTERVAL while it is up.
  useEffect(() => {
    if (selectedTrip || !online || !userFarm) return;
    loadCompletedTrips(userFarm)
      .catch(() => {})
      .finally(() => setTransitPulled(true));
    const timer = setInterval(() => loadCompletedTrips(userFarm).catch(() => {}), SYNC_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [selectedTrip, online, userFarm, loadCompletedTrips]);
  const onArrival = useStableCallback(async (tripId: string, action: 'status' | 'arrive' | 'complete') => {
    const r = await tripArrival(tripId, userFarm, action);
    if (!r.ok) showError(r.message);
    else if (r.message) showSuccess(r.message);
    return r.ok;
  });

  // Every bucket already on a trolley (or beyond), for "Added to trolley": the
  // requests' scanned ones plus every bucket of the orders on trolleys / trucks.
  const addedList = useMemo(() => {
    // Everything about each: bucket and qty, variety and length, order and customer.
    const out: { key: string; label: string; meta: string; sub?: string }[] = [];
    const add = (b: ReqBucket, order: string, customer: string) => {
      if (!b.scanned || b.notFound) return;
      out.push({
        key: `${order}-${b.id}`,
        label: `${b.bucketId.toUpperCase()} · ${bucketStems(b.qty, b.uom)} stems`,
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
    for (const g of tRequests) for (const o of g.opls) for (const b of o.buckets) add(b, g.orderName, o.customer || '');
    for (const o of [...tTrolley, ...tInTransit]) for (const b of o.buckets) add(b, o.orderName, o.customer || '');
    return out;
  }, [tRequests, tTrolley, tInTransit]);
  // Shelved at the hub for the day: bucket, shelf and time, order and customer.
  const shelvedList = useMemo(
    () =>
      tShelvedTrips.flatMap((t) =>
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
    [tShelvedTrips],
  );
  // The buckets already loaded and on the road (Trolley's summary: what left the trolley).
  const transitList = useMemo(() => {
    const keys = new Set(tInTransit.flatMap((o) => o.buckets.map((b) => `${o.orderName}-${b.id}`)));
    return addedList.filter((it) => keys.has(it.key));
  }, [addedList, tInTransit]);


  // Bucket Requests is for the remote farms; at the sales farm (the transfer hub) the
  // buckets arrive instead, so the page shows a note and nothing else.
  const savedHub = useTransferHub();
  const hubFarm = shelvedHub || savedHub || '';
  const atHub = !!userFarm && !!hubFarm && userFarm === hubFarm;

  // Every delivery date: an order shows once it is on a planned trip, and trips are
  // topped up with later days' orders. A date left over from an older build snaps back.
  useEffect(() => {
    if (deliveryDate) setDeliveryDate('', userFarm);
  }, [deliveryDate, userFarm, setDeliveryDate]);

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
  }, [activeTrolleyId, selectedTripId]);

  // Back to the Trips page: from Not Scheduled, or from a trip's scan page.
  const [tripStatus, setTripStatus] = useState<string | null>(null);
  // Taps change the page in this same render: the store's follow-up refresh is not awaited.
  const goBack = useStableCallback(() => {
    if (historyTripId) setHistoryTripId(null);
    else if (showWaiting) setShowWaiting(false);
    else if (selectedTripId) {
      setScanStatus(null);
      void selectTrip(null);
    }
  });
  const openTrip = useStableCallback((tripId: string) => {
    setScanStatus(null);
    setTripStatus(null);
    void selectTrip(tripId);
  });
  const openWaiting = useCallback(() => setShowWaiting(true), []);
  // Android back steps back to the Trips page before it leaves the screen.
  useFocusEffect(
    useCallback(() => {
      if (!historyTripId && !showWaiting && !selectedTripId) return;
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        goBack();
        return true;
      });
      return () => sub.remove();
    }, [historyTripId, showWaiting, selectedTripId, goBack]),
  );

  // The open trip left the plan or closed: the store went back to Trips; say why.
  useEffect(
    () =>
      useKarenBucketRequestsStore.subscribe((st, prev) => {
        if (!st.tripNotice || st.tripNotice === prev.tripNotice) return;
        setScanStatus(null);
        setTripStatus(st.tripNotice.message);
        showInfo(st.tripNotice.message);
      }),
    [showInfo],
  );

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

  // A scan the server refused after it was saved here (already issued / on a truck).
  useEffect(
    () =>
      useKarenBucketRequestsStore.subscribe((st, prev) => {
        if (!st.scanRefusal || st.scanRefusal === prev.scanRefusal) return;
        setScanStatus({ ok: false, message: st.scanRefusal.message });
        showError(st.scanRefusal.message);
      }),
    [showError],
  );

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
  const onLoad = useStableCallback((opls: TrolleyOpl[]) => {
    // Orders without a planned trip are offered too: the farm picks the truck that came.
    setLoadConfirm(planLoads(opls, plannedTrips, selectedTrip));
  });
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
      if (r.ok) {
        // The store went back to the Trips page: no leftover banner from the trip.
        setTripStatus(null);
        setScanStatus(null);
        showSuccess(r.message);
      }
      else {
        showError(r.message);
        return;
      }
    }
  };

  const onReplace = useStableCallback(async (b: ReqBucket) => {
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
      if (found.info) showInfo(found.message);
      else showError(found.message);
      return;
    }
    // No match still opens the sheet: the bucket can be marked not found there.
    setReplacePick({ bucket: b, pliId, neededQty: found.neededQty, candidates: found.candidates });
  });

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

  // The farm sends the truck once every bucket planned here is on it: the last stop
  // puts the trip in transit to the packhouse, an earlier one sends it to the next farm.
  const [sendingTrip, setSendingTrip] = useState<string | null>(null);
  const onSendTrip = useCallback(
    (t: PlannedTrip) => {
      const stop = (t.stops ?? []).find((st) => st.isYou);
      if (!stop || !userFarm) return;
      const onTruck = stop.loaded + stop.transit + stop.shelved;
      const stops = t.stops ?? [];
      const next = stops.filter((st) => st.stop > stop.stop).sort((a, b) => a.stop - b.stop)[0];
      const free = t.capacity > 0 ? Math.max(0, t.capacity - t.loadedBuckets) : 0;
      const fill = t.capacity > 0 ? `${t.loadedBuckets} of ${t.capacity} on the truck · ${free} free.` : '';
      const title = next ? `${t.vehicle} leaving for ${next.farm}?` : `Send ${t.vehicle} to ${hubFarm || 'Kapkolia'}?`;
      const body = next
        ? `${onTruck} bucket${onTruck === 1 ? '' : 's'} loaded here. ${fill}`
        : `${onTruck} bucket${onTruck === 1 ? '' : 's'} go in transit. ${fill}`;
      showDialog(
        title,
        body.trim(),
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: next ? 'Leave' : 'Send',
            onPress: async () => {
              setSendingTrip(t.tripId);
              const r = await closeStop(t.tripId, userFarm);
              setSendingTrip(null);
              if (r.ok) showSuccess(r.message);
              else showError(r.message);
            },
          },
        ],
        { name: 'car-outline', tone: free > 0 ? 'warn' : 'info' },
      );
    },
    [userFarm, hubFarm, closeStop, showSuccess, showError],
  );

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

  const onConfirmReplace = (
    c: ReplacementCandidate,
    reason: ReplaceReason,
    notes?: string,
    correction?: ReplaceCorrection,
  ) => {
    const pick = replacePick;
    if (!pick) return;
    const old = pick.bucket.bucketId.toUpperCase();
    const real = [correction?.variety, correction?.stemLength].filter(Boolean).join(' · ');
    confirm(
      'Replace this bucket?',
      `${old} is replaced with ${c.bucketId.toUpperCase()}${c.shelf ? ` (shelf ${c.shelf.toUpperCase()})` : ''} — ${reason.toLowerCase()}.` +
        (real ? ` ${old} stays on its shelf, recorded as ${real}.` : ''),
      'Replace',
      () => void doReplace(c, reason, notes, correction),
    );
  };
  const doReplace = async (
    c: ReplacementCandidate,
    reason: ReplaceReason,
    notes?: string,
    correction?: ReplaceCorrection,
  ) => {
    const pick = replacePick;
    if (!pick || replaceBusy.current) return;
    replaceBusy.current = true;
    setReplacePick(null);
    setReplacingId(pick.bucket.id);
    const r = await replaceBucket(pick.bucket.id, pick.pliId, c.bucketId, reason, notes, correction);
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

  const onRefresh = useStableCallback(async () => {
    setRefreshing(true);
    try {
      // On the Trips page and the Requests tab a pull also re-pulls the live plan (when online).
      if ((!selectedTrip || tab === 'requests') && online) await loadPlannedTrips(userFarm);
      if ((!selectedTrip || tab === 'shelved') && online) await loadShelvedBuckets(userFarm);
      if (!selectedTrip && online) await loadCompletedTrips(userFarm).catch(() => {});
      await refresh();
    } finally {
      setRefreshing(false);
    }
  });

  // Everything the pages below hand to their (memoised) lists, kept stable across
  // renders so a scan, a banner or a sync re-renders only what it changed.
  const refreshControl = useMemo(
    () => <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.text} />,
    [refreshing, onRefresh],
  );
  const listsFor = useDeferredValue(selectedTripId);
  const shelvedLoading = online && !shelvedPulled;
  const transitLoading = online && !transitPulled;
  const oneTrip = useMemo(() => (selectedTrip ? [selectedTrip] : []), [selectedTrip]);
  const waitingSorted = useMemo(() => sortWaiting(notScheduled), [notScheduled]);
  const waitingN = useMemo(() => waitingBuckets(notScheduled), [notScheduled]);
  const tripsTotals = useMemo(
    () => ({
      requested: Math.max(allBuckets, shelvedAll.done),
      trolley: addedBuckets,
      transit: transitBuckets,
      shelved: shelvedAll.done,
    }),
    [allBuckets, addedBuckets, transitBuckets, shelvedAll.done],
  );
  const phoneTrolley = useMemo(
    () => tTrolley.reduce((n, o) => n + o.buckets.filter((b) => b.scanned && !b.notFound).length, 0),
    [tTrolley],
  );
  const segOptions = useMemo(
    () => [
      // Every count is BUCKETS, out of the same total — the buckets requested —
      // and a stage counts a bucket once it has reached it (on a trolley ⊇ on a
      // truck ⊇ shelved). The shelving list can hold buckets the device no longer
      // lists (a closed stop), so the total never reads below what's shelved.
      { value: 'requests' as Tab, label: 'Requests', count: requestedTotal },
      { value: 'trolley' as Tab, label: 'Trolley', count: `${k.addedBuckets}/${requestedTotal}` },
      { value: 'transit' as Tab, label: 'Transit', count: `${k.transitBuckets}/${requestedTotal}` },
      { value: 'shelved' as Tab, label: 'Shelved', count: `${shelvedCount.done}/${requestedTotal}` },
    ],
    [requestedTotal, k.addedBuckets, k.transitBuckets, shelvedCount.done],
  );
  const onSegment = useCallback((v: string) => setTab(v as Tab), [setTab]);
  // The scan result, at the top of the open tab's list.
  const banner = useMemo(
    () =>
      scanStatus ? (
        <View style={[s.statusBanner, scanStatus.ok ? s.statusOk : s.statusErr]}>
          <Ionicons
            name={scanStatus.ok ? 'checkmark-circle' : 'alert-circle'}
            size={18}
            color={scanStatus.ok ? (COLORS.success ?? '#12B76A') : (COLORS.danger ?? '#EF4444')}
          />
          <Text
            style={[s.statusText, { color: scanStatus.ok ? (COLORS.success ?? '#067647') : (COLORS.danger ?? '#B42318') }]}
            numberOfLines={2}
          >
            {scanStatus.message}
          </Text>
        </View>
      ) : null,
    [scanStatus],
  );
  // The same summary of the day's OPLs at the end of Requests, Trolley and In Transit.
  const summary = useMemo(
    () => (
      <Card title="Summary of this trip">
        <StageSummary icon="cart-outline" label="Added to trolley" done={k.addedBuckets} total={k.allBuckets} items={addedList} />
        <StageSummary
          icon="car-outline"
          label="Loaded and in transit"
          done={transitList.length}
          total={k.allBuckets}
          items={transitList}
        />
        <StageSummary
          icon="checkmark-done-outline"
          label={`Shelved at ${shelvedHub || 'Kapkolia'}`}
          done={shelvedCount.done}
          total={shelvedCount.total || k.allBuckets}
          items={shelvedList}
        />
      </Card>
    ),
    [k.addedBuckets, k.allBuckets, addedList, transitList, shelvedHub, shelvedCount, shelvedList],
  );
  // A History trip opened from the Trips page: the buckets it carried, each with where
  // it is now (read only).
  const history = useMemo(() => {
    if (!historyTripId) return null;
    const h = completedTrips.find((t) => t.tripId === historyTripId);
    const sh = shelvedTrips.find((t) => t.tripId === historyTripId);
    // Variety, length and colour from the phone's own copy of the bucket (by order).
    const local = new Map<string, ReqBucket>();
    for (const o of [...requests.flatMap((g) => g.opls), ...trolley, ...inTransit])
      for (const b of o.buckets) local.set(`${o.oplName}|${b.bucketId.toUpperCase()}`, b);
    const rows: ListRow[] = (sh?.buckets ?? []).map((x, i) => {
      const b = local.get(`${x.opl}|${x.bucketId.toUpperCase()}`);
      return {
        b: {
          ...(b ?? {
            id: -1 - i,
            variety: x.variety,
            farm: userFarm,
            stemLength: x.stemLength,
            qty: x.stems,
            uom: 'Stems',
            scanned: true,
            notFound: false,
            trolleyId: null,
            pliId: null,
            asap: false,
            scheduled: true,
          }),
          id: b ? b.id : -1 - i,
          // The server's record of what went on this trip wins over the phone's copy.
          variety: x.variety || b?.variety || '',
          stemLength: x.stemLength || b?.stemLength || '',
          qty: x.stems || b?.qty || 0,
          uom: x.stems ? 'Stems' : b?.uom || '',
          varietyColor: x.varietyColor || b?.varietyColor || '',
          bucketId: x.bucketId,
          shelf: x.shelved ? x.shelf : b?.shelf || '',
        },
        orderName: x.orderName || x.opl,
        onTruck: !x.shelved,
      };
    });
    const title = h ? `${h.vehicle || 'Truck'}${h.run ? ` · Trip ${h.run}` : ''}` : sh?.vehicle || 'Trip';
    const shelvedN = (sh?.buckets ?? []).filter((x) => x.shelved).length;
    return { h, rows, title, shelvedN };
  }, [historyTripId, completedTrips, shelvedTrips, requests, trolley, inTransit, userFarm]);

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

  const offlineNote = !online ? (
    <Text style={s.offline}>Offline — you can still scan; downloads need internet.</Text>
  ) : null;

  // A History trip: the buckets it carried, each with where it is now (read only).
  if (history) {
    const { h, rows, title, shelvedN } = history;
    return (
      <Screen title="Bucket Requests" scroll={false} headerRight={headerActions}>
        {offlineNote}
        <PageBar
          title={title}
          sub={[
            `${rows.length} bucket${rows.length === 1 ? '' : 's'}`,
            `${shelvedN} shelved at ${shelvedHub || 'Kapkolia'}`,
            h?.leftAt ? `Left ${dateTimeLabel(h.leftAt)}` : '',
          ]
            .filter(Boolean)
            .join(' · ')}
          onBack={goBack}
        />
        <VarietyList
          rows={rows}
          hub={shelvedHub}
          history
          loading={shelvedLoading}
          refreshControl={refreshControl}
          empty={
            <Card>
              <View style={s.empty}>
                <Ionicons name="cube-outline" size={26} color={COLORS.textMuted} />
                <Text style={s.emptyTitle}>{online ? 'No buckets recorded on this trip' : 'Connect to see this trip\'s buckets'}</Text>
              </View>
            </Card>
          }
        />
      </Screen>
    );
  }

  // Not Scheduled: read-only, nothing to scan.
  if (showWaiting) {
    return (
      <Screen title="Bucket Requests" scroll={false} headerRight={headerActions}>
        {offlineNote}
        <PageBar title={`Not Scheduled (${waitingN}bkts)`} sub="On no truck yet" onBack={goBack} />
        <NotScheduledList groups={waitingSorted} refreshControl={refreshControl} />
      </Screen>
    );
  }

  // No trip open: the Trips page — this farm's trips to pick from.
  if (!selectedTrip) {
    return (
      <Screen title="Bucket Requests" scroll={false} headerRight={headerActions}>
        {offlineNote}
        <TripsPage
          farm={userFarm}
          hub={shelvedHub}
          trips={plannedTrips}
          requests={requests}
          trolley={trolley}
          notScheduled={notScheduled}
          waitingN={waitingN}
          history={completedTrips}
          historyBuckets={shelvedTrips}
          onOpenHistory={setHistoryTripId}
          loading={firstLoad}
          settling={settling}
          notice={tripStatus}
          totals={tripsTotals}
          onOpen={openTrip}
          onOpenWaiting={openWaiting}
          onSendTrip={onSendTrip}
          sendingTrip={sendingTrip}
          refreshControl={refreshControl}
        />
      </Screen>
    );
  }

  const st = tripState(selectedTrip, shelvedHub, phoneTrolley);
  // A trip just opened paints its bar, scan field and tabs first; its lists follow
  // in the next (interruptible) render.
  const listsReady = listsFor === selectedTrip.tripId;
  // The tab on screen: the one tapped once its list is mounted; a tab opened for the
  // first time shows skeletons until its list's first cards are drawn.
  const shownTab: Tab | null = listsReady && opened.includes(picked) ? picked : null;
  return (
    <Screen title="Bucket Requests" scroll={false} headerRight={headerActions}>
      {/* Fixed above the list: the trip, the scan field and the farm badge on its edge
          stay put while the requests scroll. */}
      {offlineNote}
      <PageBar
        title={tripName(selectedTrip)}
        sub={[
          selectedTrip.runChain || `${userFarm || 'Farm'} → ${shelvedHub || 'Kapkolia'}`,
          selectedTrip.createdAt ? `Created ${dateTimeLabel(selectedTrip.createdAt)}` : '',
          selectedTrip.scheduledAt ? `Scheduled ${dateTimeLabel(selectedTrip.scheduledAt)}` : '',
        ]
          .filter(Boolean)
          .join(' · ')}
        state={st}
        onBack={goBack}
      />

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
      <Segmented radius={10} value={picked} onChange={onSegment} options={segOptions} />

      {/* Lazily mounted, then kept: a hidden tab keeps its rendered list and skips
          re-rendering until it is shown again. Each tab is its own list. */}
      {shownTab ? null : (
        <View style={s.tabShown}>
          <SkeletonCards cards={2} />
        </View>
      )}
      {listsReady && opened.includes('requests') ? (
        <FadeIn style={shownTab === 'requests' ? s.tabShown : s.tabHidden}>
          <Frozen active={shownTab === 'requests'}>
            <RequestsTab
              farm={userFarm}
              hub={shelvedHub}
              groups={tRequests}
              notScheduled={NO_GROUPS}
              schedules={schedules}
              plannedTrips={plannedTrips}
              trips={oneTrip}
              scope={scope ?? undefined}
              oplTrip={oplTrip}
              oplTeam={oplTeam}
              loading={firstLoad}
              replacingId={replacingId}
              onReplace={onReplace}
              onSendTrip={onSendTrip}
              sendingTrip={sendingTrip}
              header={banner}
              footer={summary}
              refreshControl={refreshControl}
            />
          </Frozen>
        </FadeIn>
      ) : null}
      {listsReady && opened.includes('trolley') ? (
        <FadeIn style={shownTab === 'trolley' ? s.tabShown : s.tabHidden}>
          <Frozen active={shownTab === 'trolley'}>
            <TrolleyTab
              items={tTrolley}
              syncingOpl={syncingOpl}
              onLoad={onLoad}
              scanned={k.scannedBuckets}
              total={k.totalBuckets}
              header={banner}
              footer={summary}
              refreshControl={refreshControl}
            />
          </Frozen>
        </FadeIn>
      ) : null}
      {listsReady && opened.includes('shelved') ? (
        <FadeIn style={shownTab === 'shelved' ? s.tabShown : s.tabHidden}>
          <Frozen active={shownTab === 'shelved'}>
            <ShelvedTab
              trips={tShelvedTrips}
              hub={shelvedHub}
              loading={shelvedLoading}
              online={online}
              day={deliveryDate ? dateLabel(deliveryDate) : ''}
              header={banner}
              refreshControl={refreshControl}
            />
          </Frozen>
        </FadeIn>
      ) : null}
      {listsReady && opened.includes('transit') ? (
        <FadeIn style={shownTab === 'transit' ? s.tabShown : s.tabHidden}>
          <Frozen active={shownTab === 'transit'}>
            <InTransitTab
              hub={shelvedHub}
              items={tInTransit}
              trips={roadTrips}
              arrivals={arrivals}
              deliveryDate={deliveryDate}
              online={online}
              loading={transitLoading}
              onArrival={onArrival}
              header={banner}
              footer={summary}
              refreshControl={refreshControl}
            />
          </Frozen>
        </FadeIn>
      ) : null}

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

const NO_COUNTS = { allBuckets: 0, addedBuckets: 0, transitBuckets: 0, scannedBuckets: 0, totalBuckets: 0, requests: 0 };
const NO_GROUPS: OrderGroup[] = [];

/** A hidden tab skips re-rendering (a scan refreshes every list); it renders again,
 *  with the latest data, the moment it is shown. */
const Frozen = memo(
  function Frozen({ children }: { active: boolean; children: ReactNode }) {
    return <>{children}</>;
  },
  (prev, next) => !prev.active && !next.active,
);

/** One truck's share of a load: the orders planned on that truck's trip. */
type PlannedLoad = { vehicle: string; plannedVehicle: string; tripId: string; status: string; opls: TrolleyOpl[] };

/** Orders on no planned trip load onto the truck the farm picks; the server puts them
 *  on that truck's run visiting the farm (or an unscheduled trip). */
const UNPLANNED = 'unplanned';

/** Group the orders being loaded by the truck their planned trip uses. An order on
 *  several trips takes the run the truck is loading now, else the earliest one still
 *  open (the list comes date- and run-sorted); a trip whose stop here is closed is done. */
/** `pref`: the trip open on screen — its trolleys' orders (ASAP ones too) all go on it. */
function planLoads(opls: TrolleyOpl[], trips: PlannedTrip[], pref?: PlannedTrip | null): PlannedLoad[] {
  const byTrip = new Map<string, PlannedLoad>();
  const open = trips.filter((tr) => tr.vehicle && !tr.yourStopClosed);
  const mine = pref && pref.vehicle && !pref.yourStopClosed ? pref : null;
  for (const o of opls) {
    const has = (tr: PlannedTrip) => (tr.orders ?? []).some((x) => x.opl === o.oplName);
    const t = mine ?? open.find((tr) => tr.current && has(tr)) ?? open.find(has);
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
  // No planned trip: open the truck list straight away.
  const startChanging = (l: PlannedLoad[] | null) =>
    (l ?? []).some((g) => g.tripId === UNPLANNED && !g.vehicle) ? UNPLANNED : null;
  const [draft, setDraft] = useState<PlannedLoad[]>(loads ?? []);
  const [changing, setChanging] = useState<string | null>(() => startChanging(loads)); // tripId whose truck is being changed
  const [query, setQuery] = useState('');
  // A new set of loads starts the dialog afresh.
  const [loadsFor, setLoadsFor] = useState(loads);
  if (loadsFor !== loads) {
    setLoadsFor(loads);
    setDraft(loads ?? []);
    setChanging(startChanging(loads));
    setQuery('');
  }

  const plate = (name: string) => vehicles.find((v) => v.name === name)?.licensePlate || name;
  const total = useMemo(() => loadBucketCount(draft.flatMap((g) => g.opls)), [draft]);
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
            // The truck is named on the card above: "Load 21 buckets" fits on one line.
            label={`Load ${plural(total, 'bucket')}`}
            iconLeft="car-outline"
            onPress={() => onConfirm(draft)}
            disabled={!online || !!changing || !total || draft.some((g) => !g.vehicle)}
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
                  {o.oplName}
                </Text>
              </View>
              <Text style={s.loadOrderCount}>
                {loadBucketCount([o])} bkt
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
  onPick: (c: ReplacementCandidate, reason: ReplaceReason, notes?: string, correction?: ReplaceCorrection) => void;
  /** Not in the cold room and nothing to replace it: leave it out of the transfer. */
  onNotFound: () => void;
  /** "Issued offline": where the bucket was issued (which line). */
  issueInfo: () => Promise<BucketIssueInfo | { kind: 'error'; message: string } | null>;
  /** Issued to this order's own line: mark it issued instead of replacing it. */
  onMarkIssued: (line: string) => void;
}) {
  const candidates = pick?.candidates ?? [];
  // Default to the best match each time the sheet opens for a bucket.
  const firstId = candidates[0]?.bucketId ?? null;
  const [selected, setSelected] = useState<string | null>(firstId);
  // Why the bucket is being replaced — goes on the Bucket Replacement record.
  const [reason, setReason] = useState<ReplaceReason>('Missing');
  const [pickFor, setPickFor] = useState<{ pick: typeof pick; firstId: string | null }>({ pick, firstId });
  // Wrong variety: what the bucket really holds, so its record is corrected.
  const [realVariety, setRealVariety] = useState('');
  const [realLength, setRealLength] = useState('');
  const [varieties, setVarieties] = useState<string[]>([]);
  const [lengths, setLengths] = useState<string[]>([]);
  if (pickFor.pick !== pick || pickFor.firstId !== firstId) {
    setPickFor({ pick, firstId });
    setSelected(firstId);
    setReason('Missing');
    setRealVariety('');
    setRealLength('');
  }
  const wrongVariety = reason === 'Wrong variety';
  useEffect(() => {
    if (!wrongVariety) return;
    if (!varieties.length) karenShelfOperationsRepository.fetchVarieties().then(setVarieties).catch(() => {});
    if (!lengths.length) karenShelfOperationsRepository.fetchStemLengths().then(setLengths).catch(() => {});
  }, [wrongVariety, varieties.length, lengths.length]);
  const correction: ReplaceCorrection | undefined = wrongVariety
    ? { variety: realVariety || undefined, stemLength: realLength || undefined }
    : undefined;
  // Wrong variety needs at least what it really holds before it can be replaced.
  const correctionMissing = wrongVariety && !realVariety && !realLength;
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
  // Stems: the server sums the rows' stock qty; else the bucket's own stems.
  const needed = pick?.neededQty ?? (b ? bucketStems(b.qty, b.uom) : null);

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
              needed != null ? `${Math.round(needed)} stems needed` : '',
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
          {wrongVariety ? (
            <View style={s.correctBox}>
              <Text style={s.correctNote}>
                {b?.bucketId} stays on its shelf. Enter what it really holds so its record is corrected.
              </Text>
              <Dropdown
                label="Real variety"
                iconName="flower-outline"
                value={realVariety}
                options={[
                  { label: 'Same as recorded', value: '' },
                  ...varieties.map((v) => ({ label: v, value: v })),
                ]}
                placeholder={varieties.length ? 'Pick the variety' : 'Loading…'}
                onChange={setRealVariety}
              />
              <Dropdown
                label="Real stem length"
                iconName="ruler"
                value={realLength}
                options={[
                  { label: 'Same as recorded', value: '' },
                  ...lengths.map((l) => ({ label: l, value: l })),
                ]}
                placeholder={lengths.length ? 'Pick the stem length' : 'Loading…'}
                onChange={setRealLength}
              />
            </View>
          ) : null}
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
                  onPress={() => chosen && onPick(chosen, reason, undefined, correction)}
                  disabled={!chosen || correctionMissing || (reason === 'Issued offline' && issuedLoading)}
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
const RequestsTab = memo(function RequestsTab({
  farm,
  hub,
  groups,
  notScheduled,
  schedules,
  plannedTrips,
  trips,
  oplTrip,
  oplTeam,
  loading,
  replacingId,
  onReplace,
  onSendTrip,
  sendingTrip,
  scope,
  header,
  footer,
  refreshControl,
}: {
  /** This station's farm and the packhouse it sends to: an order's trip reads "farm → hub". */
  farm: string;
  hub: string;
  groups: OrderGroup[];
  /** Orders on no truck trip yet: listed greyed after the trips, never loadable. */
  notScheduled: OrderGroup[];
  schedules: OplSchedule[];
  plannedTrips: PlannedTrip[];
  /** Open trips for this farm (stop not closed yet). */
  trips: PlannedTrip[];
  oplTrip: OplTripMap;
  oplTeam: Record<string, string>;
  /** A download or trip-plan pull is running: skeletons while the list is empty. */
  loading: boolean;
  replacingId: number | null;
  onReplace: (b: ReqBucket) => void;
  onSendTrip?: (t: PlannedTrip) => void;
  sendingTrip?: string | null;
  /** One trip open: its picklists (ASAP replacements following their order included). */
  scope?: Set<string>;
  header?: ReactElement | null;
  footer?: ReactElement | null;
  refreshControl?: ReactElement;
}) {
  const lineColor = useMemo(() => lineColors(schedules), [schedules]);
  const groupByOrder = useKarenBucketRequestsStore((st) => st.groupByOrder);

  // Order and grouping: worked out once per change of the lists, not on every render.
  const plan = useMemo(() => {
    // Shown in sequence steps, as transfers move: every team's #1, then every team's
    // #2 … (Team A #1, Team B #1, … Team A #2 …); orders only on a trip follow in trip
    // order; unscheduled ones sink to the bottom (greyed).
    const isScheduled = (g: OrderGroup) => g.opls.some((o) => !!oplTrip[o.oplName]);
    const slot = new Map<string, [string, number]>();
    for (const sc of schedules) {
      if (sc.scheduled) slot.set(sc.oplName, [sc.team || '~', sc.sequence || Number.MAX_SAFE_INTEGER]);
    }
    plannedTrips.forEach((t, ti) =>
      (t.orders ?? []).forEach((o, oi) => {
        if (o.opl && !slot.has(o.opl)) slot.set(o.opl, ['~~', 1_000_000 + ti * 1000 + oi]);
      }),
    );
    // Step (schedule #) first, then team.
    const bySlot = (ra: [string, number], rb: [string, number]) =>
      ra[1] !== rb[1] ? ra[1] - rb[1] : ra[0] === rb[0] ? 0 : ra[0] < rb[0] ? -1 : 1;
    const rankOf = (g: OrderGroup): [string, number] => {
      let best: [string, number] = ['~~~', Number.MAX_SAFE_INTEGER];
      for (const o of g.opls) {
        const r = slot.get(o.oplName);
        if (r && bySlot(r, best) < 0) best = r;
      }
      return best;
    };
    const unslotted: [string, number] = ['~~~', Number.MAX_SAFE_INTEGER];
    // Schedule numbers restart each delivery day: the earlier day's orders come first.
    const dayOf = (g: OrderGroup) =>
      g.opls.map((o) => o.deliveryDate).filter(Boolean).sort()[0] || '9999-12-31';
    const sorted = [...groups]
      .sort((a, b) => {
        const byScheduled = Number(isScheduled(b)) - Number(isScheduled(a));
        if (byScheduled) return byScheduled;
        const byDay = dayOf(a).localeCompare(dayOf(b));
        if (byDay) return byDay;
        return bySlot(rankOf(a), rankOf(b));
      })
      // An order's picklists in their own schedule order too.
      .map((g) => ({
        ...g,
        opls: [...g.opls].sort(
          (a, b) =>
            (a.deliveryDate || '').localeCompare(b.deliveryDate || '') ||
            bySlot(slot.get(a.oplName) ?? unslotted, slot.get(b.oplName) ?? unslotted),
        ),
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
    const byTrip = new Map(
      steps.map((t) => [
        t.tripId,
        sorted
          .map((g) => ({
            ...g,
            opls: g.opls.filter((o) => (scope ? scope.has(o.oplName) : tripOf.get(o.oplName) === t.tripId)),
          }))
          .filter((g) => g.opls.length),
      ]),
    );
    // Picking order across every trip as listed (every team's #1, then #2 …): the
    // number on each order.
    const pickPos = new Map<string, number>();
    for (const t of steps)
      for (const g of byTrip.get(t.tripId) ?? []) if (!pickPos.has(g.orderName)) pickPos.set(g.orderName, pickPos.size + 1);
    return { steps, byTrip, pickPos };
  }, [groups, schedules, plannedTrips, trips, oplTrip, scope]);

  // A trip opened from the Trips page: its bar already names it -- just its orders.
  // Grouped by variety; the order rides on each row ("43cm(ORDER)"), in pick order.
  const sections = useMemo(() => {
    if (!scope) return [];
    const rows: ListRow[] = plan.steps.flatMap((t) =>
      (plan.byTrip.get(t.tripId) ?? []).flatMap((g) => g.opls.flatMap((o) => o.buckets.map((b) => ({ b, orderName: g.orderName })))),
    );
    return listSections(rows, groupByOrder, (o) => plan.pickPos.get(o) ?? Number.MAX_SAFE_INTEGER);
  }, [scope, plan, groupByOrder]);

  const waitingSorted = useMemo(() => sortWaiting(notScheduled), [notScheduled]);
  const items = useMemo((): CardItem[] => {
    // Not on a truck yet: what is coming, by delivery day, below everything loadable.
    const waiting: CardItem[] = notScheduled.length
      ? [
          {
            key: 'waiting-hdr',
            render: () => <Text style={s.sectionHdr}>Not Scheduled ({waitingBuckets(notScheduled)}bkts)</Text>,
          },
          ...notScheduledCards(waitingSorted, groupByOrder),
        ]
      : [];

    if (!trips.length) {
      if (loading && !waiting.length) return [{ key: 'skeleton', render: () => <SkeletonCards /> }];
      return [
        {
          key: 'empty',
          render: () => (
            <Card>
              <View style={s.empty}>
                <Ionicons name="download-outline" size={26} color={COLORS.textMuted} />
                <Text style={s.emptyTitle}>No new Scheduled Requests</Text>
              </View>
            </Card>
          ),
        },
        ...waiting,
      ];
    }

    if (scope) {
      return [
        ...(sections.length
          ? sections.map((sec) => ({
              key: `v-${sec.key}`,
              render: () => (
                <VarietyCard section={sec} byOrder={groupByOrder} replacingId={replacingId} onReplace={onReplace} />
              ),
            }))
          : [
              {
                key: 'all-scanned',
                render: () => (
                  <Card>
                    <Text style={s.tripAllScanned}>Every bucket for this trip is scanned — see Trolley.</Text>
                  </Card>
                ),
              },
            ]),
        ...waiting,
      ];
    }

    // Only picklists on a trip are listed: one not on a trip yet appears once it is planned.
    const renderGroup = (g: OrderGroup) => {
      const pos = plan.pickPos.get(g.orderName);
      // Just the pick number and the order name: customer, day and team stay on the
      // picklist data (scans still flag the right picklist) but are not shown.
      return (
        <View key={g.orderName} style={s.groupInTrip}>
          <View>
            <View style={s.groupLine}>
              {pos ? (
                <View style={[s.pickBadge, pos === 1 ? s.pickBadgeFirst : null]}>
                  <Text style={[s.pickBadgeText, pos === 1 ? s.pickBadgeTextFirst : null]}>{pos}</Text>
                </View>
              ) : null}
              <Text style={[s.groupHdr, s.groupNames]}>{g.orderName}</Text>
            </View>
          </View>
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
    };
    return [
      ...plan.steps.map((t, i) => ({
        key: `trip-${t.tripId}`,
        render: () => {
          const tripGroups = plan.byTrip.get(t.tripId) ?? [];
          return (
            <View style={s.step}>
              <View style={[s.stepBody, !t.current ? s.stepBodyLater : null]}>
                {/* One card per trip: the trip, then its picklists still to scan. */}
                <TripCard
                  trip={t}
                  onSend={onSendTrip ? () => onSendTrip(t) : undefined}
                  sending={sendingTrip === t.tripId}
                  route={farm ? `${farm} → ${hub || 'Kapkolia'}` : undefined}
                  scanned={tripGroups.reduce((n, g) => n + g.opls.reduce((m, o) => m + o.scanned, 0), 0)}
                  scanTotal={tripGroups.reduce((n, g) => n + g.opls.reduce((m, o) => m + o.total, 0), 0)}
                >
                  {tripGroups.length ? (
                    tripGroups.map(renderGroup)
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
        },
      })),
      ...waiting,
    ];
  }, [notScheduled, waitingSorted, groupByOrder, trips, loading, scope, sections, replacingId, onReplace, plan, oplTrip, oplTeam, lineColor, farm, hub, onSendTrip, sendingTrip]);

  return <CardList items={items} header={header} footer={footer} refreshControl={refreshControl} initial={2} />;
});

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** A Not Scheduled order's buckets its cards list: waiting on the shelf, or already on
 *  a trolley (another phone scanned it; the order is on no truck trip yet). */
const waitingRow = (b: ReqBucket) => !b.notFound && !b.truckLoaded && !b.truckTransit;

/** Buckets still waiting on the shelf in Not Scheduled orders. The ones already on a
 *  trolley are listed too, but counted on the On trolley tile, not here. */
function waitingBuckets(groups: OrderGroup[]): number {
  return groups.reduce(
    (n, g) => n + g.opls.reduce((m, o) => m + o.buckets.filter((b) => waitingRow(b) && !b.scanned).length, 0),
    0,
  );
}

/** Not Scheduled orders by delivery day, then name. */
function sortWaiting(groups: OrderGroup[]): OrderGroup[] {
  const day = (g: OrderGroup) => g.opls.map((o) => o.deliveryDate).filter(Boolean).sort()[0] || '9999-12-31';
  return [...groups].sort((a, b) => day(a).localeCompare(day(b)) || a.orderName.localeCompare(b.orderName));
}

/** "KCA 123X · Trip 2 of 3". */
function tripName(t: PlannedTrip): string {
  return `${t.vehicle || 'No truck yet'}${t.run ? ` · Trip ${t.run}` : ''}`;
}

type TripStateUi = { label: string; tone: 'now' | 'wait' | 'done'; color?: string };

/** Where a trip stands for this farm: from its buckets' flags here -- on a trolley
 *  (staging), loading to the truck, in transit, arrived at the hub -- else where the
 *  run is (loading now / waits for an earlier trip). `phoneTrolley`: buckets this
 *  phone has on trolleys that the server has not heard of yet. */
function tripState(t: PlannedTrip, hub?: string, phoneTrolley = 0): TripStateUi {
  const stop = (t.stops ?? []).find((st) => st.isYou);
  if (stop && stop.total > 0) {
    const moving = stop.transit + stop.shelved;
    if (stop.shelved === stop.total) return { label: `Arrived at ${hub || 'Kapkolia'}`, tone: 'done', color: '#0e7490' };
    if (moving > 0 && (moving === stop.total || t.status === 'Dispatched' || t.yourStopClosed))
      return { label: 'In transit', tone: 'now', color: '#1d4ed8' };
    if (stop.loaded > 0 || stop.transit > 0) return { label: 'Loading to truck', tone: 'now', color: '#2563eb' };
    if (stop.trolley > 0 || phoneTrolley > 0) return { label: 'On trolley (Staging)', tone: 'now', color: '#7c3aed' };
  } else if (phoneTrolley > 0) {
    return { label: 'On trolley (Staging)', tone: 'now', color: '#7c3aed' };
  }
  if (t.status === 'Dispatched') return { label: 'In transit', tone: 'done', color: '#1d4ed8' };
  if (t.status === 'Received') return { label: `Arrived at ${hub || 'Kapkolia'}`, tone: 'done', color: '#0e7490' };
  if (t.yourStopClosed) return { label: 'Stop closed', tone: 'done' };
  // Nothing on a trolley yet: its buckets wait on the shelves for this run.
  if (t.current) return { label: 'Awaiting transfer', tone: 'now', color: '#d97706' };
  return { label: t.afterRun ? `Waits for Trip ${t.afterRun}` : 'Later', tone: 'wait' };
}

function StatePill({ state }: { state: TripStateUi }) {
  return (
    <View
      style={[
        s.tripPill,
        state.tone === 'now' ? s.tripPillConfirmed : s.tripPillDraft,
        state.color ? { backgroundColor: state.color } : null,
      ]}
    >
      <Text
        style={[
          s.tripPillText,
          state.tone === 'now' || state.color ? s.tripPillTextConfirmed : s.tripPillTextDraft,
        ]}
      >
        {state.label}
      </Text>
    </View>
  );
}

/** The bar above a sub-page: back to Trips, what is open, and its state. */
function PageBar({
  title,
  sub,
  state,
  onBack,
}: {
  title: string;
  sub?: string;
  state?: TripStateUi;
  onBack: () => void;
}) {
  return (
    <View style={s.pageBar}>
      <Pressable onPress={onBack} hitSlop={8} style={s.backBtn} accessibilityRole="button" accessibilityLabel="Back to trips">
        <Ionicons name="chevron-back" size={18} color={COLORS.text} />
        <Text style={s.backText}>Trips</Text>
      </Pressable>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={s.pageBarTitle} numberOfLines={2}>
          {title}
        </Text>
        {sub ? (
          <Text style={s.tripMeta} numberOfLines={2}>
            {sub}
          </Text>
        ) : null}
      </View>
      {state ? <StatePill state={state} /> : null}
    </View>
  );
}

/** The first page: this farm's trips, with what they carry from here, to open one and
 *  load it. Open trips in collection order (by day, the run loading now first, then
 *  later runs); closed ones below, muted; Not Scheduled orders last, read-only. */
const TripsPage = memo(function TripsPage({
  farm,
  hub,
  trips,
  requests,
  trolley,
  notScheduled,
  waitingN,
  history,
  historyBuckets,
  loading,
  settling,
  notice,
  totals,
  onOpen,
  onOpenWaiting,
  onOpenHistory,
  onSendTrip,
  sendingTrip,
  refreshControl,
}: {
  farm: string;
  hub: string;
  trips: PlannedTrip[];
  requests: OrderGroup[];
  trolley: TrolleyOpl[];
  notScheduled: OrderGroup[];
  /** Buckets waiting in the Not Scheduled orders. */
  waitingN: number;
  /** This farm's trips already dispatched (on the road or at the hub): History. */
  history: CompletedTrip[];
  /** Per dispatched trip, this farm's buckets of the orders on screen (tomorrow's). */
  historyBuckets: ShelvedTrip[];
  loading: boolean;
  /** The saved lists are still being read: no skeletons, no empty state yet. */
  settling?: boolean;
  /** Why the app came back here by itself (the open trip left the plan / closed). */
  notice: string | null;
  totals: { requested: number; trolley: number; transit: number; shelved: number };
  onOpen: (tripId: string) => void;
  onOpenWaiting: () => void;
  onOpenHistory: (tripId: string) => void;
  onSendTrip?: (t: PlannedTrip) => void;
  sendingTrip?: string | null;
  refreshControl?: ReactElement;
}) {
  const items = useMemo((): CardItem[] => {
    const order = (a: PlannedTrip, b: PlannedTrip) =>
      (a.tripDate || '').localeCompare(b.tripDate || '') ||
      Number(b.current) - Number(a.current) ||
      (a.run || 0) - (b.run || 0) ||
      (a.vehicle || '').localeCompare(b.vehicle || '');
    const open = trips.filter((t) => !t.yourStopClosed).sort(order);
    const closed = trips.filter((t) => t.yourStopClosed).sort(order);
    // Today's history only: trips of today, or that left here today.
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    // Only trips that carried this farm's buckets for the delivery date on screen; their
    // counts come from those buckets alone (earlier days' orders on the truck excluded).
    const carried = new Map(historyBuckets.map((t) => [t.tripId, t]));
    const past = history
      .filter((t) => (t.tripDate === today || (t.leftAt || '').slice(0, 10) === today) && carried.has(t.tripId))
      .sort((a, b) => (b.leftAt || b.tripDate || '').localeCompare(a.leftAt || a.tripDate || ''));
    const closedOnly = closed.filter((t) => t.tripDate === today && !history.some((h) => h.tripId === t.tripId));
    // Buckets on this phone's trolleys, not on a truck yet: per trip, beside its progress.
    const held = [...requests.flatMap((g) => g.opls), ...trolley.filter((o) => !o.loadedToTruck)];
    const onTrolley = (t: PlannedTrip) =>
      held
        .filter((o) => oplOnTrip(t, { oplName: o.oplName, orderName: o.orderName, asap: o.buckets.some((b) => b.asap) }, trips))
        // An order split over runs: only this run's share of its trolley buckets.
        .reduce((n, o) => n + heldOnTrip(trips, t, o.oplName, o.buckets.filter((b) => b.scanned && !b.notFound).length), 0);

    const row = (t: PlannedTrip): CardItem => {
      const stop = (t.stops ?? []).find((st) => st.isYou);
      const total = stop ? stopBuckets(stop) : t.farmBuckets;
      const loaded = stop ? stop.loaded + stop.transit + stop.shelved : t.loadedBuckets;
      const trolleyN = t.yourStopClosed ? 0 : onTrolley(t);
      const state = tripState(t, hub, trolleyN);
      return {
        key: `trip-${t.tripId}`,
        render: () => (
          <TripRow
            trip={t}
            farm={farm}
            hub={hub}
            state={state}
            loaded={loaded}
            total={total}
            trolleyN={trolleyN}
            onOpen={onOpen}
            onSend={onSendTrip && t.current && stop && !t.yourStopClosed ? () => onSendTrip(t) : undefined}
            sending={sendingTrip === t.tripId}
          />
        ),
      };
    };

    const out: CardItem[] = [];
    if (notice) out.push({ key: 'notice', render: () => <Alert tone="warn">{notice}</Alert> });
    out.push({
      key: 'totals',
      render: () => (
        <Card>
          <View style={s.tripHead}>
            <Text style={s.routeLabel}>{farm}</Text>
            <Text style={s.summaryCount}>
              {open.length} open
              {closed.length ? ` · ${closed.length} closed` : ''}
            </Text>
          </View>
          <View style={s.statRow}>
            {[
              { label: 'Requested', value: totals.requested },
              { label: 'On trolley', value: totals.trolley },
              { label: 'In transit', value: totals.transit },
              { label: 'Shelved', value: totals.shelved },
            ].map((x) => (
              <View key={x.label} style={s.statTile}>
                <Text style={s.statValue}>{x.value}</Text>
                <Text style={s.statLabel} numberOfLines={1}>
                  {x.label}
                </Text>
              </View>
            ))}
          </View>
        </Card>
      ),
    });
    if (!trips.length && !settling) {
      out.push(
        loading
          ? { key: 'skeleton', render: () => <SkeletonCards cards={2} /> }
          : {
              key: 'empty',
              render: () => (
                <Card>
                  <View style={s.empty}>
                    <Ionicons name="car-outline" size={26} color={COLORS.textMuted} />
                    <Text style={s.emptyTitle}>No new Scheduled Requests</Text>
                  </View>
                </Card>
              ),
            },
      );
    }
    out.push(...open.map(row));
    if (notScheduled.length) {
      out.push({
        key: 'not-scheduled',
        render: () => (
          <Pressable
            onPress={onOpenWaiting}
            accessibilityRole="button"
            accessibilityLabel="Open Not Scheduled orders"
            style={({ pressed }) => [s.notSched, pressed && s.tripRowPressed]}
          >
            <Card>
              <View style={s.tripHead}>
                <View style={s.tripTruck}>
                  <Ionicons name="time-outline" size={16} color={COLORS.text} />
                  <Text style={[s.tripTruckText, s.notSchedText]} numberOfLines={1}>
                    Not Scheduled ({waitingN}bkts)
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={COLORS.textMuted} />
              </View>
              <Text style={s.oplMeta}>{plural(waitingN, 'bucket')} · not loadable yet</Text>
            </Card>
          </Pressable>
        ),
      });
    }
    // History: the trips already dispatched from here (newest first), then any other
    // trip whose stop here is closed. Read only.
    if (past.length || closedOnly.length) out.push({ key: 'history-hdr', render: () => <Text style={s.sectionHdr}>History</Text> });
    out.push(
      ...past.map((t) => ({
        key: `past-${t.tripId}`,
        render: () => <PastTripRow trip={t} farm={farm} hub={hub} carried={carried.get(t.tripId)} onOpenHistory={onOpenHistory} />,
      })),
    );
    out.push(...closedOnly.map(row));
    return out;
  }, [farm, hub, trips, requests, trolley, notScheduled, waitingN, history, historyBuckets, loading, settling, notice, totals, onOpen, onOpenWaiting, onOpenHistory, onSendTrip, sendingTrip]);

  return <CardList items={items} refreshControl={refreshControl} />;
});

/** One open (or closed) trip on the Trips page: tap to open its scan page. */
const TripRow = memo(function TripRow({
  trip: t,
  farm,
  hub,
  state,
  loaded,
  total,
  trolleyN,
  onOpen,
  onSend,
  sending = false,
}: {
  trip: PlannedTrip;
  farm: string;
  hub: string;
  state: TripStateUi;
  loaded: number;
  total: number;
  trolleyN: number;
  onOpen: (tripId: string) => void;
  /** Send the truck on from this farm: enabled once every bucket planned here is on it. */
  onSend?: () => void;
  sending?: boolean;
}) {
  const done = state.tone === 'done';
  return (
    <Pressable
      onPress={() => onOpen(t.tripId)}
      disabled={t.yourStopClosed}
      accessibilityRole="button"
      accessibilityLabel={`Open ${tripName(t)}`}
      style={({ pressed }) => [done && s.tripRowDone, pressed && s.tripRowPressed]}
    >
      <Card>
        <View style={s.tripHead}>
          <View style={s.tripTruck}>
            <Ionicons name="car" size={16} color={done ? COLORS.textMuted : COLORS.text} />
            <Text style={s.tripTruckText} numberOfLines={1}>
              {tripName(t)}
            </Text>
          </View>
          <StatePill state={state} />
        </View>
        <Text style={s.tripRoute} numberOfLines={1}>
          {t.runChain || `${farm || 'Farm'} → ${hub || 'Kapkolia'}`}
        </Text>
        {t.createdAt ? (
          <Text style={s.oplMeta} numberOfLines={1}>
            Created {dateTimeLabel(t.createdAt)}
          </Text>
        ) : null}
        {t.scheduledAt ? (
          <Text style={s.oplMeta} numberOfLines={1}>
            Scheduled {dateTimeLabel(t.scheduledAt)}
          </Text>
        ) : null}
        <View style={s.yourStopScan}>
          <Text style={s.oplMeta}>
            {loaded}/{total} bucket{total === 1 ? '' : 's'} on the truck
            {trolleyN ? ` · ${trolleyN} on trolleys` : ''}
          </Text>
        </View>
        <ProgressBar value={total ? Math.min(1, loaded / total) : 0} />
        {onSend ? (
          <Button
            label={(t.stops ?? []).some((st) => st.stop > ((t.stops ?? []).find((x) => x.isYou)?.stop ?? 0)) ? 'Truck leaving' : 'Send to packhouse'}
            iconLeft="car-outline"
            onPress={onSend}
            loading={sending}
            disabled={!(total > 0 && loaded >= total)}
            style={{ marginTop: spacing.sm }}
          />
        ) : null}
        <View style={s.tripFoot}>
          <View style={s.metaGrow} />
          {t.yourStopClosed ? null : <Ionicons name="chevron-forward" size={18} color={COLORS.textMuted} />}
        </View>
      </Card>
    </Pressable>
  );
});

/** A trip already dispatched from here (History): read only, its buckets on tap. */
const PastTripRow = memo(function PastTripRow({
  trip: t,
  farm,
  hub,
  carried: c,
  onOpenHistory,
}: {
  trip: CompletedTrip;
  farm: string;
  hub: string;
  carried?: ShelvedTrip;
  onOpenHistory: (tripId: string) => void;
}) {
  const arrived = t.status === 'Received' || t.arrived;
  const st: TripStateUi = arrived
    ? { label: `Arrived at ${hub || 'Kapkolia'}`, tone: 'done', color: '#0e7490' }
    : { label: 'In transit', tone: 'done', color: '#1d4ed8' };
  const n = c ? c.buckets.length : 0;
  const sh = c ? c.buckets.filter((b) => b.shelved).length : 0;
  return (
    <View style={s.tripRowDone}>
      <Card>
        <View style={s.tripHead}>
          <View style={s.tripTruck}>
            <Ionicons name="car" size={16} color={COLORS.textMuted} />
            <Text style={s.tripTruckText} numberOfLines={1}>
              {`${t.vehicle || 'Truck'}${t.run ? ` · Trip ${t.run}` : ''}`}
            </Text>
          </View>
          <StatePill state={st} />
        </View>
        <Text style={s.tripRoute} numberOfLines={1}>
          {t.runChain || `${farm || 'Farm'} → ${hub || 'Kapkolia'}`}
        </Text>
        {t.leftAt ? (
          <Text style={s.oplMeta} numberOfLines={1}>
            Left {dateTimeLabel(t.leftAt)}
          </Text>
        ) : null}
        <Text style={s.oplMeta} numberOfLines={1}>
          {`${n} bucket${n === 1 ? '' : 's'} · ${sh} shelved at ${hub || 'Kapkolia'}`}
        </Text>
        <Pressable
          onPress={() => onOpenHistory(t.tripId)}
          style={s.historyBtn}
          accessibilityRole="button"
          accessibilityLabel={`Buckets on ${t.vehicle} trip ${t.run}`}
        >
          <Ionicons name="cube-outline" size={14} color={COLORS.text} />
          <Text style={s.changeLink}>View buckets</Text>
          <Ionicons name="chevron-forward" size={14} color={COLORS.text} />
        </Pressable>
      </Card>
    </View>
  );
});

/** Orders on no truck trip yet, grouped like a trip's requests: one card per variety,
 *  each bucket "43cm(ORDER)" -- listed to see what is coming, nothing to scan. */
function notScheduledCards(groups: OrderGroup[], byOrder: boolean): CardItem[] {
  const rows: ListRow[] = groups.flatMap((g) =>
    g.opls.flatMap((o) => o.buckets.filter(waitingRow).map((b) => ({ b, orderName: g.orderName }))),
  );
  return listSections(rows, byOrder).map((sec) => ({
    key: `ns-${sec.key}`,
    render: () => <NotScheduledCard section={sec} byOrder={byOrder} />,
  }));
}

/** The Not Scheduled page: those orders' buckets, read only. */
const NotScheduledList = memo(function NotScheduledList({
  groups,
  refreshControl,
}: {
  groups: OrderGroup[];
  refreshControl?: ReactElement;
}) {
  const byOrder = useKarenBucketRequestsStore((st) => st.groupByOrder);
  const items = useMemo(() => {
    const cards = notScheduledCards(groups, byOrder);
    return cards.length
      ? cards
      : [
          {
            key: 'empty',
            render: () => (
              <Card>
                <View style={s.empty}>
                  <Ionicons name="checkmark-done-outline" size={26} color={COLORS.textMuted} />
                  <Text style={s.emptyTitle}>Every order is on a truck</Text>
                </View>
              </Card>
            ),
          },
        ];
  }, [groups, byOrder]);
  return <CardList items={items} refreshControl={refreshControl} />;
});

const NotScheduledCard = memo(function NotScheduledCard({ section: sec, byOrder }: { section: ListSection; byOrder: boolean }) {
  return (
    <View style={s.notSched}>
      <Card>
        <View style={s.groupLine}>
          {sec.color ? <View style={[s.varDot, { backgroundColor: sec.color }]} /> : null}
          <Text style={[s.groupHdr, s.groupNames, s.notSchedHdr]} numberOfLines={1}>
            {sec.title}
          </Text>
          <Text style={[s.oplMeta, s.notSchedText]}>{sec.rows.length}</Text>
        </View>
        <View style={s.divider} />
        {sec.rows.map((r, i, list) => {
          const newVariety = byOrder && (i === 0 || list[i - 1].b.variety !== r.b.variety);
          const color = r.b.varietyColor || sec.color;
          return (
            <View key={r.b.id}>
              {newVariety ? <VarietySubHead row={r} dim /> : null}
              <View
                style={[
                  s.bRow,
                  i > 0 && !newVariety && s.bRowSep,
                  color ? [s.varStripe, { borderLeftColor: color }] : null,
                ]}
              >
                <View style={{ flex: 1, minWidth: 0 }}>
                  <View style={s.shelfBucketRow}>
                    <View style={s.idCol}>
                      <Text style={[s.bShelfLead, s.notSchedText]}>{(r.b.shelf || 'none').toUpperCase()}</Text>
                      <Text style={s.idWord}>SHELF</Text>
                    </View>
                    <View style={[s.idCol, s.idColRight]}>
                      <Text style={[s.bIdRight, s.notSchedText]}>
                        {r.b.bucketId.toUpperCase()} ({bucketStems(r.b.qty, r.b.uom)})
                      </Text>
                      <Text style={s.idWord}>BUCKET</Text>
                    </View>
                  </View>
                  <Text style={[s.bMeta, s.notSchedText]}>
                    {listMeta(r, byOrder)}
                    {r.b.scanned ? (
                      <Text style={s.onTrolleyMark}>
                        {`  · on trolley${r.b.trolleyId ? ` ${r.b.trolleyId.toUpperCase()}` : ''}`}
                      </Text>
                    ) : null}
                    {r.b.notSynced ? <Text style={s.notSyncedMark}>  · not synced</Text> : null}
                  </Text>
                </View>
              </View>
            </View>
          );
        })}
      </Card>
    </View>
  );
}, (a, b) => a.byOrder === b.byOrder && sameSection(a.section, b.section));

/** Bucket meta line: "Variety · 40cm", omitting any empty part. A bare numeric
 *  stem length gets a "cm" suffix; anything else is shown as-is. Shelf renders as
 *  its own line below this one (see s.bShelf) rather than joined in here. */
/** A truck has arrived at the hub once it is stamped so, or as soon as any bucket it
 *  carried is shelved there (shelving at the hub starts = the truck is there). */
function hasArrived(a: TripArrival | undefined | null): boolean {
  return !!a && (!!a.arrivedAt || (a.shelved ?? 0) > 0);
}

/** Stems in a bucket: the order line's qty is in its UOM — "Bunch (10)" is 10 stems a
 *  bunch, so 20 bunches read 200. A plain stem UOM is already stems. */
function bucketStems(qty: number, uom?: string | null): number {
  const per = Number(/\((\d+(?:\.\d+)?)\)/.exec(uom || '')?.[1]) || 1;
  return Math.round((qty || 0) * per);
}

/** "Today", "Tomorrow" or "Fri 3 Oct" for a YYYY-MM-DD delivery date. */
/** "15 Oct, 08:24" from "YYYY-MM-DD HH:MM[:SS]" (server local time, shown as is). */
function dateTimeLabel(ts: string): string {
  const [d, t] = ts.split(' ');
  const [y, m, day] = (d || '').split('-').map(Number);
  if (!y || !m || !day) return ts;
  const mon = new Date(y, m - 1, day).toLocaleDateString('en-GB', { month: 'short' });
  return `${day} ${mon}${t ? `, ${t.slice(0, 5)}` : ''}`;
}

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

/** One requested bucket: shelf and bucket id, then `meta` (variety · length, or in a
 *  variety group "43cm (ORDER)"), its ASAP pill and the Info (replace / not found) button. */
const BucketRow = memo(function BucketRow({
  b,
  first,
  meta,
  color,
  replacingId,
  onReplace,
}: {
  b: ReqBucket;
  first: boolean;
  meta: string;
  /** The variety's colour: a stripe down the row's left edge. */
  color?: string;
  replacingId: number | null;
  onReplace: (b: ReqBucket) => void;
}) {
  return (
    <View style={[s.bRow, !first && s.bRowSep, color ? [s.varStripe, { borderLeftColor: color }] : null]}>
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
              {b.bucketId.toUpperCase()} ({bucketStems(b.qty, b.uom)})
            </Text>
            <Text style={s.idWord}>BUCKET</Text>
          </View>
        </View>
        {/* Variety and stem length, with Info (replace / not found) on the same line (not beside the
            shelf and bucket). On a trolley already: just the struck-through shelf and bucket. */}
        {b.scanned && !b.notFound ? (
          b.notSynced ? <Text style={s.notSyncedMark}>not synced</Text> : null
        ) : (
          <View style={s.metaReplaceRow}>
            <Text style={[s.bMeta, s.metaGrow, b.scanned && s.bDone]}>
              {meta}
              {b.notFound ? <Text style={s.bNotFound}>  · not found</Text> : null}
            </Text>
            {b.asap && !b.scanned ? (
              // A quality-issue replacement the packhouse is waiting on: load it first.
              <View style={s.asapPill}>
                <Text style={s.asapPillText}>ASAP</Text>
              </View>
            ) : null}
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
        )}
      </View>
    </View>
  );
}, (a, b) =>
  a.first === b.first &&
  a.meta === b.meta &&
  a.color === b.color &&
  a.onReplace === b.onReplace &&
  // Only the row being replaced cares which one is.
  (a.replacingId === b.replacingId || (a.replacingId !== a.b.id && b.replacingId !== b.b.id && (a.replacingId === null) === (b.replacingId === null))) &&
  sameBucket(a.b, b.b));

type ListRow = { b: ReqBucket; orderName: string; onTruck?: boolean };
type ListSection = { key: string; title: string; color?: string; rows: ListRow[] };

/** Same bucket, field by field: a sync rebuilds every row from the database, so a row
 *  only re-renders when something it shows changed. */
function sameBucket(a: ReqBucket, b: ReqBucket): boolean {
  if (a === b) return true;
  const ka = Object.keys(a) as (keyof ReqBucket)[];
  if (ka.length !== Object.keys(b).length) return false;
  for (const k of ka) if (a[k] !== b[k]) return false;
  return true;
}

function sameSection(a: ListSection, b: ListSection): boolean {
  if (a === b) return true;
  if (a.key !== b.key || a.title !== b.title || a.color !== b.color || a.rows.length !== b.rows.length) return false;
  for (let i = 0; i < a.rows.length; i++) {
    const x = a.rows[i];
    const y = b.rows[i];
    if (x.orderName !== y.orderName || x.onTruck !== y.onTruck || !sameBucket(x.b, y.b)) return false;
  }
  return true;
}

/** A list's buckets in cards: per variety (each row "43cm(ORDER)"), or -- Production
 *  Settings > Group App Bucket Requests by Order -- per order, its varieties grouped
 *  under it (each row "43cm"). `orderRank` keeps orders in pick order. */
function listSections(rows: ListRow[], byOrder: boolean, orderRank?: (order: string) => number): ListSection[] {
  const stemOf = (r: ListRow) => parseFloat(r.b.stemLength) || 0;
  const rank = (o: string) => (orderRank ? orderRank(o) : 0);
  const map = new Map<string, ListRow[]>();
  for (const r of rows) {
    const k = byOrder ? r.orderName : r.b.variety || '';
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(r);
  }
  const keys = [...map.keys()].sort((a, b) => (byOrder ? rank(a) - rank(b) || a.localeCompare(b) : a.localeCompare(b)));
  return keys.map((k) => {
    const rs = map.get(k)!.sort((a, b) =>
      byOrder
        ? (a.b.variety || '').localeCompare(b.b.variety || '') || stemOf(a) - stemOf(b)
        : stemOf(a) - stemOf(b) || rank(a.orderName) - rank(b.orderName) || a.orderName.localeCompare(b.orderName),
    );
    return {
      key: k || '-',
      title: k || (byOrder ? 'No order' : 'No variety'),
      color: byOrder ? undefined : rs.find((r) => r.b.varietyColor)?.b.varietyColor || undefined,
      rows: rs,
    };
  });
}

/** Row meta: "43cm(ORDER)" in a variety card, "43cm" in an order card. */
function listMeta(r: ListRow, byOrder: boolean): string {
  const stem = bucketMeta('', r.b.stemLength);
  return byOrder ? stem || '—' : `${stem}${r.orderName ? `(${r.orderName})` : ''}`;
}

/** In an order card: the variety's name (and colour) above its first bucket. */
function VarietySubHead({ row, dim }: { row: ListRow; dim?: boolean }) {
  const color = row.b.varietyColor || undefined;
  return (
    <View style={[s.groupLine, s.varSubHead]}>
      {color ? <View style={[s.varDot, { backgroundColor: color }]} /> : null}
      <Text style={[s.bMeta, s.varSubHeadText, dim ? s.notSchedText : null]} numberOfLines={1}>
        {row.b.variety || 'No variety'}
      </Text>
    </View>
  );
}

/** A trip's requested buckets for one variety: each row "43cm (ORDER)", the scanned
 *  ones folded away under a green "N scanned" line. Scans still flag each bucket's own
 *  picklist -- only the grouping on screen changes. */
const VarietyCard = memo(function VarietyCard({
  section,
  byOrder,
  replacingId,
  onReplace,
}: {
  section: ListSection;
  byOrder: boolean;
  replacingId: number | null;
  onReplace: (b: ReqBucket) => void;
}) {
  const [showScanned, setShowScanned] = useState(false);
  const rows = section.rows;
  const color = section.color;
  const toScan = rows.filter((r) => !r.b.scanned);
  const done = rows.filter((r) => r.b.scanned);
  const row = (r: ListRow, i: number, list: ListRow[]) => (
    <View key={r.b.id}>
      {byOrder && (i === 0 || list[i - 1].b.variety !== r.b.variety) ? <VarietySubHead row={r} /> : null}
      <BucketRow
        b={r.b}
        first={i === 0 || (byOrder && list[i - 1].b.variety !== r.b.variety)}
        meta={listMeta(r, byOrder)}
        color={r.b.varietyColor || color}
        replacingId={replacingId}
        onReplace={onReplace}
      />
    </View>
  );
  return (
    <Card>
      <View style={s.groupLine}>
        {color ? <View style={[s.varDot, { backgroundColor: color }]} /> : null}
        <Text style={[s.groupHdr, s.groupNames]} numberOfLines={1}>
          {section.title}
        </Text>
        <Text style={s.oplMeta}>
          {done.length}/{rows.length}
        </Text>
      </View>
      <View style={s.divider} />
      {toScan.map(row)}
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
      {showScanned ? done.map(row) : null}
    </Card>
  );
}, (a, b) =>
  a.byOrder === b.byOrder && a.replacingId === b.replacingId && a.onReplace === b.onReplace && sameSection(a.section, b.section));

const OplCard = memo(function OplCard({
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
    <BucketRow
      key={b.id}
      b={b}
      first={i === 0}
      meta={bucketMeta(b.variety, b.stemLength)}
      replacingId={replacingId}
      onReplace={onReplace}
    />
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
              {opl.asap ? (
                <Text style={s.asapNote}>
                  {opl.asap} ASAP replacement{opl.asap === 1 ? '' : 's'} — packing is waiting, load first
                </Text>
              ) : null}
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
});

/** One variety (or order) card of trolley buckets: each bucket "43cm(ORDER)"; a bucket
 *  already on the truck says so (a History trip's: where it is shelved at the hub). */
const TrolleyCard = memo(
  function TrolleyCard({
    section: sec,
    byOrder,
    hub,
    history,
  }: {
    section: ListSection;
    byOrder: boolean;
    hub?: string;
    history?: boolean;
  }) {
    return (
      <Card>
        <View style={s.groupLine}>
          {sec.color ? <View style={[s.varDot, { backgroundColor: sec.color }]} /> : null}
          <Text style={[s.groupHdr, s.groupNames]} numberOfLines={1}>
            {sec.title}
          </Text>
          <Text style={s.oplMeta}>{sec.rows.length}</Text>
        </View>
        <View style={s.divider} />
        {sec.rows.map((r, i, list) => {
          const newVariety = byOrder && (i === 0 || list[i - 1].b.variety !== r.b.variety);
          const color = r.b.varietyColor || sec.color;
          return (
            <View key={r.b.id}>
              {newVariety ? <VarietySubHead row={r} /> : null}
              <View
                style={[s.bRow, i > 0 && !newVariety && s.bRowSep, color ? [s.varStripe, { borderLeftColor: color }] : null]}
              >
                <Ionicons
                  name={r.onTruck ? 'car' : 'checkmark-circle'}
                  size={16}
                  color={r.onTruck ? COLORS.text : (COLORS.success ?? '#12B76A')}
                />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={s.bId} numberOfLines={1}>
                    {r.b.bucketId.toUpperCase()} ({bucketStems(r.b.qty, r.b.uom)})
                  </Text>
                  <Text style={s.bMeta} numberOfLines={1}>
                    {listMeta(r, byOrder)}
                    {r.onTruck ? '  · on truck' : history ? `  · shelved${r.b.shelf ? ` ${r.b.shelf}` : ''} at ${hub || 'Kapkolia'}` : ''}
                    {r.b.notSynced && !r.onTruck ? <Text style={s.notSyncedMark}>  · not synced</Text> : null}
                  </Text>
                </View>
              </View>
            </View>
          );
        })}
      </Card>
    );
  },
  (a, b) => a.byOrder === b.byOrder && a.hub === b.hub && a.history === b.history && sameSection(a.section, b.section),
);

/** Buckets by variety in a list (the Trolley tab, a History trip): `lead` cards first,
 *  `empty` when there is no bucket. */
const VarietyList = memo(function VarietyList({
  rows,
  hub,
  history,
  lead,
  empty,
  loading,
  header,
  footer,
  refreshControl,
}: {
  rows: ListRow[];
  /** Nothing pulled yet: skeletons instead of the empty card. */
  loading?: boolean;
  hub?: string;
  /** A History trip's buckets (onTruck = not shelved at the hub yet). */
  history?: boolean;
  lead?: CardItem[];
  empty?: ReactElement;
  header?: ReactElement | null;
  footer?: ReactElement | null;
  refreshControl?: ReactElement;
}) {
  const byOrder = useKarenBucketRequestsStore((st) => st.groupByOrder);
  const items = useMemo((): CardItem[] => {
    const cards = listSections(rows, byOrder).map((sec) => ({
      key: `v-${sec.key}`,
      render: () => <TrolleyCard section={sec} byOrder={byOrder} hub={hub} history={history} />,
    }));
    if (!cards.length && loading) return [{ key: 'skeleton', render: () => <SkeletonCards cards={2} /> }];
    return [...(lead ?? []), ...(cards.length || !empty ? cards : [{ key: 'empty', render: () => empty }])];
  }, [rows, byOrder, hub, history, lead, empty, loading]);
  return <CardList items={items} header={header} footer={footer} refreshControl={refreshControl} initial={2} />;
});

/** The buckets "Load to truck" sends: this phone's trolley rows of the orders (as the
 *  store's load does), a bucket shared by several orders counted once. */
function loadBucketCount(opls: TrolleyOpl[]): number {
  const ids = new Set<string>();
  for (const o of opls) {
    const own = new Set(o.ownPliIds ?? o.pliIds);
    for (const b of o.buckets) if (!b.notFound && b.pliId && own.has(b.pliId)) ids.add(b.bucketId.toUpperCase());
  }
  return ids.size;
}

const TrolleyTab = memo(function TrolleyTab({
  items,
  syncingOpl,
  onLoad,
  scanned,
  total,
  header,
  footer,
  refreshControl,
}: {
  items: TrolleyOpl[];
  syncingOpl: string | null;
  onLoad: (opls: TrolleyOpl[]) => void;
  /** The tab's count: buckets on trolleys of those requested (not yet on a truck). */
  scanned: number;
  total: number;
  header?: ReactElement | null;
  footer?: ReactElement | null;
  refreshControl?: ReactElement;
}) {
  // Loaded onto the truck but not dispatched yet: stays here (the dashboard sends it
  // on its way), so only the orders still on trolleys can be loaded.
  // One button loads every order on the trolley — no button per order.
  const toLoad = useMemo(() => items.filter((o) => !o.loadedToTruck && o.ownPliIds.length > 0), [items]);
  const loadN = useMemo(() => loadBucketCount(toLoad), [toLoad]);
  const rows = useMemo(
    () =>
      items.flatMap((o) =>
        o.buckets.filter((b) => !b.notFound).map((b) => ({ b, orderName: o.orderName, onTruck: !!o.loadedToTruck })),
      ),
    [items],
  );
  const busy = !!syncingOpl;
  const lead = useMemo(
    (): CardItem[] =>
      loadN
        ? [
            {
              key: 'load',
              render: () => (
                <Card>
                  <Button
                    label={`Load ${plural(loadN, 'bucket')} to truck`}
                    iconLeft="car-outline"
                    loading={busy}
                    disabled={busy}
                    onPress={() => onLoad(toLoad)}
                  />
                </Card>
              ),
            },
          ]
        : [],
    [loadN, busy, onLoad, toLoad],
  );
  // An order is listed here once every one of its buckets is on a trolley.
  const empty = useMemo(
    () => (
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
    ),
    [scanned, total],
  );
  return (
    <VarietyList
      rows={rows}
      lead={lead}
      empty={empty}
      header={header}
      footer={footer}
      refreshControl={refreshControl}
    />
  );
});

/** In Transit: one order's buckets on a truck. */
const TransitOrder = memo(function TransitOrder({ opl: o }: { opl: TrolleyOpl }) {
  return (
    <View style={s.groupInTrip}>
      {/* Team, order name, customer, then the OPL and its buckets. */}
      <View style={s.groupLine}>
        <Text style={[s.groupHdr, s.groupNames]} numberOfLines={1}>
          {o.orderName}
        </Text>
      </View>
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
                {b.bucketId.toUpperCase()} ({bucketStems(b.qty, b.uom)})
              </Text>
              <Text style={s.bMeta} numberOfLines={1}>
                {bucketMeta(b.variety, b.stemLength)}
              </Text>
            </View>
          </View>
        ))}
    </View>
  );
});

const InTransitTab = memo(function InTransitTab({
  hub,
  items,
  trips,
  arrivals,
  deliveryDate,
  online,
  loading,
  onArrival,
  header,
  footer,
  refreshControl,
}: {
  /** The transfer hub (Kapkolia). */
  hub: string;
  items: TrolleyOpl[];
  /** This farm's trips on the road (dispatched, not received). */
  trips: CompletedTrip[];
  arrivals: Record<string, TripArrival>;
  deliveryDate: string;
  online: boolean;
  /** Trip plan is being pulled: skeletons while nothing is shown yet. */
  loading: boolean;
  onArrival: (tripId: string, action: 'status' | 'arrive' | 'complete') => Promise<boolean>;
  header?: ReactElement | null;
  footer?: ReactElement | null;
  refreshControl?: ReactElement;
}) {
  const cards = useMemo((): CardItem[] => {
    if (!items.length && !trips.length) {
      if (loading) return [{ key: 'skeleton', render: () => <SkeletonCards cards={2} /> }];
      return [
        {
          key: 'empty',
          render: () => (
            <Card>
              <View style={s.empty}>
                <Ionicons name="car-outline" size={26} color={COLORS.textMuted} />
                <Text style={s.emptyTitle}>Nothing in transit</Text>
              </View>
            </Card>
          ),
        },
      ];
    }
    // Grouped per truck: each truck's card lists its own orders and buckets, then its
    // "arrived" button. Picklists whose truck isn't known yet get a card of their own.
    const orderRows = (opls: TrolleyOpl[]) => opls.map((o) => <TransitOrder key={o.oplName} opl={o} />);
    const onTruck = new Set<string>();
    // Trucks still on the road first, the one that left earliest on top; trucks that
    // have arrived at Kapkolia after them.
    const ordered = [...trips].sort((a, b) => {
      const aIn = a.arrived || hasArrived(arrivals[a.tripId]) ? 1 : 0;
      const bIn = b.arrived || hasArrived(arrivals[b.tripId]) ? 1 : 0;
      return aIn - bIn || (a.leftAt || '').localeCompare(b.leftAt || '') || a.tripId.localeCompare(b.tripId);
    });
    const out: CardItem[] = ordered.map((t) => {
      const mine = items.filter((o) => (t.orders ?? []).some((x) => x.opl === o.oplName));
      mine.forEach((o) => onTruck.add(o.oplName));
      return {
        key: `trip-${t.tripId}`,
        render: () => (
          <TripArrivalCard
            trip={t}
            arrival={arrivals[t.tripId]}
            deliveryDate={deliveryDate}
            online={online}
            onArrival={onArrival}
            hubName={hub}
          >
            {orderRows(mine)}
          </TripArrivalCard>
        ),
      };
    });
    const noTruck = items.filter((o) => !onTruck.has(o.oplName));
    if (noTruck.length) {
      out.push({
        key: 'no-truck',
        render: () => (
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
        ),
      });
    }
    return out;
  }, [items, trips, arrivals, deliveryDate, online, loading, onArrival, hub]);
  return <CardList items={cards} header={header} footer={footer} refreshControl={refreshControl} initial={2} />;
});

/** A truck's buckets grouped by order (and its customer), in the order they come. */
function shelvedByOrder(rows: ShelvedTrip['buckets']) {
  const groups: { orderName: string; customer: string; buckets: ShelvedTrip['buckets'] }[] = [];
  const at = new Map<string, (typeof groups)[number]>();
  for (const b of rows) {
    let g = at.get(b.orderName);
    if (!g) {
      g = { orderName: b.orderName, customer: b.customer, buckets: [] };
      at.set(b.orderName, g);
      groups.push(g);
    }
    g.buckets.push(b);
  }
  return groups;
}

const shelvedTime = (iso: string) => (iso ? `${iso.slice(5, 10).split('-').reverse().join('/')} ${iso.slice(11, 16)}` : '');

/** One dispatched truck on the Shelved tab: its buckets (shelved or not) per order. */
const ShelvedTripCard = memo(function ShelvedTripCard({ trip: t, rows }: { trip: ShelvedTrip; rows: ShelvedTrip['buckets'] }) {
  const done = t.shelved === t.total;
  return (
    <Card>
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
          t.dispatchedAt ? `left ${shelvedTime(t.dispatchedAt)}` : '',
          t.arrivedAt ? `arrived ${shelvedTime(t.arrivedAt)}` : '',
          t.status === 'Received' ? 'received' : '',
        ]
          .filter(Boolean)
          .join(' · ')}
      </Text>
      {/* Per order (customer under it), then that order's buckets. */}
      {shelvedByOrder(rows).map((g) => (
        <View key={`${t.tripId}-${g.orderName}`} style={s.groupInTrip}>
          <Text style={[s.groupHdr, s.groupNames]} numberOfLines={1}>
            {g.orderName}
          </Text>
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
                {b.shelved && b.shelvedAt ? <Text style={s.bMeta}>{shelvedTime(b.shelvedAt)}</Text> : null}
              </View>
            </View>
          ))}
        </View>
      ))}
    </Card>
  );
});

/** After transit: did this farm's dispatched buckets get shelved at the hub? One card
 *  per recent trip, buckets still waiting first, then shelved ones with shelf and time. */
const ShelvedTab = memo(function ShelvedTab({
  trips,
  hub,
  loading,
  online,
  day,
  header,
  refreshControl,
}: {
  trips: ShelvedTrip[];
  hub: string;
  loading: boolean;
  online: boolean;
  /** Selected delivery date ("Tomorrow", "Today", "Fri 3 Oct"); '' = every date. */
  day: string;
  header?: ReactElement | null;
  refreshControl?: ReactElement;
}) {
  // Two tabs: Shelved / Not shelved. Opens on Not shelved while anything waits.
  const [view, setView] = useState<'shelved' | 'waiting' | null>(null);
  const where = hub || 'Kapkolia';
  const total = trips.reduce((n, t) => n + t.total, 0);
  const shelved = trips.reduce((n, t) => n + t.shelved, 0);
  const waiting = total - shelved;
  const tab = view ?? (waiting ? 'waiting' : 'shelved');

  const items = useMemo((): CardItem[] => {
    if (!trips.length) {
      if (loading && online) return [{ key: 'skeleton', render: () => <SkeletonCards cards={2} rows={4} /> }];
      return [
        {
          key: 'empty',
          render: () => (
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
          ),
        },
      ];
    }
    const perTrip = trips
      .map((t) => ({ t, rows: t.buckets.filter((b) => (tab === 'shelved' ? b.shelved : !b.shelved)) }))
      .filter((x) => x.rows.length);
    const out: CardItem[] = [
      {
        key: 'head',
        render: () => (
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
        ),
      },
    ];
    if (!perTrip.length) {
      out.push({
        key: 'none',
        render: () => (
          <Card>
            <View style={s.empty}>
              <Ionicons
                name={tab === 'waiting' ? 'checkmark-done-outline' : 'file-tray-outline'}
                size={26}
                color={COLORS.textMuted}
              />
              <Text style={s.emptyTitle}>{tab === 'waiting' ? 'Every bucket is shelved' : 'No bucket shelved yet'}</Text>
            </View>
          </Card>
        ),
      });
    }
    for (const { t, rows } of perTrip) {
      out.push({ key: `${tab}-${t.tripId}`, render: () => <ShelvedTripCard trip={t} rows={rows} /> });
    }
    return out;
  }, [trips, loading, online, day, tab, where, shelved, total, waiting]);
  return <CardList items={items} header={header} refreshControl={refreshControl} />;
});

/** A trip on the road to the hub: confirm the truck arrived, watch its buckets get
 *  shelved there, then complete the trip — only once every bucket is shelved. */
const TripArrivalCard = memo(function TripArrivalCard({
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
  const arrived = trip.arrived || hasArrived(arrival);
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
});

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
  onSend,
  sending = false,
  children,
}: {
  trip: PlannedTrip;
  /** Send the truck on from this farm (enabled once every bucket planned here is on it). */
  onSend?: () => void;
  sending?: boolean;
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
  // Staging starts with the first bucket scanned here, on this device, before the
  // server hears of it (offline too): "Not staged" only while nothing is scanned.
  const stopStatus = yourStop?.status === 'waiting' && scanned > 0 ? 'loading' : yourStop?.status;
  const ui = yourStop ? (STOP_UI[stopStatus ?? 'waiting'] ?? STOP_UI.waiting) : null;
  const pct = scanTotal > 0 ? Math.round((scanned / scanTotal) * 100) : 0;
  const forStop = yourStop ? stopBuckets(yourStop) : 0;
  const allOnTruck =
    !!yourStop && forStop > 0 && yourStop.loaded + yourStop.transit + yourStop.shelved >= forStop;
  const isLastStop = !!yourStop && !(trip.stops ?? []).some((st) => st.stop > yourStop.stop);
  return (
    <Card>
      {/* Truck and trip number first; nothing the farm doesn't act on. */}
      <View style={s.tripHead}>
        <View style={s.tripTruck}>
          <Ionicons name="car" size={16} color={COLORS.text} />
          <Text style={s.tripTruckText}>
            {trip.vehicle || 'No truck yet'}
            {trip.run ? `  ·  Trip ${trip.run}` : ''}
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
      {trip.yourStopClosed ? (
        <Text style={s.tripClosed}>Stop closed — the truck has left this farm.</Text>
      ) : yourStop && trip.current && onSend ? (
        <Button
          label={isLastStop ? 'Send to packhouse' : 'Truck leaving'}
          iconLeft="car-outline"
          onPress={onSend}
          loading={sending}
          disabled={!allOnTruck}
          style={{ marginTop: spacing.sm }}
        />
      ) : null}
    </Card>
  );
}

/** A tab's closing line: how many requested buckets have finished this stage. */
const StageSummary = memo(function StageSummary({
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
});

/** Text and border of the "shelved" pill: a darker green that reads on its pale fill. */
const SHELVED_GREEN = '#067647';

const s = StyleSheet.create({
  pickBadge: {
    minWidth: 26,
    height: 26,
    paddingHorizontal: 6,
    borderRadius: 13,
    backgroundColor: COLORS.surfaceAlt,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  pickBadgeFirst: { backgroundColor: COLORS.success ?? '#12B76A', borderColor: COLORS.success ?? '#12B76A' },
  pickBadgeText: { fontFamily: fontFamily.bold, fontSize: fontSize.sm, color: COLORS.text },
  pickBadgeTextFirst: { color: '#fff' },
  pickTag: { fontFamily: fontFamily.semiBold, fontSize: fontSize.xs, color: COLORS.textMuted, marginTop: 2 },
  pickTagFirst: { color: COLORS.success ?? '#067647' },
  tabHidden: { display: 'none' },
  tabShown: { flex: 1 },
  // Trips page and the bar over a trip's scan page.
  pageBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    marginBottom: spacing.md,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surfaceAlt,
  },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingRight: spacing.xs },
  backText: { fontFamily: fontFamily.semiBold, fontSize: fontSize.sm, color: COLORS.text },
  pageBarTitle: { fontFamily: fontFamily.bold, fontSize: fontSize.md, color: COLORS.text },
  tripRowDone: { opacity: 0.55 },
  tripRowPressed: { opacity: 0.7 },
  tripRoute: { fontFamily: fontFamily.semiBold, fontSize: fontSize.sm, color: COLORS.textSecondary, marginTop: spacing.xs },
  tripFoot: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm },
  statRow: { flexDirection: 'row', gap: spacing.xs, marginTop: spacing.sm },
  statTile: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.md,
    backgroundColor: COLORS.surfaceAlt,
  },
  statValue: { fontFamily: fontFamily.bold, fontSize: fontSize.lg, color: COLORS.text },
  statLabel: { fontFamily: fontFamily.medium, fontSize: scaleFont(10), color: COLORS.textMuted },
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
  // A scan the server has not taken yet (offline, or its flag failed): sent on the next sync.
  notSyncedMark: { fontFamily: fontFamily.semiBold, fontSize: fontSize.xs, color: COLORS.warn },
  // A Not Scheduled bucket another phone already put on a trolley.
  onTrolleyMark: { fontFamily: fontFamily.semiBold, fontSize: fontSize.xs, color: SHELVED_GREEN },
  asapPill: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 6,
    backgroundColor: '#B42318',
    marginRight: spacing.xs,
  },
  asapPillText: { fontFamily: fontFamily.bold, fontSize: 10, color: '#fff', letterSpacing: 0.4 },
  asapNote: { fontFamily: fontFamily.semiBold, fontSize: fontSize.xs, color: '#B42318', marginTop: 2 },
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
  // Not Scheduled orders: faded, grey text, no accents.
  notSched: {},
  notSchedHdr: { marginTop: 0, marginLeft: 0 },
  notSchedText: { color: COLORS.text },
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
  // Variety Tree colour: a dot by the variety's name and a stripe down each bucket.
  varDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginRight: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(0,0,0,0.25)',
  },
  varStripe: { borderLeftWidth: 4, paddingLeft: 8 },
  historyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 4,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  varSubHead: { marginTop: spacing.sm, marginBottom: 2 },
  varSubHeadText: { fontFamily: fontFamily.semiBold, color: COLORS.text },
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
  correctBox: { marginTop: spacing.sm, gap: 2 },
  correctNote: { fontFamily: fontFamily.regular, fontSize: fontSize.xs, color: COLORS.textMuted, marginBottom: 4 },
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
