import { create } from 'zustand';
import * as Network from 'expo-network';
import { karenBucketRequestsRepository, type PlannedTrip } from '../repository/karen-bucket-requests-repository';
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
  reqCount: number;
  trolleyCount: number;
  inTransitCount: number;
  tripsCount: number;
  activeTrolleyId: string | null;
  online: boolean;
  downloading: boolean;
  loadingTrips: boolean;
  syncingOpl: string | null;

  init: () => Promise<void>;
  refresh: () => Promise<void>;
  refreshOnline: () => Promise<void>;
  download: (farm: string) => Promise<{ ok: boolean; message: string }>;
  /** Refresh only the planned-trips plan for a farm (online). */
  loadPlannedTrips: (farm: string) => Promise<{ ok: boolean; message?: string }>;
  setTrolleyFromScan: (raw: string) => { ok: boolean; message?: string; trolleyId?: string };
  clearActiveTrolley: () => void;
  scanBucketFromScan: (raw: string) => Promise<{ ok: boolean; message: string }>;
  loadToTruck: (oplName: string, pliIds: string[], truck: string) => Promise<{ ok: boolean; message: string }>;
  markInTransit: (oplName: string, pliIds: string[]) => Promise<{ ok: boolean; message: string }>;
  clearAll: () => Promise<void>;
};

export const useKarenBucketRequestsStore = create<State>((set, get) => ({
  ready: false,
  error: null,
  requests: [],
  trolley: [],
  inTransit: [],
  vehicles: [],
  plannedTrips: [],
  reqCount: 0,
  trolleyCount: 0,
  inTransitCount: 0,
  tripsCount: 0,
  activeTrolleyId: null,
  online: false,
  downloading: false,
  loadingTrips: false,
  syncingOpl: null,

  init: async () => {
    try {
      await db.initDb();
      set({ ready: true, error: null });
      await get().refresh();
      await get().refreshOnline();
    } catch (e) {
      set({ ready: false, error: (e as Error)?.message || 'Failed to open local database.' });
    }
  },

  refresh: async () => {
    const [requests, trolley, inTransit, vehicles, plannedTrips, c] = await Promise.all([
      db.listRequests(),
      db.listTrolley(),
      db.listInTransit(),
      db.listVehicles(),
      db.listPlannedTrips(),
      db.counts(),
    ]);
    set({
      requests,
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
        const trips = await karenBucketRequestsRepository.fetchPlannedTrips(farm);
        if (trips.kind === 'ok') await db.replacePlannedTrips(trips.trips);
      } catch {
        /* keep the cached plan */
      }
      await get().refresh();
      set({ downloading: false });
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
    await get().refreshOnline();
    if (!get().online) return { ok: false, message: 'Connect to the internet to refresh the trip plan.' };
    set({ loadingTrips: true });
    try {
      const trips = await karenBucketRequestsRepository.fetchPlannedTrips(farm);
      if (trips.kind !== 'ok') {
        set({ loadingTrips: false });
        return { ok: false, message: trips.message };
      }
      await db.replacePlannedTrips(trips.trips);
      await get().refresh();
      set({ loadingTrips: false });
      return { ok: true };
    } catch (e) {
      set({ loadingTrips: false });
      return { ok: false, message: (e as Error)?.message || 'Failed to load trips.' };
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

  clearAll: async () => {
    await db.clearAll();
    set({ activeTrolleyId: null });
    await get().refresh();
  },
}));

export type { OrderGroup, TrolleyOpl };
export type { PlannedTrip, PlannedTripStop } from '../repository/karen-bucket-requests-repository';
