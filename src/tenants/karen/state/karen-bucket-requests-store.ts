import { create } from 'zustand';
import { checkConnectivity } from '@/src/core/network/store';
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
  type PlannedTripStop,
  type ReplacementCandidate,
  type ReplaceReason,
  type ReplaceCorrection,
  type BucketIssueInfo,
  type FlagConflict,
  type AllocationItem,
  type BelowMinimum,
} from '../repository/karen-bucket-requests-repository';
import * as db from '../offline/bucket-requests-db';
import type {
  BucketOrderRef,
  OrderGroup,
  ReqBucket,
  TrolleyOpl,
  ScanResult,
  Vehicle,
  ReqOpl,
  PhoneTrolleyRow,
} from '../offline/bucket-requests-db';

type Counts = Awaited<ReturnType<typeof db.counts>>;

/** Bucket counts of one trip's picklists (the scan page's tabs once a trip is open). */
export type TripCounts = Pick<
  Counts,
  'scannedBuckets' | 'totalBuckets' | 'allBuckets' | 'addedBuckets' | 'transitBuckets' | 'requests'
>;

type State = {
  ready: boolean;
  /** The device's saved trips / requests have been read: until then nothing is known. */
  hydrated: boolean;
  /** A pull from the server finished (or there was nothing to pull: offline / no farm). */
  synced: boolean;
  /** The device holds saved trips / picklists (read first thing on open; null = not
   *  read yet): a reopened page shows them instead of skeletons while it pulls. */
  savedData: boolean | null;
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
  /** `belowMinimum`: the truck is under its minimum load; resend with a reason to send anyway. */
  closeStop: (
    tripId: string,
    farm: string,
    reason?: string,
    complete?: boolean,
  ) => Promise<{ ok: boolean; message: string; belowMinimum?: BelowMinimum }>;
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
/** Bucket rows whose live scan flag call is still on its way: the sync leaves them alone. */
const flagInFlight = new Set<number>();
/** Trolleys used on this phone (upper-cased): a typed trolley id while a trolley is
 *  active must name one of them, else it is taken for a bucket typed in. */
const knownTrolleys = new Set<string>();

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

/** The order runs collect in, the server's (trip_bucket_shares): by day, then run. */
function byDriveOrder(a: PlannedTrip, b: PlannedTrip): number {
  return (
    (a.tripDate || '').localeCompare(b.tripDate || '') ||
    Number(!a.run) - Number(!b.run) ||
    (a.run || 0) - (b.run || 0) ||
    a.tripId.localeCompare(b.tripId)
  );
}

/** The open runs planning picklist `opl` here, in the order they collect. */
function oplRuns(trips: PlannedTrip[], opl: string): PlannedTrip[] {
  return trips.filter((t) => !t.yourStopClosed && hasOpl(t, opl)).sort(byDriveOrder);
}

const orderOn = (t: PlannedTrip, opl: string) => (t.orders ?? []).find((o) => o.opl === opl);
const onTruckOf = (o: ReturnType<typeof orderOn>) => (o ? (o.loaded || 0) + (o.transit || 0) + (o.shelved || 0) : 0);

/** How many of `held` (an order's buckets on trolleys here) count on `trip`. An order
 *  split over runs fills the earliest first, each up to its planned buckets less what is
 *  already on its truck, and the last run takes any surplus: the server's rule, so the
 *  app and the Bucket Logistics dashboard count each bucket on the same one trip. */
export function heldOnTrip(trips: PlannedTrip[], trip: PlannedTrip, opl: string, held: number): number {
  const runs = oplRuns(trips, opl);
  if (runs.length < 2) return held;
  let left = held;
  for (let i = 0; i < runs.length; i++) {
    const o = orderOn(runs[i], opl);
    // Its share on that run as the server counts it (on_trip), else its planned buckets.
    const share = o?.onTrip ?? (o?.buckets || 0);
    const take = i === runs.length - 1 ? left : Math.min(left, Math.max(0, share - onTruckOf(o)));
    if (runs[i].tripId === trip.tripId) return take;
    left -= take;
  }
  return 0;
}

/** The orders on `trip` only for a bucket they share with another of its orders (the
 *  server's rider: riding and nothing counted of its own on this trip). */
export function ridingOnlyOpls(trip: PlannedTrip | null | undefined): Set<string> {
  return new Set(
    (trip?.orders ?? []).filter((o) => !(o.onTrip ?? o.total) && (o.riding ?? 0) > 0).map((o) => o.opl),
  );
}

/** This farm's buckets on a trip, as its card and the dashboard count them. */
/** Every bucket planned at this stop is on the truck: the server's flag, else the counts. */
export function stopReady(stop: PlannedTripStop): boolean {
  return stop.ready ?? (stopBuckets(stop) > 0 && stop.loaded + stop.transit + stop.shelved >= stopBuckets(stop));
}

export function stopBuckets(stop: { buckets?: number; total: number; planned: number }): number {
  return stop.buckets ?? (stop.total || stop.planned);
}

/** The earlier run that takes an order's buckets before `trip`: it plans the order here
 *  too and its share still waits on the shelf. `unsynced`: buckets of the order on
 *  trolleys here the server has not counted yet. Null = `trip` is the run to fill. */
export function earlierRunFirst(
  trips: PlannedTrip[],
  trip: PlannedTrip,
  opl: string,
  unsynced: number,
): PlannedTrip | null {
  const runs = oplRuns(trips, opl);
  // An older server sends the whole portion as each run's total: leave it to the server.
  if (runs.some((t) => orderOn(t, opl)?.riding === undefined)) return null;
  let extra = unsynced;
  for (const t of runs) {
    if (t.tripId === trip.tripId) return null;
    const o = orderOn(t, opl);
    const waiting = Math.max(0, (o?.total || 0) - (o?.trolley || 0) - onTruckOf(o));
    const covered = Math.min(waiting, extra);
    extra -= covered;
    if (waiting > covered) return t;
  }
  return null;
}

/** The trip that took over `was` after a re-plan: the same truck's same run that day
 *  (a run-less truck: its only open trip that day). */
function successorTrip(was: PlannedTrip | undefined, trips: PlannedTrip[]): PlannedTrip | null {
  if (!was?.vehicle) return null;
  const same = trips.filter(
    (t) => t.vehicle === was.vehicle && t.tripDate === was.tripDate && t.run === was.run && !t.yourStopClosed,
  );
  return same.length === 1 ? same[0] : null;
}

const refOf = (o: { oplName: string; orderName: string; buckets: { asap: boolean }[] }): BucketOrderRef => ({
  oplName: o.oplName,
  orderName: o.orderName,
  asap: o.buckets.some((b) => b.asap),
});

/** A picklist as the lists hold it: this farm's buckets of it for the date on screen. */
type Listed = { oplName: string; orderName: string; buckets: ReqBucket[] };

const bucketKeys = (rows: Listed[], keep: (b: ReqBucket) => boolean = () => true) =>
  new Set(rows.flatMap((o) => o.buckets.filter(keep).map((b) => b.bucketId.toUpperCase()))).size;

/** db.counts worked out from the lists already in memory (every picklist with a bucket
 *  here is on exactly one of Requests / Trolley / In Transit, with all its buckets). */
function countLists(listed: Listed[], onTrip?: Set<string>, only?: Set<string>): Counts {
  // An order on no truck trip whose buckets are on trolleys (another phone scanned them):
  // listed under Not Scheduled, and its buckets count on the On trolley tile.
  const waitingHeld = only
    ? []
    : listed.filter((o) => o.buckets.length > 0 && o.buckets.every((b) => !b.scheduled) && o.buckets.some((b) => b.scanned));
  const rows = listed
    .map((o) => {
      const live = o.buckets.filter((b) => !b.notFound);
      return {
        o,
        total: o.buckets.length,
        scanned: o.buckets.filter((b) => b.scanned).length,
        inTransit: live.length > 0 && live.every((b) => b.truckTransit),
        unscheduled: o.buckets.filter((b) => !b.scheduled).length,
      };
    })
    // An order on no truck trip yet (every bucket unscheduled) is not requested yet.
    .filter((r) => r.total > 0 && r.unscheduled < r.total)
    .filter((r) => !onTrip || onTrip.has(r.o.oplName) || r.scanned > 0 || r.inTransit)
    .filter((r) => !only || only.has(r.o.oplName));
  let requests = 0;
  let trolley = 0;
  let inTransit = 0;
  for (const r of rows) {
    if (r.scanned < r.total) requests++;
    else if (r.inTransit) inTransit++;
    else trolley++;
  }
  // Each physical bucket once: a bucket filling two orders has a row on each.
  const all = rows.map((r) => r.o);
  const stage = rows.filter((r) => !r.inTransit).map((r) => r.o);
  return {
    requests,
    trolley,
    inTransit,
    // Their buckets count once: requested and on a trolley (Not Scheduled's count leaves
    // them out), so the Trolley tab never reads more added than requested.
    allBuckets: new Set([
      ...all.flatMap((o) => o.buckets.map((b) => b.bucketId.toUpperCase())),
      ...waitingHeld.flatMap((o) => o.buckets.filter((b) => b.scanned && !b.notFound).map((b) => b.bucketId.toUpperCase())),
    ]).size,
    addedBuckets: new Set([
      ...all.flatMap((o) => o.buckets.filter((b) => b.scanned).map((b) => b.bucketId.toUpperCase())),
      ...waitingHeld.flatMap((o) => o.buckets.filter((b) => b.scanned && !b.notFound).map((b) => b.bucketId.toUpperCase())),
    ]).size,
    transitBuckets: bucketKeys(all, (b) => !!b.truckTransit),
    totalBuckets: bucketKeys(stage),
    scannedBuckets: bucketKeys(stage, (b) => b.scanned),
  };
}

/** db.oplBucketCounts on the lists in memory: per picklist its buckets once each,
 *  leaving out the ones `sharedWith`'s other picklists also hold. */
function oplCounts(
  listed: Listed[],
  opls: string[],
  sharedWith: string[],
): Map<string, { total: number; scanned: number; held: number }> {
  const byOpl = new Map(listed.map((o) => [o.oplName, o]));
  const out = new Map<string, { total: number; scanned: number; held: number }>();
  for (const op of opls) {
    const own = byOpl.get(op);
    if (!own) continue;
    const others = new Set(
      sharedWith
        .filter((x) => x !== op)
        .flatMap((x) => (byOpl.get(x)?.buckets ?? []).map((b) => b.bucketId.toUpperCase())),
    );
    const mine = { ...own, buckets: own.buckets.filter((b) => !others.has(b.bucketId.toUpperCase())) };
    if (!mine.buckets.length) continue;
    out.set(op, {
      total: bucketKeys([mine]),
      scanned: bucketKeys([mine], (b) => b.scanned),
      held: bucketKeys([mine], (b) => b.scanned && !b.notFound && !b.truckLoaded && !b.truckTransit),
    });
  }
  return out;
}

/** The open trip's picklists and counts, from the lists in memory: what the scan page
 *  shows the moment a trip is opened, and what each refresh confirms. */
function tripView(
  trip: PlannedTrip,
  trips: PlannedTrip[],
  requests: OrderGroup[],
  trolley: TrolleyOpl[],
  inTransit: TrolleyOpl[],
): { tripOpls: string[]; tripCounts: Counts } {
  const listed: Listed[] = [...requests.flatMap((g) => g.opls), ...trolley, ...inTransit];
  const tripOpls = [...new Set(listed.filter((o) => onTrip(trip, refOf(o), trips)).map((o) => o.oplName))];
  let tc = countLists(listed, undefined, new Set(tripOpls));
  // An order split over runs: this trip counts only its share of the order.
  const split = tripOpls.filter((op) => oplRuns(trips, op).length > 1);
  const orders = trip.orders ?? [];
  if (orders.length && orders.every((o) => o.onTrip != null)) {
    // The server counts each order's buckets on this trip (on_trip: the trip card and
    // the dashboard show their sum), a bucket two orders share once and an order split
    // over runs by its share here. The scan page shows the same: those figures, plus
    // this phone's trolley buckets the server has not counted yet, each bucket once.
    const byOpl = new Map(listed.map((o) => [o.oplName, o]));
    const key = (b: ReqBucket) => b.bucketId.toUpperCase();
    const isHeld = (b: ReqBucket) => b.scanned && !b.notFound && !b.truckLoaded && !b.truckTransit;
    const used = new Set<string>();
    let total = 0;
    let added = 0;
    let stageTotal = 0;
    let stageAdded = 0;
    for (const o of orders) {
      const want = o.onTrip ?? 0;
      const onTruck = Math.min(want, onTruckOf(o));
      const keys = [...new Set((byOpl.get(o.opl)?.buckets ?? []).filter(isHeld).map(key))];
      // An order split over runs: only this run's share of its trolley buckets.
      const share = heldOnTrip(trips, trip, o.opl, keys.length);
      let room = want - onTruck;
      let held = 0;
      for (const k of keys.slice(0, share)) {
        if (room <= 0) break;
        if (used.has(k)) continue;
        used.add(k);
        room--;
        held++;
      }
      total += want;
      added += onTruck + held;
      if (onTruck < want) {
        stageTotal += want;
        stageAdded += onTruck + held;
      }
    }
    // Picklists riding with the trip that the server does not list on it (an ASAP
    // replacement following its order): their buckets here, once each.
    const listedOn = new Set(orders.map((o) => o.opl));
    const extra = tripOpls.filter((op) => !listedOn.has(op)).map((op) => byOpl.get(op)).filter((o): o is Listed => !!o);
    const counted = new Set(orders.flatMap((o) => (byOpl.get(o.opl)?.buckets ?? []).map(key)));
    const extraIds = new Set(extra.flatMap((o) => o.buckets.filter((b) => !b.notFound).map(key)).filter((k) => !counted.has(k)));
    const extraAdded = new Set(
      extra.flatMap((o) => o.buckets.filter((b) => b.scanned && !b.notFound).map(key)).filter((k) => extraIds.has(k)),
    ).size;
    tc = {
      ...tc,
      allBuckets: total + extraIds.size,
      addedBuckets: added + extraAdded,
      totalBuckets: stageTotal + extraIds.size,
      scannedBuckets: stageAdded + extraAdded,
    };
  } else if (split.length) {
    // An older server (no on_trip): its planned buckets per order.
    // A bucket shared with another order on this trip counts once, on that order.
    const per = oplCounts(listed, split, tripOpls);
    for (const op of split) {
      const c = per.get(op);
      if (!c) continue;
      const o = orderOn(trip, op);
      const total = o?.buckets || 0;
      const scanned = Math.min(total, onTruckOf(o) + heldOnTrip(trips, trip, op, c.held));
      tc = {
        ...tc,
        totalBuckets: Math.max(0, tc.totalBuckets - c.total + total),
        scannedBuckets: Math.max(0, tc.scannedBuckets - c.scanned + scanned),
        allBuckets: Math.max(0, tc.allBuckets - c.total + total),
        addedBuckets: Math.max(0, tc.addedBuckets - c.scanned + scanned),
      };
    }
  }
  return { tripOpls, tripCounts: tc };
}

/** Same data, field by field (plain JSON-like values). */
function same(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const bb = b as unknown[];
    return a.length === bb.length && a.every((v, i) => same(v, bb[i]));
  }
  const ka = Object.keys(a);
  const ob = b as Record<string, unknown>;
  return ka.length === Object.keys(ob).length && ka.every((k) => same((a as Record<string, unknown>)[k], ob[k]));
}

/** Not Scheduled: orders on no truck trip yet -- waiting ones, and ones whose buckets are
 *  all on trolleys already (another phone scanned them): they are on no trip, so no
 *  tile or trip lists them otherwise and they vanished from a new device. */
export function waitingGroups(requests: OrderGroup[], trolley: TrolleyOpl[]): OrderGroup[] {
  const groups = new Map<string, OrderGroup>();
  const add = (o: ReqOpl) => {
    const g = groups.get(o.orderName);
    if (g) g.opls.push(o);
    else groups.set(o.orderName, { orderName: o.orderName, opls: [o] });
  };
  for (const g of requests) for (const o of g.opls) if (!o.scheduled) add(o);
  for (const o of trolley) {
    if (!o.buckets.length || o.buckets.some((b) => b.scheduled) || o.loadedToTruck) continue;
    add({
      oplName: o.oplName,
      orderName: o.orderName,
      createdOn: o.createdOn,
      customer: o.customer,
      deliveryDate: '',
      total: o.buckets.length,
      scanned: o.buckets.filter((b) => b.scanned).length,
      asap: 0,
      scheduled: false,
      buckets: o.buckets,
    });
  }
  return [...groups.values()];
}

const listedAny = (requests: OrderGroup[], trolley: TrolleyOpl[], inTransit: TrolleyOpl[]) =>
  requests.length > 0 || trolley.length > 0 || inTransit.length > 0;

/** A row sent to setOfflineTrolleyFlags: its pick row and bucket. */
export type SentRow = { pliId: string; bucketId: string };

/** Which sent pick rows the server flagged and which it refused. A newer server lists
 *  the rows it flagged (and names each refused one); an older one names only refused
 *  buckets (or its not-scheduled ones), so every row of such a bucket counts refused. */
export function splitFlagResult(
  sent: SentRow[],
  res: { accepted: string[] | null; conflicts: FlagConflict[]; notScheduled: string[] },
): { accepted: string[]; refused: string[] } {
  const plis = [...new Set(sent.map((r) => r.pliId))];
  if (res.accepted) {
    const ok = new Set(res.accepted);
    return { accepted: plis.filter((p) => ok.has(p)), refused: plis.filter((p) => !ok.has(p)) };
  }
  const byPli = new Set(res.conflicts.map((c) => c.pli).filter((p): p is string => !!p));
  const names = new Set(
    [...res.conflicts.map((c) => c.bucket), ...res.notScheduled].map((b) => b.trim().toUpperCase()).filter(Boolean),
  );
  const refused = new Set(
    sent
      .filter((r) => byPli.has(r.pliId) || names.has(r.bucketId.trim().toUpperCase()) || names.has(r.pliId.toUpperCase()))
      .map((r) => r.pliId),
  );
  return { accepted: plis.filter((p) => !refused.has(p)), refused: [...refused] };
}

/** Why a bucket was not loaded, for the Load to truck message. */
function conflictText(c: FlagConflict): string {
  return c.reason === 'trip_left'
    ? `${c.bucket}: ${c.truck ?? 'the truck'} is already in transit`
    : c.reason === 'other_trip'
      ? `${c.bucket} is not on this trip — ${c.truck ? `it is on ${c.truck}` : 'it is not scheduled yet'}`
      : c.reason === 'on_truck'
        ? `${c.bucket} is on ${c.truck ?? 'another truck'}`
        : c.reason === 'not_loaded'
          ? `${c.bucket} is not on the truck`
          : `${c.bucket} is at the packhouse`;
}

/** A trolley scan the server refused, as the scan page says it. */
function refusalText(bucketId: string, c: FlagConflict): string {
  const id = bucketId.toUpperCase();
  return c.reason === 'trip_left'
    ? `${id} not added — ${c.truck ?? 'this truck'} is already in transit.`
    : c.earlier
      ? `${id} goes on ${c.truck ?? 'the earlier trip'} first — taken off the trolley.`
      : c.reason === 'other_trip'
        ? `${id} is not on this trip — ${c.truck ? `it is on ${c.truck}` : 'it is not scheduled yet'}.`
        : c.reason === 'on_truck'
          ? `${id} is already on ${c.truck ?? 'another truck'} — taken off the trolley.`
          : c.reason === 'not_loaded'
            ? `${id} is not on the truck yet — load it to the truck first.`
            : `${id} was already issued / shelved at the packhouse — taken off the trolley.`;
}

/** Offline scans, and scans whose flag failed, reach the server only through this: the
 *  sync sends each bucket on this phone's trolleys the server still has off a trolley
 *  (`onTrolley === false` in the download) as a trolley scan, for the trip it was
 *  scanned for. Refused ones come off the trolley as a live scan's would -- except a
 *  refusal for the trip (trip_left / other_trip): the saved plan may be stale, so those
 *  stay on, marked not synced, and are listed in `retry` to send again once the plan is
 *  fresh. A failed send is marked not synced and tried again on the next sync. Rows in
 *  `skip` (a live scan's flag still on its way) are left alone. */
export async function sendPendingScans(
  items: AllocationItem[],
  trips: PlannedTrip[],
  rows: PhoneTrolleyRow[],
  io: {
    flags: typeof karenBucketRequestsRepository.setOfflineTrolleyFlags;
    setFlagSync: typeof db.setFlagSync;
    unscan: typeof db.unscanBucket;
  },
  opts: { skip?: Set<number>; only?: Set<number>; replan?: boolean } = {},
): Promise<{ refusal: string | null; retry: number[] }> {
  const none = { refusal: null, retry: [] as number[] };
  if (!items.some((i) => i.onTrolley !== undefined)) return none; // older server: no trolley state
  const key = (opl: string, bucket: string) => `${opl}|${bucket.trim().toUpperCase()}`;
  const on = new Set<string>();
  const off = new Set<string>();
  for (const it of items) {
    if (it.onTrolley === true) on.add(key(it.oplName, it.bucketId));
    else if (it.onTrolley === false) off.add(key(it.oplName, it.bucketId));
  }
  const pending = rows.filter((r) => r.flagSync !== 0 && !opts.skip?.has(r.id) && (!opts.only || opts.only.has(r.id)));
  const confirmed = pending.filter((r) => on.has(key(r.oplName, r.bucketId)));
  await io.setFlagSync(confirmed.map((r) => r.id), 0);
  const send = pending.filter((r) => r.pliId && !on.has(key(r.oplName, r.bucketId)) && off.has(key(r.oplName, r.bucketId)));
  const byTrip = new Map<string, PhoneTrolleyRow[]>();
  for (const r of send) {
    // The trip it was scanned for; a re-check after a trip refusal (or a scan saved
    // before the trip was recorded) takes the plan's trip for its order.
    const planned = tripForOrder(trips, { oplName: r.oplName, orderName: r.orderName, asap: r.asap })?.tripId ?? '';
    const k = opts.replan ? planned || r.scanTrip : r.scanTrip || planned;
    byTrip.set(k, [...(byTrip.get(k) ?? []), r]);
  }
  let refusal: string | null = null;
  const retry: number[] = [];
  for (const [trip, group] of byTrip) {
    const ids = group.map((r) => r.id);
    try {
      const res = await io.flags({
        pliIds: [...new Set(group.map((r) => r.pliId as string))],
        flag: 'loaded',
        keepShelf: true,
        ...(trip ? { trip } : {}),
      });
      if (res.kind !== 'ok') {
        await io.setFlagSync(ids, 2);
        continue;
      }
      const sent = group.map((r) => ({ pliId: r.pliId as string, bucketId: r.bucketId }));
      const out = new Set(splitFlagResult(sent, res).refused);
      const conflictOf = (r: PhoneTrolleyRow) =>
        res.conflicts.find((x) => x.pli === r.pliId) ??
        res.conflicts.find((x) => !x.pli && x.bucket.trim().toUpperCase() === r.bucketId.trim().toUpperCase());
      const refusedRows = group.filter((r) => out.has(r.pliId as string));
      const forTrip = refusedRows.filter((r) => {
        const reason = conflictOf(r)?.reason;
        return reason === 'trip_left' || reason === 'other_trip';
      });
      const gone = refusedRows.filter((r) => !forTrip.includes(r));
      await io.setFlagSync(forTrip.map((r) => r.id), 2);
      retry.push(...forTrip.map((r) => r.id));
      await io.unscan(gone.map((r) => r.id));
      await io.setFlagSync(group.filter((r) => !out.has(r.pliId as string)).map((r) => r.id), 0);
      const first = gone[0];
      if (first && !refusal) {
        const c = conflictOf(first);
        const waiting = res.notScheduled.some(
          (b) => b.trim().toUpperCase() === first.bucketId.trim().toUpperCase() || b === first.pliId,
        );
        refusal =
          (c
            ? refusalText(first.bucketId, c)
            : waiting
              ? `${first.bucketId.toUpperCase()} is not on a truck trip yet — taken off the trolley.`
              : `${first.bucketId.toUpperCase()} is no longer requested (not found or replaced) — taken off the trolley.`) +
          (gone.length > 1 ? ` (${gone.length} buckets taken off)` : '');
      }
    } catch {
      await io.setFlagSync(ids, 2);
    }
  }
  return { refusal, retry };
}

const TILE_KEYS = [
  'reqCount',
  'trolleyCount',
  'scannedBuckets',
  'totalBuckets',
  'allBuckets',
  'addedBuckets',
  'transitBuckets',
  'inTransitCount',
] as const;
/** The saved tile counts (db.saveTiles) as store fields. */
function pickTiles(t: Record<string, number>): Partial<Record<(typeof TILE_KEYS)[number], number>> {
  return Object.fromEntries(TILE_KEYS.filter((k) => typeof t[k] === 'number').map((k) => [k, t[k]]));
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

export const useKarenBucketRequestsStore = create<State>((set, get) => {
  /** set() with only what changed: unchanged data keeps its old reference, and nothing
   *  changed = no update at all, so a sync that brings nothing new never re-renders. */
  const patch = (next: Partial<State>) => {
    const cur = get();
    const diff: Partial<State> = {};
    let n = 0;
    for (const k of Object.keys(next) as (keyof State)[]) {
      if (same(cur[k], next[k])) continue;
      (diff as Record<string, unknown>)[k] = next[k];
      n++;
    }
    if (n) set(diff);
  };
  return {
  ready: false,
  hydrated: false,
  synced: false,
  savedData: null,
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
      // The saved trips first (one quick read), so the Trips page opens on them at once;
      // the full lists and counts follow.
      if (!get().hydrated) {
        const [trips, schedules, tiles, hasReq] = await Promise.all([
          db.listPlannedTrips(),
          db.listSchedules(),
          db.loadTiles(),
          db.hasSavedRequests(),
        ]).catch(() => [[] as PlannedTrip[], [] as OplSchedule[], null, false] as const);
        if (get().savedData === null) set({ savedData: trips.length > 0 || hasReq });
        if (!get().hydrated && trips.length) {
          set({
            plannedTrips: [...trips],
            schedules: [...schedules],
            tripsCount: trips.length,
            ...(tiles ? pickTiles(tiles) : {}),
          });
        }
      }
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
    // A date outside the usual download window (today .. tomorrow): fetch
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
      // The first read failing still ends the first load (empty, not a skeleton forever).
      if (!get().hydrated) set({ hydrated: true });
      return;
    }
    const [allRequests, trolley, inTransit, vehicles, allTrips, schedules, deliveryDates] = lists;
    for (const t of await db.listTrolleyIds().catch(() => [] as string[])) knownTrolleys.add(t);
    // Only orders on the Packhouse Schedule are worked here (an ASAP replacement too);
    // an order on no truck trip yet is only listed, under Not Scheduled.
    const scheduled = new Set(schedules.filter((sc) => sc.scheduled).map((sc) => sc.oplName));
    const requests = allRequests
      .map((g) => ({ ...g, opls: g.opls.filter((o) => o.scheduled && (scheduled.has(o.oplName) || o.asap > 0)) }))
      .filter((g) => g.opls.length > 0);
    const notScheduled = get().showUnscheduled ? waitingGroups(allRequests, trolley) : [];
    // Trips are shown whole, as the server counts them (the screen lists every delivery
    // date: a truck carries several days' orders).
    const plannedTrips = allTrips;
    // The open trip: still planned and its stop here still open, else back to Trips.
    const sel = get().selectedTripId;
    let trip = sel ? (plannedTrips.find((t) => t.tripId === sel) ?? null) : null;
    // The server keeps a trip's name when it re-plans; should a trip still be replaced
    // (an older server), follow the same truck run under its new name instead of
    // dropping its requests.
    const replaced = sel && !trip ? successorTrip(get().plannedTrips.find((t) => t.tripId === sel), plannedTrips) : null;
    if (sel && replaced) {
      if (trolleyTrip === sel) trolleyTrip = replaced.tripId;
      if (loadedTrips.delete(sel)) loadedTrips.add(replaced.tripId);
      trip = replaced;
    }
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
    const view = trip ? tripView(trip, plannedTrips, requests, trolley, inTransit) : null;
    // Counts cover the same picklists the Requests tab lists: the ones on an open trip.
    const c = countLists(
      [...allRequests.flatMap((g) => g.opls), ...trolley, ...inTransit],
      new Set(plannedTrips.filter((t) => !t.yourStopClosed).flatMap((t) => (t.orders ?? []).map((o) => o.opl))),
    );
    // A trip opened or closed while this refresh ran: its own refresh sets the trip view.
    const sameTrip = get().selectedTripId === sel;
    // Dates to filter by: the orders on the device, plus the ones on planned trips.
    const dates = [
      ...new Set([
        ...deliveryDates,
        ...allTrips.flatMap((t) => (t.orders ?? []).map((o) => o.deliveryDate).filter(Boolean)),
      ]),
    ].sort();
    patch({
      hydrated: true,
      ...(get().savedData === null ? { savedData: allTrips.length > 0 || listedAny(allRequests, trolley, inTransit) } : {}),
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
            selectedTripId: trip ? trip.tripId : null,
            tripOpls: view?.tripOpls ?? [],
            tripCounts: view?.tripCounts ?? null,
            ...(notice ? { tripNotice: { at: Date.now(), message: notice } } : {}),
          }
        : {}),
    });
    const tiles: Record<string, number> = {
      reqCount: c.requests,
      trolleyCount: c.trolley,
      scannedBuckets: c.scannedBuckets,
      totalBuckets: c.totalBuckets,
      allBuckets: c.allBuckets,
      addedBuckets: c.addedBuckets,
      transitBuckets: c.transitBuckets,
      inTransitCount: c.inTransit,
    };
    db.saveTiles(tiles).catch(() => {});
  },

  selectTrip: async (tripId) => {
    // Another trip's buckets go on another trolley: opening it asks for a trolley again.
    const trolley = tripId && tripId !== trolleyTrip ? { activeTrolleyId: null } : {};
    // The trip page opens on what is already in memory, in this same update; the
    // refresh after it only changes what the device has changed since.
    const st = get();
    const trip = tripId ? st.plannedTrips.find((t) => t.tripId === tripId && !t.yourStopClosed) : undefined;
    const view = trip ? tripView(trip, st.plannedTrips, st.requests, st.trolley, st.inTransit) : null;
    set({
      selectedTripId: tripId,
      tripOpls: view?.tripOpls ?? [],
      tripCounts: view?.tripCounts ?? null,
      tripNotice: null,
      ...trolley,
    });
    await get().refresh();
  },

  refreshOnline: async () => {
    patch({ online: await checkConnectivity() });
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
      // today .. tomorrow). No date chosen = that default window.
      const date = get().deliveryDate;
      const outcome = date
        ? await karenBucketRequestsRepository.fetchAllocations(farm, date, date)
        : await karenBucketRequestsRepository.fetchAllocations(farm);
      if (outcome.kind === 'error') {
        set({ downloading: false, synced: true });
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
          patch({ showUnscheduled: trips.showUnscheduled, groupByOrder: trips.groupByOrder });
          await db.applyServerStates(trips.oplStates);
          await prune(items, trips.known);
        }
      } catch {
        /* keep the cached plan */
      }
      await get().refresh();
      set({ synced: true });
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
      set({ downloading: false, synced: true });
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
      patch({ showUnscheduled: trips.showUnscheduled, groupByOrder: trips.groupByOrder });
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
    if (!farm) {
      set({ synced: true });
      return;
    }
    if (syncing) return;
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
      // Scans made offline (or whose flag failed) go up now, before the trip plan is
      // pulled, so the plan already counts them on their trolleys.
      const io = {
        flags: (a: Parameters<typeof karenBucketRequestsRepository.setOfflineTrolleyFlags>[0]) =>
          karenBucketRequestsRepository.setOfflineTrolleyFlags(a),
        setFlagSync: db.setFlagSync,
        unscan: db.unscanBucket,
      };
      let retry: number[] = [];
      if (alloc.kind === 'ok') {
        try {
          const r = await sendPendingScans(alloc.items, await db.listPlannedTrips(), await db.phoneTrolleyRows(), io, {
            skip: flagInFlight,
          });
          retry = r.retry;
          if (r.refusal) set({ scanRefusal: { at: Date.now(), message: r.refusal } });
        } catch {
          /* tried again on the next sync */
        }
      }
      const trips = await karenBucketRequestsRepository.fetchPlannedTrips(farm, await db.listOplNames());
      if (trips.kind === 'ok' && retry.length && alloc.kind === 'ok') {
        // Refused for the trip on the saved plan: send them again on the fresh plan's trip.
        try {
          const r = await sendPendingScans(alloc.items, trips.trips, await db.phoneTrolleyRows(), io, {
            skip: flagInFlight,
            only: new Set(retry),
            replan: true,
          });
          if (r.refusal) set({ scanRefusal: { at: Date.now(), message: r.refusal } });
        } catch {
          /* tried again on the next sync */
        }
      }
      if (trips.kind === 'ok') {
        await db.replacePlannedTrips(trips.trips);
        await db.replaceSchedules(trips.schedules);
        patch({ showUnscheduled: trips.showUnscheduled, groupByOrder: trips.groupByOrder });
        await db.applyServerStates(trips.oplStates);
        if (alloc.kind === 'ok') await prune(alloc.items, trips.known);
      }
      await get().refresh();
    } catch {
      /* background pull: keep what is on screen */
    } finally {
      syncing = false;
      // A download in progress settles it itself.
      if (!get().downloading && !get().synced) set({ synced: true });
    }
  },

  setTrolleyFromScan: (raw) => {
    const id = karenBucketRequestsRepository.extractTrolleyIdFromScan(raw);
    if (!id) return { ok: false, message: get().activeTrolleyId ? 'Not a bucket QR code.' : 'Not a trolley QR code.' };
    // Typed text (no QR) while a trolley is active is a bucket typed in, unless it names
    // a trolley this phone already uses: never start a new trolley from it.
    const typed = !raw.trim().startsWith('{');
    if (typed && get().activeTrolleyId && !knownTrolleys.has(id.toUpperCase())) {
      return { ok: false, message: 'Not a bucket QR code.' };
    }
    knownTrolleys.add(id.toUpperCase());
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
      // An order split over runs loads its earlier run first: a bucket of it counts on
      // this trip only once the earlier run's share is on trolleys (as the server counts).
      const per = await db.oplBucketCounts(mine.map((r) => r.oplName)).catch(() => new Map<string, { held: number }>());
      const first = mine.map((r) => {
        if (r.asap) return null;
        const known = oplRuns(trips, r.oplName).reduce((n, t) => n + (orderOn(t, r.oplName)?.trolley || 0), 0);
        return earlierRunFirst(trips, trip, r.oplName, Math.max(0, (per.get(r.oplName)?.held ?? 0) - known));
      });
      const free = mine.filter((_, i) => !first[i]);
      if (!free.length) {
        const run = first.find((t): t is PlannedTrip => !!t)!;
        return {
          ok: false,
          message: `${id.toUpperCase()} goes on ${tripTitle(run)} first — ${mine[0].orderName} fills that trip before ${tripTitle(trip)}.`,
        };
      }
      only = free.map((r) => r.oplName);
      const held = await db.trolleyOrders(trolley).catch(() => [] as BucketOrderRef[]);
      // A bucket several orders share is on the trolley once: it belongs to this trip
      // when any of its orders rides on it (the others ride with that one).
      const mineHeld = new Set(held.filter((r) => onTrip(trip, r, trips)).flatMap((r) => r.buckets ?? []));
      const foreign = held.find(
        (r) => !onTrip(trip, r, trips) && (!r.buckets?.length || r.buckets.some((b) => !mineHeld.has(b))),
      );
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
      res = await db.scanBucket(id, trolley, only, get().selectedTripId ?? undefined);
    } catch (e) {
      // A local-database hiccup (e.g. the connection released by a reload): report it,
      // never leave it as an unhandled rejection.
      return { ok: false, message: (e as Error)?.message || 'Could not save the scan — scan it again.' };
    }
    if (res.ok && res.pliIds.length && get().online) {
      // Online: flag it on the trolley on the server too (the same flag the offline
      // sync sends later), so it can't also be issued offline at the packhouse — in the
      // background, so the scan never waits on the network. A bucket already issued /
      // arrived there is refused: the scan is undone and `scanRefusal` says why.
      const { pliIds, rowIds, rowPliIds, bucketId } = res;
      for (const r of rowIds) flagInFlight.add(r);
      karenBucketRequestsRepository
        .setOfflineTrolleyFlags({
          pliIds,
          flag: 'loaded',
          keepShelf: true,
          trip: get().selectedTripId ?? undefined,
        })
        .then(async (flag) => {
          if (flag.kind !== 'ok') {
            // Refused as a whole (server error, expired session): the scan stays, marked
            // not synced; the sync sends it again.
            await db.setFlagSync(rowIds, 2).catch(() => {});
            await get().refresh();
            return;
          }
          const clashes = flag.conflicts;
          const clash = clashes[0];
          if (flag.accepted) {
            // A newer server lists the rows it flagged: only those are synced. A refused row
            // (a conflict) or one of an order on no truck trip comes off the trolley; one
            // it skipped without a reason (not found / replaced there) stays, not synced.
            const sent = rowIds.map((_, i) => ({ pliId: rowPliIds[i] ?? '', bucketId }));
            const took = new Set(splitFlagResult(sent.filter((r) => r.pliId), flag).accepted);
            const lc = bucketId.trim().toUpperCase();
            const waiting = flag.notScheduled.some((b) => b.trim().toUpperCase() === lc);
            const ok: number[] = [];
            const gone: number[] = [];
            const skipped: number[] = [];
            rowIds.forEach((r, i) => {
              const pli = rowPliIds[i];
              if (!pli) return; // never sent: left for the sync
              if (took.has(pli)) ok.push(r);
              else if (clashes.some((c) => c.pli === pli) || waiting) gone.push(r);
              else skipped.push(r);
            });
            await db.setFlagSync(ok, 0).catch(() => {});
            await db.unscanBucket(gone).catch(() => {});
            await db.setFlagSync(skipped, 2).catch(() => {});
            const id = bucketId.toUpperCase();
            const message = clash
              ? refusalText(bucketId, clash)
              : gone.length && waiting
                ? `${id} is not on a truck trip yet — taken off the trolley.`
                : skipped.length
                  ? `${id} is no longer requested (not found or replaced) — not synced.`
                  : null;
            if (message) set({ scanRefusal: { at: Date.now(), message } });
            await get().refresh();
            return;
          }
          let gone: number[];
          if (clashes.some((c) => c.pli)) {
            // A newer server names each refused pick row.
            gone = rowIds.filter((_, i) => clashes.some((c) => c.pli && c.pli === rowPliIds[i]));
          } else {
            // Only the refused rows come off the trolley: an older server refuses a shared
            // bucket's row for an order on another trip alone and keeps this trip's row
            // (the first). A conflict names the pick row, or else the bucket once per row.
            const byPli = rowIds.filter((_, i) => clashes.some((c) => c.bucket === rowPliIds[i]));
            const rest = rowIds.filter((r) => !byPli.includes(r));
            const lc = bucketId.trim().toLowerCase();
            const n = clashes.filter((c) => c.bucket.trim().toLowerCase() === lc).length;
            gone = [...byPli, ...rest.slice(Math.max(0, rest.length - n))];
          }
          await db.unscanBucket(gone).catch(() => {});
          await db.setFlagSync(rowIds.filter((r) => !gone.includes(r)), 0).catch(() => {});
          if (!clash) {
            await get().refresh();
            return;
          }
          set({ scanRefusal: { at: Date.now(), message: refusalText(bucketId, clash) } });
          await get().refresh();
        })
        .catch(async () => {
          // No answer: keep the scan, marked not synced; the sync flags it later.
          await db.setFlagSync(rowIds, 2).catch(() => {});
          await get().refresh();
        })
        .finally(() => {
          for (const r of rowIds) flagInFlight.delete(r);
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
      // Only the rows the server took (pliIds name pick rows; an older server refuses by bucket).
      await db.markLoadedByPli(splitFlagResult(pliIds.map((p) => ({ pliId: p, bucketId: '' })), res).accepted);
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
      await db.markInTransitByPli(splitFlagResult(pliIds.map((p) => ({ pliId: p, bucketId: '' })), res).accepted);
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
    const sel = get().selectedTripId;
    // Each sent pick row with its bucket: refusals name buckets on an older server.
    const want = new Set(pliIds);
    const sent: SentRow[] = [];
    for (const o of opls) {
      for (const b of o.buckets) if (b.pliId && want.has(b.pliId)) sent.push({ pliId: b.pliId, bucketId: b.bucketId });
    }
    for (const p of pliIds) if (!sent.some((r) => r.pliId === p)) sent.push({ pliId: p, bucketId: '' });
    try {
      // One action: stamp the truck onto the rows, then send them on their way.
      const trip = sel ?? undefined;
      const loaded = await karenBucketRequestsRepository.setOfflineTrolleyFlags({ pliIds, flag: 'loaded', truck, trip });
      if (loaded.kind !== 'ok') return { ok: false, message: loaded.message };
      // Refused buckets (already on another truck, the truck already left, at the
      // packhouse) stay where they are: only the rows the server took go on.
      const refused = loaded.conflicts.map(conflictText);
      const onTruck = splitFlagResult(sent, loaded).accepted;
      if (!onTruck.length) {
        await get().refresh();
        return { ok: false, message: `Nothing loaded to ${truck}${refused.length ? `: ${refused.join('; ')}` : ''}.` };
      }
      // Loading it may dispatch the trip (last stop loaded) mid-way: no notice for that.
      if (sel) loadedTrips.add(sel);
      await db.markLoadedByPli(onTruck);
      const transit = await karenBucketRequestsRepository.setOfflineTrolleyFlags({
        pliIds: onTruck,
        flag: 'transit',
        truck,
        trip,
      });
      if (transit.kind !== 'ok') {
        await get().refresh();
        return { ok: false, message: `Loaded to ${truck}, but not marked in transit: ${transit.message}` };
      }
      const moving = splitFlagResult(
        sent.filter((r) => onTruck.includes(r.pliId)),
        transit,
      ).accepted;
      refused.push(...transit.conflicts.map(conflictText));
      // On the truck = in transit for the farm: the order moves to the In Transit tab
      // now, not only once the trip is dispatched.
      await db.markInTransitByPli(moving);
      if (!moving.length) {
        loadedTrips.delete(sel ?? '');
        await get().refresh();
        return { ok: false, message: `Loaded to ${truck}, but not marked in transit: ${refused.join('; ')}.` };
      }
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

  closeStop: async (tripId, farm, reason, complete) => {
    await get().refreshOnline();
    if (!get().online) return { ok: false, message: 'Connect to the internet to close the stop.' };
    try {
      const res = await karenBucketRequestsRepository.closeTripStop({ tripId, farm, reason, complete });
      if (res.kind === 'below_minimum') return { ok: false, message: res.message, belowMinimum: res.belowMinimum };
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
    // The list on screen stays as it is while it re-pulls: loading only shows an empty one.
    if (!get().shelvedTrips.length) set({ loadingShelved: true });
    try {
      const res = await karenBucketRequestsRepository.fetchShelvedBuckets(farm, date || undefined);
      // A slow answer for a date the operator has since moved off is dropped.
      if (get().deliveryDate !== date) return { ok: true };
      if (res.kind !== 'ok') {
        set({ loadingShelved: false });
        return { ok: false, message: res.message };
      }
      patch({ loadingShelved: false, shelvedTrips: res.trips, shelvedHub: res.hub });
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
      if (!same(get().arrivals[tripId], res.arrival)) set({ arrivals: { ...get().arrivals, [tripId]: res.arrival } });
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
    patch({ loadingCompleted: true });
    try {
      const res = await karenBucketRequestsRepository.fetchCompletedTrips(farm);
      patch({ loadingCompleted: false, ...(res.kind === 'ok' ? { completedTrips: res.trips } : {}) });
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
  };
});

export type { OrderGroup, TrolleyOpl };
export type {
  BelowMinimum,
  PlannedTrip,
  PlannedTripStop,
  ReplacementCandidate,
} from '../repository/karen-bucket-requests-repository';
