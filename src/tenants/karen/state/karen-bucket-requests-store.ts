import { create } from 'zustand';
import * as Network from 'expo-network';
import { isNoResponseError } from '@/src/core/api/client';
import { storage, StorageKeys } from '@/src/core/storage';
import {
  karenBucketRequestsRepository,
  type OplSchedule,
  type PlannedTrip,
  type ReplacementCandidate,
  type ReplaceReason,
} from '../repository/karen-bucket-requests-repository';
import * as db from '../offline/bucket-requests-db';
import type { OrderGroup, TrolleyOpl, ScanResult, Vehicle } from '../offline/bucket-requests-db';

type State = {
  ready: boolean;
  error: string | null;
  requests: OrderGroup[];
  trolley: TrolleyOpl[];
  inTransit: TrolleyOpl[];
  vehicles: Vehicle[];
  plannedTrips: PlannedTrip[];
  /** Packhouse Schedule slot per OPL, for orders scheduled but not yet on a trip. */
  schedules: OplSchedule[];
  reqCount: number;
  trolleyCount: number;
  inTransitCount: number;
  tripsCount: number;
  activeTrolleyId: string | null;
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
  loadToTruck: (oplName: string, pliIds: string[], truck: string) => Promise<{ ok: boolean; message: string }>;
  markInTransit: (oplName: string, pliIds: string[]) => Promise<{ ok: boolean; message: string }>;
  /** Load fully-scanned OPLs onto `truck` and mark them in transit, in one action. */
  loadAllToTruck: (opls: TrolleyOpl[], truck: string) => Promise<{ ok: boolean; message: string }>;
  findReplacement: (
    pliId: string,
  ) => Promise<
    | { ok: true; neededQty: number | null; candidates: ReplacementCandidate[] }
    | { ok: false; message: string }
  >;
  /** `pending`: no reply came back, so the swap may still land server-side. */
  replaceBucket: (
    rowId: number,
    pliId: string,
    newBucket: string,
    reason?: ReplaceReason,
    notes?: string,
  ) => Promise<{ ok: boolean; message: string; pending?: boolean }>;
  clearAll: () => Promise<void>;
};

// One background sync at a time (the poll timer and app-foreground can overlap).
let syncing = false;

export const useKarenBucketRequestsStore = create<State>((set, get) => ({
  ready: false,
  error: null,
  requests: [],
  trolley: [],
  inTransit: [],
  vehicles: [],
  plannedTrips: [],
  schedules: [],
  reqCount: 0,
  trolleyCount: 0,
  inTransitCount: 0,
  tripsCount: 0,
  activeTrolleyId: null,
  online: false,
  downloading: false,
  loadingTrips: false,
  syncingOpl: null,
  manualDownloaded: false,
  deliveryDate: db.isoDay(1),
  deliveryDates: [],

  init: async () => {
    try {
      await db.initDb();
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
    set({ deliveryDate: date });
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
    const [requests, trolley, inTransit, vehicles, allTrips, schedules, c, deliveryDates] = await Promise.all([
      db.listRequests(),
      db.listTrolley(),
      db.listInTransit(),
      db.listVehicles(),
      db.listPlannedTrips(),
      db.listSchedules(),
      db.counts(),
      db.listDeliveryDates(),
    ]);
    // Trips follow the delivery-date filter too: keep the ones carrying an order for it.
    const dd = get().deliveryDate;
    const plannedTrips = dd
      ? allTrips
          .map((t) => ({ ...t, orders: (t.orders ?? []).filter((o) => !o.deliveryDate || o.deliveryDate === dd) }))
          .filter((t) => t.orders.length > 0)
      : allTrips;
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
      schedules,
      trolley,
      inTransit,
      vehicles,
      plannedTrips,
      reqCount: c.requests,
      trolleyCount: c.trolley,
      inTransitCount: c.inTransit,
      tripsCount: plannedTrips.length,
    });
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
      const outcome = await karenBucketRequestsRepository.fetchAllocations(farm);
      if (outcome.kind === 'error') {
        set({ downloading: false });
        return { ok: false, message: outcome.message };
      }
      const res = await db.downloadOpls(outcome.items, farm);
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
          await db.applyServerStates(trips.oplStates);
        }
      } catch {
        /* keep the cached plan */
      }
      await get().refresh();
      // Only a download that actually brought picklists in offers clearing; a
      // run that fetched 0 leaves the flag as it was.
      if (res.inserted > 0) {
        await storage.set(StorageKeys.bucketRequestsDownloaded, '1').catch(() => {});
        set({ downloading: false, manualDownloaded: true });
      } else {
        set({ downloading: false });
      }
      const skip = res.skipped ? ` (${res.skipped} already on device)` : '';
      return {
        ok: true,
        message: `Downloaded ${res.inserted} picklist${res.inserted === 1 ? '' : 's'}${skip}.`,
      };
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
      const alloc = await karenBucketRequestsRepository.fetchAllocations(farm);
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
        await db.applyServerStates(trips.oplStates);
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
    db.upsertTrolley(id).catch(() => {});
    return { ok: true, trolleyId: id };
  },

  clearActiveTrolley: () => set({ activeTrolleyId: null }),

  scanBucketFromScan: async (raw) => {
    const id = karenBucketRequestsRepository.extractBucketIdFromScan(raw);
    if (!id) return { ok: false, message: 'Not a bucket QR code.' };
    const trolley = get().activeTrolleyId;
    if (!trolley) return { ok: false, message: 'Scan a trolley first.' };
    const res: ScanResult = await db.scanBucket(id, trolley);
    await get().refresh();
    if (!res.ok) return { ok: false, message: res.message };
    return {
      ok: true,
      message: `${res.bucketId} → ${trolley}` + (res.oplComplete ? ' · order complete' : ''),
    };
  },

  loadToTruck: async (oplName, pliIds, truck) => {
    await get().refreshOnline();
    if (!get().online) return { ok: false, message: 'Connect to the internet to load to truck.' };
    set({ syncingOpl: oplName });
    try {
      const res = await karenBucketRequestsRepository.setOfflineTrolleyFlags({ pliIds, flag: 'loaded', truck });
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
      const res = await karenBucketRequestsRepository.setOfflineTrolleyFlags({ pliIds, flag: 'transit' });
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
    const pliIds = opls.flatMap((o) => o.pliIds);
    if (!pliIds.length) return { ok: false, message: 'Nothing to load.' };
    set({ syncingOpl: opls.length === 1 ? opls[0].oplName : '*' });
    try {
      // One action: stamp the truck onto the rows, then send them on their way.
      const loaded = await karenBucketRequestsRepository.setOfflineTrolleyFlags({ pliIds, flag: 'loaded', truck });
      if (loaded.kind !== 'ok') return { ok: false, message: loaded.message };
      for (const o of opls) await db.markLoadedLocal(o.oplName);
      const transit = await karenBucketRequestsRepository.setOfflineTrolleyFlags({ pliIds, flag: 'transit' });
      if (transit.kind !== 'ok') {
        await get().refresh();
        return { ok: false, message: `Loaded to ${truck}, but not marked in transit: ${transit.message}` };
      }
      // On the truck, not gone: the order moves to In Transit once the trip is
      // dispatched from the dashboard (the server state says "transit" then).
      await get().refresh();
      const what = opls.length === 1 ? opls[0].orderName : `${opls.length} orders`;
      return { ok: true, message: `${what} loaded to ${truck} — waiting for dispatch.` };
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
      if (res.kind !== 'ok') return { ok: false, message: res.message };
      return { ok: true, neededQty: res.neededQty, candidates: res.candidates };
    } catch (e) {
      if (isNoResponseError(e)) return { ok: false, message: 'No reply from the server. Try again.' };
      return { ok: false, message: (e as Error)?.message || 'Failed to find a replacement.' };
    }
  },

  replaceBucket: async (rowId, pliId, newBucket, reason, notes) => {
    await get().refreshOnline();
    if (!get().online) return { ok: false, message: 'Connect to the internet to replace a bucket.' };
    try {
      const res = await karenBucketRequestsRepository.replaceBucket(pliId, newBucket, reason, notes);
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

  clearAll: async () => {
    await db.clearAll();
    await storage.remove(StorageKeys.bucketRequestsDownloaded).catch(() => {});
    set({ activeTrolleyId: null, manualDownloaded: false });
    await get().refresh();
  },
}));

export type { OrderGroup, TrolleyOpl };
export type {
  PlannedTrip,
  PlannedTripStop,
  ReplacementCandidate,
} from '../repository/karen-bucket-requests-repository';
