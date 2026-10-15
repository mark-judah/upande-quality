import { create } from 'zustand';
import * as Network from 'expo-network';
import { isNoResponseError } from '@/src/core/api/client';
import { storage, StorageKeys } from '@/src/core/storage';
import { setTransferHub } from '@/src/core/tenant/transfer-hub';
import { instanceKey } from '@/src/core/auth/known-instances';
import {
  karenBucketRequestsRepository,
  type CompletedTrip,
  type TripArrival,
  type ShelvedTrip,
  type OplSchedule,
  type PlannedTrip,
  type ReplacementCandidate,
  type ReplaceReason,
  type ReplaceCorrection,
  type BucketIssueInfo,
} from '../repository/karen-bucket-requests-repository';
import * as db from '../offline/bucket-requests-db';
import type { BucketOrderRef, OrderGroup, TrolleyOpl, ScanResult, Vehicle } from '../offline/bucket-requests-db';

/** Bucket counts of one trip's picklists (the scan page's tabs once a trip is open). */
export type TripCounts = Pick<
  Awaited<ReturnType<typeof db.counts>>,
  'scannedBuckets' | 'totalBuckets' | 'allBuckets' | 'addedBuckets' | 'transitBuckets' | 'requests'
>;

type State = {
  ready: boolean;
  error: string | null;
  requests: OrderGroup[];
  /** Orders waiting at this farm but on no truck trip yet: listed greyed, not loadable. */
  notScheduled: OrderGroup[];
  trolley: TrolleyOpl[];
  inTransit: TrolleyOpl[];
  vehicles: Vehicle[];
  plannedTrips: PlannedTrip[];
  /** Packhouse Schedule slot per OPL, for orders scheduled but not yet on a trip. */
  schedules: OplSchedule[];
  /** Production Settings lists the orders on no trip yet (Not Scheduled). */
  showUnscheduled: boolean;
  /** Production Settings: a trip's buckets per order (varieties under it), not per variety. */
  groupByOrder: boolean;
  reqCount: number;
  trolleyCount: number;
  /** Buckets scanned onto trolleys of all requested (the Trolley tab's x/n). */
  scannedBuckets: number;
  totalBuckets: number;
  /** End-of-tab summaries: all requested buckets, added to trolleys, on trucks. */
  allBuckets: number;
  addedBuckets: number;
  transitBuckets: number;
  inTransitCount: number;
  tripsCount: number;
  activeTrolleyId: string | null;
  /** The trip the attendant opened from the Trips page: the scan page lists and loads
   *  only its orders. Null = the Trips page. */
  selectedTripId: string | null;
  /** The selected trip's picklists (its orders, plus ASAP replacements following them). */
  tripOpls: string[];
  tripCounts: TripCounts | null;
  /** Why the scan page went back to Trips by itself (the trip left the plan / closed). */
  tripNotice: { at: number; message: string } | null;
  selectTrip: (tripId: string | null) => Promise<void>;
  online: boolean;
  downloading: boolean;
  loadingTrips: boolean;
  syncingOpl: string | null;
  /** True once the download button completed a download (persisted). Drives
   *  whether the clear icon is offered. */
  manualDownloaded: boolean;
  /** Delivery-date filter ('' = all dates) and the dates on the device to pick from. */
  deliveryDate: string;
  deliveryDates: string[];
  setDeliveryDate: (date: string, farm?: string) => Promise<void>;

  init: () => Promise<void>;
  refresh: () => Promise<void>;
  refreshOnline: () => Promise<void>;
  download: (farm: string) => Promise<{ ok: boolean; message: string }>;
  /** Refresh only the planned-trips plan for a farm (online). */
  loadPlannedTrips: (farm: string) => Promise<{ ok: boolean; message?: string }>;
  /** Silent background pull: new picklists, trip plan, schedules and order states. */
  sync: (farm: string) => Promise<void>;
  setTrolleyFromScan: (raw: string) => { ok: boolean; message?: string; trolleyId?: string };
  clearActiveTrolley: () => void;
  scanBucketFromScan: (raw: string) => Promise<{ ok: boolean; message: string }>;
  /** A trolley scan the server refused after the fact (already issued / on a truck). */
  scanRefusal: { at: number; message: string } | null;
  loadToTruck: (oplName: string, pliIds: string[], truck: string) => Promise<{ ok: boolean; message: string }>;
  markInTransit: (oplName: string, pliIds: string[]) => Promise<{ ok: boolean; message: string }>;
  /** Load fully-scanned OPLs onto `truck` and mark them in transit, in one action. */
  loadAllToTruck: (opls: TrolleyOpl[], truck: string) => Promise<{ ok: boolean; message: string }>;
  findReplacement: (
    pliId: string,
  ) => Promise<
    | { ok: true; neededQty: number | null; candidates: ReplacementCandidate[] }
    | { ok: false; message: string; info?: boolean }
  >;
  /** `pending`: no reply came back, so the swap may still land server-side. */
  replaceBucket: (
    rowId: number,
    pliId: string,
    newBucket: string,
    reason?: ReplaceReason,
    notes?: string,
    correction?: ReplaceCorrection,
  ) => Promise<{ ok: boolean; message: string; pending?: boolean }>;
  /** Leave a requested bucket out of the transfer — not in the cold room and nothing
   *  to replace it — so its order can load with the buckets that are there. */
  markNotFound: (bucketId: string, pliId: string, notes?: string) => Promise<{ ok: boolean; message: string }>;
  /** "Issued offline": where the requested bucket was issued. */
  bucketIssueInfo: (pliId: string) => Promise<BucketIssueInfo | { kind: 'error'; message: string }>;
  /** Issued offline to its own line: mark it issued (no replacement) and drop it here. */
  markIssued: (rowId: number, pliId: string) => Promise<{ ok: boolean; message: string }>;
  /** "Truck leaving": close this farm's stop on a trip. */
  /** `reason`: why the stop leaves short of its planned buckets. */
  closeStop: (tripId: string, farm: string, reason?: string) => Promise<{ ok: boolean; message: string }>;
  /** Trips the truck has left this farm on (Completed page). */
  completedTrips: CompletedTrip[];
  loadingCompleted: boolean;
  loadCompletedTrips: (farm: string) => Promise<{ ok: boolean; message?: string }>;
  /** Reopen a closed stop / move what it left behind to the next run. */
  reopenStop: (tripId: string, farm: string) => Promise<{ ok: boolean; message: string }>;
  /** Shelved tab: this farm's dispatched buckets and whether they reached the hub shelf. */
  shelvedTrips: ShelvedTrip[];
  shelvedHub: string;
  loadingShelved: boolean;
  loadShelvedBuckets: (farm: string) => Promise<{ ok: boolean; message?: string }>;
  /** Hub arrival per dispatched trip (In Transit tab). */
  arrivals: Record<string, TripArrival>;
  tripArrival: (
    tripId: string,
    farm: string,
    action: 'status' | 'arrive' | 'complete',
  ) => Promise<{ ok: boolean; message: string }>;
  clearAll: () => Promise<void>;
};

// One background sync at a time (the poll timer and app-foreground can overlap).
let syncing = false;
// The trip the active trolley was taken for: opening another trip asks for a trolley again.
let trolleyTrip: string | null = null;
/** Trips this phone loaded onto a truck: when one leaves the plan (dispatched), the app
 *  goes back to Trips without a "no longer planned" notice. */
const loadedTrips = new Set<string>();

const hasOpl = (t: PlannedTrip, opl: string) => (t.orders ?? []).some((o) => o.opl === opl);
const hasOrder = (t: PlannedTrip, orderName: string) => (t.orders ?? []).some((o) => o.orderName === orderName);

/** "KCA 123X Trip 2" — how a trip is named to the attendant. */
export function tripTitle(t: PlannedTrip): string {
  const truck = t.vehicle || 'No truck yet';
  return t.run ? `${truck} Trip ${t.run}` : `${truck} · ${t.tripId}`;
}

/** The open trip a picklist loads on: the run being loaded now, else the earliest one
 *  (as Load to truck picks). An ASAP replacement whose picklist is on no trip follows
 *  its order's trip. */
export function tripForOrder(trips: PlannedTrip[], ref: BucketOrderRef): PlannedTrip | null {
  const open = trips.filter((t) => !t.yourStopClosed);
  const pick = (f: (t: PlannedTrip) => boolean) => open.find((t) => t.current && f(t)) ?? open.find(f) ?? null;
  const byOpl = pick((t) => hasOpl(t, ref.oplName));
  if (byOpl || !ref.asap) return byOpl;
  return pick((t) => hasOrder(t, ref.orderName));
}

/** A picklist belongs to `trip` when the trip lists it; an ASAP replacement also when its
 *  order rides on the trip, or on no trip at all (it goes on the next truck). */
export function onTrip(trip: PlannedTrip, ref: BucketOrderRef, trips: PlannedTrip[]): boolean {
  if (hasOpl(trip, ref.oplName)) return true;
  if (!ref.asap) return false;
  const t = tripForOrder(trips, ref);
  return !t || t.tripId === trip.tripId;
}

const refOf = (o: { oplName: string; orderName: string; buckets: { asap: boolean }[] }): BucketOrderRef => ({
  oplName: o.oplName,
  orderName: o.orderName,
  asap: o.buckets.some((b) => b.asap),
});




/** A trip seen for one delivery date: its orders for that date, and this farm's stop
 *  counted from those orders only — a stop can hold several days' orders, and the
 *  whole stop (2/26) used to show beside the 2 buckets requested for the day. */
function forDate(t: PlannedTrip, orders: PlannedTrip['orders']): PlannedTrip {
  const sum = (k: 'buckets' | 'total' | 'loaded' | 'transit' | 'shelved') =>
    orders.reduce((n, o) => n + (o[k] || 0), 0);
  const planned = sum('buckets');
  const total = sum('total');
  const loaded = sum('loaded');
  const transit = sum('transit');
  const shelved = sum('shelved');
  const stops = (t.stops ?? []).map((st) => {
    if (!st.isYou) return st;
    // Same rules as the server's stop status, on this date's orders.
    const status: typeof st.status =
      total > 0 && shelved === total
        ? 'done'
        : total > 0 && transit + shelved === total
          ? 'transit'
          : total > 0 && loaded + transit + shelved === total
            ? 'ready'
            : loaded + transit + shelved > 0
              ? 'loading'
              : 'waiting';
    return { ...st, planned, total, loaded, transit, shelved, awaiting: Math.max(0, total - loaded - transit - shelved), doneCount: loaded + transit + shelved, status };
  });
  return { ...t, orders, stops, farmBuckets: planned };
}

/** Wipe the offline store when it holds another server's data (see db.matchServer). */
async function matchServer(): Promise<void> {
  const url = await storage.get(StorageKeys.instanceUrl).catch(() => null);
  await db.matchServer(instanceKey(url));
}

/** Keep only the orders the server still has for this farm: waiting ones (the
 *  download) and any it reports a state for. Skipped when it reported no states. */
async function prune(items: { oplName: string }[], known: string[] | null): Promise<void> {
  if (!known) return;
  await db.pruneOpls(new Set([...items.map((i) => i.oplName), ...known]));
}

export const useKarenBucketRequestsStore = create<State>((set, get) => ({
  ready: false,
  error: null,
  requests: [],
  notScheduled: [],
  trolley: [],
  inTransit: [],
  vehicles: [],
  plannedTrips: [],
  schedules: [],
  showUnscheduled: true,
  groupByOrder: false,
  reqCount: 0,
  trolleyCount: 0,
  scannedBuckets: 0,
  totalBuckets: 0,
  allBuckets: 0,
  addedBuckets: 0,
  transitBuckets: 0,
  inTransitCount: 0,
  tripsCount: 0,
  activeTrolleyId: null,
  selectedTripId: null,
  tripOpls: [],
  tripCounts: null,
  tripNotice: null,
  scanRefusal: null,
  online: false,
  downloading: false,
  loadingTrips: false,
  syncingOpl: null,
  manualDownloaded: false,
  deliveryDate: '',
  deliveryDates: [],

  init: async () => {
    try {
      await db.initDb();
      await matchServer();
      const downloaded = await storage.get(StorageKeys.bucketRequestsDownloaded).catch(() => null);
      set({ ready: true, error: null, manualDownloaded: downloaded === '1' });
      await get().refresh();
      await get().refreshOnline();
    } catch (e) {
      set({ ready: false, error: (e as Error)?.message || 'Failed to open local database.' });
    }
  },

  setDeliveryDate: async (date, farm) => {
    db.setActiveDeliveryDate(date);
    // Shelved belongs to the old date: clear it until the new date's list loads.
    set({ deliveryDate: date, shelvedTrips: [] });
    await get().refresh();
    // A date outside the usual download window (today .. day after tomorrow): fetch
    // that date's orders now so choosing it shows them.
    if (!date || !farm) return;
    await get().refreshOnline();
    if (!get().online) return;
    try {
      const alloc = await karenBucketRequestsRepository.fetchAllocations(farm, date, date);
      if (alloc.kind === 'ok' && alloc.items.length) {
        await db.downloadOpls(alloc.items, farm);
        await get().refresh();
      }
    } catch {
      /* keep what is on screen */
    }
  },

  refresh: async () => {
    let lists;
    try {
      lists = await Promise.all([
        db.listRequests(),
        db.listTrolley(),
        db.listInTransit(),
        db.listVehicles(),
        db.listPlannedTrips(),
        db.listSchedules(),
        db.listDeliveryDates(),
      ]);
    } catch (e) {
      // A local-database hiccup (e.g. the connection released by a reload) must
      // not surface as an error: keep what is on screen; the next refresh retries.
      if (__DEV__) console.warn('[bucket-requests] refresh failed:', e);
      return;
    }
    const [allRequests, trolley, inTransit, vehicles, allTrips, schedules, deliveryDates] = lists;
    // Only orders on the Packhouse Schedule are worked here (an ASAP replacement too);
    // an order on no truck trip yet is only listed, under Not Scheduled.
    const scheduled = new Set(schedules.filter((sc) => sc.scheduled).map((sc) => sc.oplName));
    const requests = allRequests
      .map((g) => ({ ...g, opls: g.opls.filter((o) => o.scheduled && (scheduled.has(o.oplName) || o.asap > 0)) }))
      .filter((g) => g.opls.length > 0);
    const notScheduled = get().showUnscheduled
      ? allRequests
          .map((g) => ({ ...g, opls: g.opls.filter((o) => !o.scheduled) }))
          .filter((g) => g.opls.length > 0)
      : [];
    // Trips follow the delivery-date filter too: keep the ones carrying an order for it.
    const dd = get().deliveryDate;
    const plannedTrips = dd
      ? allTrips
          .map((t) => forDate(t, (t.orders ?? []).filter((o) => !o.deliveryDate || o.deliveryDate === dd)))
          .filter((t) => t.orders.length > 0)
      : allTrips;
    // The open trip: still planned and its stop here still open, else back to Trips.
    const sel = get().selectedTripId;
    let trip = sel ? (plannedTrips.find((t) => t.tripId === sel) ?? null) : null;
    let notice: string | null = null;
    if (sel && (!trip || trip.yourStopClosed)) {
      const was = trip ?? get().plannedTrips.find((t) => t.tripId === sel);
      // A trip this phone just loaded leaves the plan (dispatched): back to Trips quietly.
      notice = loadedTrips.has(sel)
        ? null
        : trip
        ? `${tripTitle(trip)}: stop closed — the truck has left this farm.`
        : `${was ? tripTitle(was) : `Trip ${sel}`} is no longer planned for this farm.`;
      trip = null;
    }
    const openTrip = trip;
    const tripOpls = openTrip
      ? [
          ...new Set(
            [...requests.flatMap((g) => g.opls), ...trolley, ...inTransit]
              .filter((o) => onTrip(openTrip, refOf(o), plannedTrips))
              .map((o) => o.oplName),
          ),
        ]
      : [];
    // Counts cover the same picklists the Requests tab lists: the ones on an open trip.
    let c: Awaited<ReturnType<typeof db.counts>>;
    let tc: TripCounts | null = null;
    try {
      c = await db.counts(
        new Set(plannedTrips.filter((t) => !t.yourStopClosed).flatMap((t) => (t.orders ?? []).map((o) => o.opl))),
      );
      if (trip) tc = await db.counts(undefined, new Set(tripOpls));
    } catch (e) {
      if (__DEV__) console.warn('[bucket-requests] counts failed:', e);
      return;
    }
    // A trip opened or closed while this refresh ran: its own refresh sets the trip view.
    const sameTrip = get().selectedTripId === sel;
    // Dates to filter by: the orders on the device, plus the ones on planned trips.
    const dates = [
      ...new Set([
        ...deliveryDates,
        ...allTrips.flatMap((t) => (t.orders ?? []).map((o) => o.deliveryDate).filter(Boolean)),
      ]),
    ].sort();
    set({
      deliveryDates: dates,
      requests,
      notScheduled,
      schedules,
      trolley,
      inTransit,
      vehicles,
      plannedTrips,
      reqCount: c.requests,
      trolleyCount: c.trolley,
      scannedBuckets: c.scannedBuckets,
      totalBuckets: c.totalBuckets,
      allBuckets: c.allBuckets,
      addedBuckets: c.addedBuckets,
      transitBuckets: c.transitBuckets,
      inTransitCount: c.inTransit,
      tripsCount: plannedTrips.length,
      ...(sameTrip
        ? {
            selectedTripId: trip ? sel : null,
            tripOpls,
            tripCounts: tc,
            ...(notice ? { tripNotice: { at: Date.now(), message: notice } } : {}),
          }
        : {}),
    });
  },

  selectTrip: async (tripId) => {
    // Another trip's buckets go on another trolley: opening it asks for a trolley again.
    const trolley = tripId && tripId !== trolleyTrip ? { activeTrolleyId: null } : {};
    set({ selectedTripId: tripId, tripOpls: [], tripCounts: null, tripNotice: null, ...trolley });
    await get().refresh();
  },

  refreshOnline: async () => {
    try {
      const s = await Network.getNetworkStateAsync();
      set({ online: !!s.isConnected && s.isInternetReachable !== false });
    } catch {
      set({ online: false });
    }
  },

  download: async (farm) => {
    db.setActiveFarm(farm);
    await get().refreshOnline();
    if (!get().online) {
      return { ok: false, message: 'Connect to the internet to download picklists.' };
    }
    set({ downloading: true });
    try {
      // Only the delivery date on screen: choosing tomorrow downloads tomorrow's
      // picklists and nothing of today's (the server's default window would mix
      // today .. day after tomorrow). No date chosen = that default window.
      const date = get().deliveryDate;
      const outcome = date
        ? await karenBucketRequestsRepository.fetchAllocations(farm, date, date)
        : await karenBucketRequestsRepository.fetchAllocations(farm);
      if (outcome.kind === 'error') {
        set({ downloading: false });
        return { ok: false, message: outcome.message };
      }
      const items = outcome.items;
      const res = await db.downloadOpls(items, farm);
      // Also refresh the offline truck list. Non-fatal: a truck-fetch failure
      // must not fail the picklist download — we keep any previously cached list.
      try {
        const trucks = await karenBucketRequestsRepository.fetchDispatchTrucks();
        if (trucks.kind === 'ok') await db.replaceVehicles(trucks.trucks);
      } catch {
        /* keep the cached trucks */
      }
      // Refresh the planned-trips plan too. Non-fatal — keep the cached plan on
      // failure so the download still succeeds.
      try {
        const trips = await karenBucketRequestsRepository.fetchPlannedTrips(farm, await db.listOplNames());
        if (trips.kind === 'ok') {
          await db.replacePlannedTrips(trips.trips);
          await db.replaceSchedules(trips.schedules);
          set({ showUnscheduled: trips.showUnscheduled, groupByOrder: trips.groupByOrder });
          await db.applyServerStates(trips.oplStates);
          await prune(items, trips.known);
        }
      } catch {
        /* keep the cached plan */
      }
      await get().refresh();
      // Any download that brought picklists down (new or refreshed) offers clearing;
      // a run that found none leaves the flag as it was.
      if (res.insertedOpls.length + res.refreshedOpls.length > 0) {
        await storage.set(StorageKeys.bucketRequestsDownloaded, '1').catch(() => {});
        set({ downloading: false, manualDownloaded: true });
      } else {
        set({ downloading: false });
      }
      return { ok: true, message: 'Downloaded successfully.' };
    } catch (e) {
      set({ downloading: false });
      return { ok: false, message: (e as Error)?.message || 'Download failed.' };
    }
  },

  loadPlannedTrips: async (farm) => {
    db.setActiveFarm(farm);
    await get().refreshOnline();
    if (!get().online) return { ok: false, message: 'Connect to the internet to refresh the trip plan.' };
    set({ loadingTrips: true });
    try {
      const trips = await karenBucketRequestsRepository.fetchPlannedTrips(farm, await db.listOplNames());
      if (trips.kind !== 'ok') {
        set({ loadingTrips: false });
        return { ok: false, message: trips.message };
      }
      await db.replacePlannedTrips(trips.trips);
      await db.replaceSchedules(trips.schedules);
      set({ showUnscheduled: trips.showUnscheduled, groupByOrder: trips.groupByOrder });
      await db.applyServerStates(trips.oplStates);
      await get().refresh();
      set({ loadingTrips: false });
      return { ok: true };
    } catch (e) {
      set({ loadingTrips: false });
      return { ok: false, message: (e as Error)?.message || 'Failed to load trips.' };
    }
  },

  sync: async (farm) => {
    db.setActiveFarm(farm);
    if (syncing || !farm) return;
    syncing = true;
    try {
      await get().refreshOnline();
      if (!get().online || get().downloading || get().syncingOpl) return;
      // Same date as the screen (see download); switching date fetches the new one.
      const date = get().deliveryDate;
      const alloc = date
        ? await karenBucketRequestsRepository.fetchAllocations(farm, date, date)
        : await karenBucketRequestsRepository.fetchAllocations(farm);
      await matchServer();
      if (alloc.kind === 'ok') await db.downloadOpls(alloc.items, farm);
      // Trucks too, so "Load to truck" has a current list without a manual download.
      try {
        const trucks = await karenBucketRequestsRepository.fetchDispatchTrucks();
        if (trucks.kind === 'ok') await db.replaceVehicles(trucks.trucks);
      } catch {
        /* keep the cached trucks */
      }
      const trips = await karenBucketRequestsRepository.fetchPlannedTrips(farm, await db.listOplNames());
      if (trips.kind === 'ok') {
        await db.replacePlannedTrips(trips.trips);
        await db.replaceSchedules(trips.schedules);
        set({ showUnscheduled: trips.showUnscheduled, groupByOrder: trips.groupByOrder });
        await db.applyServerStates(trips.oplStates);
        if (alloc.kind === 'ok') await prune(alloc.items, trips.known);
      }
      await get().refresh();
    } catch {
      /* background pull: keep what is on screen */
    } finally {
      syncing = false;
    }
  },

  setTrolleyFromScan: (raw) => {
    const id = karenBucketRequestsRepository.extractTrolleyIdFromScan(raw);
    if (!id) return { ok: false, message: 'Not a trolley QR code.' };
    set({ activeTrolleyId: id });
    trolleyTrip = get().selectedTripId;
    db.upsertTrolley(id).catch(() => {});
    return { ok: true, trolleyId: id };
  },

  clearActiveTrolley: () => set({ activeTrolleyId: null }),

  scanBucketFromScan: async (raw) => {
    const id = karenBucketRequestsRepository.extractBucketIdFromScan(raw);
    if (!id) return { ok: false, message: 'Not a bucket QR code.' };
    const trolley = get().activeTrolleyId;
    if (!trolley) return { ok: false, message: 'Scan a trolley first.' };
    // Buckets load trip by trip: only the open trip's orders take a scan here.
    const trips = get().plannedTrips;
    const trip = trips.find((t) => t.tripId === get().selectedTripId);
    if (!trip) return { ok: false, message: 'Open a trip first — go back to Trips and pick the truck you are loading.' };
    if (trip.yourStopClosed) {
      return { ok: false, message: `${tripTitle(trip)} has left this farm — go back and open another trip.` };
    }
    // Requested only by orders on no truck trip yet: nothing to load it onto.
    const waiting = await db.notScheduledOrder(id).catch(() => null);
    if (waiting) return { ok: false, message: db.notScheduledMessage(id) };
    // The bucket's order must ride on this trip (a bucket two orders request takes the
    // one on this trip), and the trolley must not already hold another trip's buckets.
    // Nothing waiting for it here: scanBucket says why (already scanned / not listed).
    let only: string[] | undefined;
    const refs = await db.bucketOrders(id).catch(() => [] as BucketOrderRef[]);
    if (refs.length) {
      const mine = refs.filter((r) => onTrip(trip, r, trips));
      if (!mine.length) {
        const other = refs.map((r) => tripForOrder(trips, r)).find((t): t is PlannedTrip => !!t);
        return {
          ok: false,
          message: other
            ? `${id.toUpperCase()} is not on this trip — it is on ${tripTitle(other)}.`
            : db.notScheduledMessage(id),
        };
      }
      only = mine.map((r) => r.oplName);
      const held = await db.trolleyOrders(trolley).catch(() => [] as BucketOrderRef[]);
      const foreign = held.find((r) => !onTrip(trip, r, trips));
      if (foreign) {
        const ft = tripForOrder(trips, foreign);
        return {
          ok: false,
          message: `Trolley ${trolley} already holds ${ft ? `${tripTitle(ft)}'s` : `${foreign.orderName}'s`} buckets — scan an empty trolley for ${tripTitle(trip)}.`,
        };
      }
    }
    let res: ScanResult;
    try {
      res = await db.scanBucket(id, trolley, only);
    } catch (e) {
      // A local-database hiccup (e.g. the connection released by a reload): report it,
      // never leave it as an unhandled rejection.
      return { ok: false, message: (e as Error)?.message || 'Could not save the scan — scan it again.' };
    }
    if (res.ok && res.pliId && get().online) {
      // Online: flag it on the trolley on the server too (the same flag the offline
      // sync sends later), so it can't also be issued offline at the packhouse — in the
      // background, so the scan never waits on the network. A bucket already issued /
      // arrived there is refused: the scan is undone and `scanRefusal` says why.
      const { pliId, rowId, bucketId } = res;
      karenBucketRequestsRepository
        .setOfflineTrolleyFlags({
          pliIds: [pliId],
          flag: 'loaded',
          keepShelf: true,
          trip: get().selectedTripId ?? undefined,
        })
        .then(async (flag) => {
          const clash = flag.kind === 'ok' ? flag.conflicts[0] : null;
          if (!clash) return;
          await db.unscanBucket(rowId).catch(() => {});
          set({
            scanRefusal: {
              at: Date.now(),
              message:
                clash.reason === 'trip_left'
                  ? `${bucketId.toUpperCase()} not added — ${clash.truck ?? 'this truck'} is already in transit.`
                  : clash.reason === 'other_trip'
                  ? `${bucketId.toUpperCase()} is not on this trip — ${clash.truck ? `it is on ${clash.truck}` : 'it is not scheduled yet'}.`
                  : clash.reason === 'on_truck'
                    ? `${bucketId} is already on ${clash.truck ?? 'another truck'} — taken off the trolley.`
                    : `${bucketId} was already issued / shelved at the packhouse — taken off the trolley.`,
            },
          });
          await get().refresh();
        })
        .catch(() => {
          // No answer: keep the scan; the sync flags it later.
        });
    }
    await get().refresh();
    if (!res.ok) return { ok: false, message: res.message };
    return {
      ok: true,
      message: `${res.bucketId} added`,
    };
  },

  loadToTruck: async (oplName, pliIds, truck) => {
    await get().refreshOnline();
    if (!get().online) return { ok: false, message: 'Connect to the internet to load to truck.' };
    set({ syncingOpl: oplName });
    try {
      const res = await karenBucketRequestsRepository.setOfflineTrolleyFlags({
        pliIds,
        flag: 'loaded',
        truck,
        trip: get().selectedTripId ?? undefined,
      });
      if (res.kind !== 'ok') {
        set({ syncingOpl: null });
        return { ok: false, message: res.message };
      }
      await db.markLoadedLocal(oplName);
      set({ syncingOpl: null });
      await get().refresh();
      return { ok: true, message: 'Loaded to truck.' };
    } catch (e) {
      set({ syncingOpl: null });
      return { ok: false, message: (e as Error)?.message || 'Load failed.' };
    }
  },

  markInTransit: async (oplName, pliIds) => {
    await get().refreshOnline();
    if (!get().online) return { ok: false, message: 'Connect to the internet to mark in transit.' };
    set({ syncingOpl: oplName });
    try {
      const res = await karenBucketRequestsRepository.setOfflineTrolleyFlags({
        pliIds,
        flag: 'transit',
        trip: get().selectedTripId ?? undefined,
      });
      if (res.kind !== 'ok') {
        set({ syncingOpl: null });
        return { ok: false, message: res.message };
      }
      await db.markInTransitLocal(oplName);
      set({ syncingOpl: null });
      await get().refresh();
      return { ok: true, message: 'Marked in transit.' };
    } catch (e) {
      set({ syncingOpl: null });
      return { ok: false, message: (e as Error)?.message || 'Failed to mark in transit.' };
    }
  },

  loadAllToTruck: async (opls, truck) => {
    await get().refreshOnline();
    if (!get().online) return { ok: false, message: 'Connect to the internet to load to truck.' };
    // Only this phone's trolleys: another phone's trolley may not be at this truck.
    const pliIds = opls.flatMap((o) => o.ownPliIds ?? o.pliIds);
    if (!pliIds.length) return { ok: false, message: 'Nothing to load.' };
    set({ syncingOpl: opls.length === 1 ? opls[0].oplName : '*' });
    // Loading it may dispatch the trip (last stop loaded) mid-way: no notice for that.
    const sel = get().selectedTripId;
    if (sel) loadedTrips.add(sel);
    try {
      // One action: stamp the truck onto the rows, then send them on their way.
      const trip = sel ?? undefined;
      const loaded = await karenBucketRequestsRepository.setOfflineTrolleyFlags({ pliIds, flag: 'loaded', truck, trip });
      if (loaded.kind !== 'ok') return { ok: false, message: loaded.message };
      // Refused buckets (already on another truck, or at the packhouse) stay where they are.
      const refused = loaded.conflicts.map((c) =>
        c.reason === 'trip_left'
          ? `${c.bucket}: ${c.truck ?? 'the truck'} is already in transit`
          : c.reason === 'other_trip'
          ? `${c.bucket} is not on this trip — ${c.truck ? `it is on ${c.truck}` : 'it is not scheduled yet'}`
          : c.reason === 'on_truck'
            ? `${c.bucket} is on ${c.truck ?? 'another truck'}`
            : `${c.bucket} is at the packhouse`,
      );
      for (const o of opls) await db.markLoadedLocal(o.oplName);
      const transit = await karenBucketRequestsRepository.setOfflineTrolleyFlags({ pliIds, flag: 'transit', trip });
      if (transit.kind !== 'ok') {
        await get().refresh();
        return { ok: false, message: `Loaded to ${truck}, but not marked in transit: ${transit.message}` };
      }
      // On the truck = in transit for the farm: the order moves to the In Transit tab
      // now, not only once the trip is dispatched.
      for (const o of opls) await db.markInTransitLocal(o.oplName);
      // Loaded: back to the Trips page. The trip may now be dispatched (last stop loaded)
      // and leave the plan -- that is the point, not a "no longer planned" notice.
      set({ selectedTripId: null, tripOpls: [], tripCounts: null, tripNotice: null, activeTrolleyId: null });
      await get().refresh();
      const what = opls.length === 1 ? opls[0].orderName : `${opls.length} orders`;
      return {
        ok: true,
        message: `${what} loaded to ${truck} — in transit.${refused.length ? ` Not loaded: ${refused.join('; ')}.` : ''}`,
      };
    } catch (e) {
      return { ok: false, message: (e as Error)?.message || 'Load failed.' };
    } finally {
      set({ syncingOpl: null });
    }
  },

  findReplacement: async (pliId) => {
    await get().refreshOnline();
    if (!get().online) return { ok: false, message: 'Connect to the internet to replace a bucket.' };
    try {
      const res = await karenBucketRequestsRepository.findBucketReplacement(pliId);
      if (res.kind === 'info') {
        // Not missing. On a trolley / truck (another phone loaded it): struck through as
        // added. Shelved or issued at the packhouse: nothing left to send -- dropped here.
        if (res.moved === 'issued' || res.moved === 'shelved') await db.removeUnscannedByPli(pliId);
        else await db.markScannedByPli(pliId);
        await get().refresh();
        return { ok: false, info: true, message: res.message };
      }
      if (res.kind !== 'ok') return { ok: false, message: res.message };
      return { ok: true, neededQty: res.neededQty, candidates: res.candidates };
    } catch (e) {
      if (isNoResponseError(e)) return { ok: false, message: 'No reply from the server. Try again.' };
      return { ok: false, message: (e as Error)?.message || 'Failed to find a replacement.' };
    }
  },

  replaceBucket: async (rowId, pliId, newBucket, reason, notes, correction) => {
    await get().refreshOnline();
    if (!get().online) return { ok: false, message: 'Connect to the internet to replace a bucket.' };
    try {
      const res = await karenBucketRequestsRepository.replaceBucket(pliId, newBucket, reason, notes, correction);
      if (res.kind !== 'ok') return { ok: false, message: res.message };
      await db.replaceBucketLocal(rowId, res.newBucket, res.shelf, res.stemLength);
      await get().refresh();
      return { ok: true, message: res.message };
    } catch (e) {
      if (isNoResponseError(e)) {
        return { ok: false, pending: true, message: 'Replace still processing. Check again in a minute.' };
      }
      return { ok: false, message: (e as Error)?.message || 'Replace failed.' };
    }
  },

  bucketIssueInfo: async (pliId) => {
    try {
      return await karenBucketRequestsRepository.bucketIssueInfo(pliId);
    } catch (e) {
      return { kind: 'error', message: (e as Error)?.message || 'Could not check where it was issued.' };
    }
  },

  markIssued: async (rowId, pliId) => {
    await get().refreshOnline();
    if (!get().online) return { ok: false, message: 'Connect to the internet to mark it issued.' };
    try {
      const res = await karenBucketRequestsRepository.markBucketIssued(pliId);
      if (res.kind !== 'ok') return { ok: false, message: res.message };
      await db.removeIssuedLocal(rowId);
      await get().refresh();
      return { ok: true, message: res.message };
    } catch (e) {
      if (isNoResponseError(e)) return { ok: false, message: 'No reply from the server. Try again.' };
      return { ok: false, message: (e as Error)?.message || 'Could not mark it issued.' };
    }
  },

  markNotFound: async (bucketId, pliId, notes) => {
    await get().refreshOnline();
    if (!get().online) return { ok: false, message: 'Connect to the internet to mark a bucket not found.' };
    try {
      const res = await karenBucketRequestsRepository.markBucketNotFound(pliId, notes);
      if (res.kind !== 'ok') return { ok: false, message: res.message };
      await db.markNotFoundLocal(bucketId);
      await get().refresh();
      return { ok: true, message: res.message };
    } catch (e) {
      if (isNoResponseError(e)) return { ok: false, message: 'No reply from the server. Try again.' };
      return { ok: false, message: (e as Error)?.message || 'Could not mark it not found.' };
    }
  },

  closeStop: async (tripId, farm, reason) => {
    await get().refreshOnline();
    if (!get().online) return { ok: false, message: 'Connect to the internet to close the stop.' };
    try {
      const res = await karenBucketRequestsRepository.closeTripStop({ tripId, farm, reason });
      if (res.kind !== 'ok') return { ok: false, message: res.message };
      await get().loadPlannedTrips(farm);
      return { ok: true, message: res.message };
    } catch (e) {
      if (isNoResponseError(e)) return { ok: false, message: 'No reply from the server. Try again.' };
      return { ok: false, message: (e as Error)?.message || 'Could not close the stop.' };
    }
  },

  completedTrips: [],
  loadingCompleted: false,
  arrivals: {},
  shelvedTrips: [],
  shelvedHub: '',
  loadingShelved: false,

  loadShelvedBuckets: async (farm) => {
    await get().refreshOnline();
    if (!get().online) return { ok: false, message: 'Connect to the internet to see shelved buckets.' };
    // The delivery date on screen, like Requests: only that day's orders' buckets.
    const date = get().deliveryDate;
    set({ loadingShelved: true });
    try {
      const res = await karenBucketRequestsRepository.fetchShelvedBuckets(farm, date || undefined);
      // A slow answer for a date the operator has since moved off is dropped.
      if (get().deliveryDate !== date) return { ok: true };
      if (res.kind !== 'ok') {
        set({ loadingShelved: false });
        return { ok: false, message: res.message };
      }
      set({ loadingShelved: false, shelvedTrips: res.trips, shelvedHub: res.hub });
      // Remembered, so Bucket Requests stays off Home and the menu at the hub.
      if (res.hub) setTransferHub(res.hub);
      return { ok: true };
    } catch (e) {
      set({ loadingShelved: false });
      return { ok: false, message: (e as Error)?.message || 'Could not load shelved buckets.' };
    }
  },

  tripArrival: async (tripId, farm, action) => {
    await get().refreshOnline();
    if (!get().online) return { ok: false, message: 'Connect to the internet to update the trip.' };
    try {
      const res = await karenBucketRequestsRepository.tripArrival({ tripId, farm, action });
      if (res.kind !== 'ok') {
        if (action !== 'status') await get().tripArrival(tripId, farm, 'status');
        return { ok: false, message: res.message };
      }
      set({ arrivals: { ...get().arrivals, [tripId]: res.arrival } });
      if (action === 'complete' && res.arrival.tripStatus === 'Received') {
        // Over: it leaves In Transit and shows as received under Completed.
        await get().loadCompletedTrips(farm);
        await get().refresh();
      }
      const a = res.arrival;
      const message =
        action === 'arrive'
          ? `Arrival at ${a.hub} confirmed — ${a.shelved} of ${a.total} bucket${a.total === 1 ? '' : 's'} shelved.`
          : action === 'complete'
            ? `Trip ${tripId} complete — every bucket is shelved at ${a.hub}.`
            : '';
      return { ok: true, message };
    } catch (e) {
      if (isNoResponseError(e)) return { ok: false, message: 'No reply from the server. Try again.' };
      return { ok: false, message: (e as Error)?.message || 'Could not update the trip.' };
    }
  },

  loadCompletedTrips: async (farm) => {
    await get().refreshOnline();
    if (!get().online) return { ok: false, message: 'Connect to the internet to see completed trips.' };
    set({ loadingCompleted: true });
    try {
      const res = await karenBucketRequestsRepository.fetchCompletedTrips(farm);
      set({ loadingCompleted: false, ...(res.kind === 'ok' ? { completedTrips: res.trips } : {}) });
      return res.kind === 'ok' ? { ok: true } : { ok: false, message: res.message };
    } catch (e) {
      set({ loadingCompleted: false });
      return { ok: false, message: (e as Error)?.message || 'Could not load completed trips.' };
    }
  },

  reopenStop: async (tripId, farm) => {
    await get().refreshOnline();
    if (!get().online) return { ok: false, message: 'Connect to the internet to reopen the trip.' };
    try {
      const res = await karenBucketRequestsRepository.reopenTripStop({ tripId, farm });
      if (res.kind !== 'ok') return { ok: false, message: res.message };
      // The reopened stop / next run shows on Trips; refresh both lists.
      await get().loadPlannedTrips(farm);
      await get().loadCompletedTrips(farm);
      return { ok: true, message: res.message };
    } catch (e) {
      if (isNoResponseError(e)) return { ok: false, message: 'No reply from the server. Try again.' };
      return { ok: false, message: (e as Error)?.message || 'Could not reopen the trip.' };
    }
  },

  clearAll: async () => {
    await db.clearAll();
    await storage.remove(StorageKeys.bucketRequestsDownloaded).catch(() => {});
    set({ activeTrolleyId: null, manualDownloaded: false, selectedTripId: null });
    await get().refresh();
  },
}));

export type { OrderGroup, TrolleyOpl };
export type {
  PlannedTrip,
  PlannedTripStop,
  ReplacementCandidate,
} from '../repository/karen-bucket-requests-repository';
