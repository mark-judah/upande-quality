import { create } from 'zustand';
import * as Network from 'expo-network';
import { karenBucketRequestsRepository } from '../repository/karen-bucket-requests-repository';
import * as db from '../offline/bucket-requests-db';
import type { OrderGroup, TrolleyOpl, ScanResult } from '../offline/bucket-requests-db';

type State = {
  ready: boolean;
  error: string | null;
  requests: OrderGroup[];
  trolley: TrolleyOpl[];
  inTransit: TrolleyOpl[];
  reqCount: number;
  trolleyCount: number;
  inTransitCount: number;
  activeTrolleyId: string | null;
  online: boolean;
  downloading: boolean;
  syncingOpl: string | null;

  init: () => Promise<void>;
  refresh: () => Promise<void>;
  refreshOnline: () => Promise<void>;
  download: (farm: string) => Promise<{ ok: boolean; message: string }>;
  setTrolleyFromScan: (raw: string) => { ok: boolean; message?: string; trolleyId?: string };
  clearActiveTrolley: () => void;
  scanBucketFromScan: (raw: string) => Promise<{ ok: boolean; message: string }>;
  loadToTruck: (oplName: string, pliIds: string[]) => Promise<{ ok: boolean; message: string }>;
  markInTransit: (oplName: string, pliIds: string[]) => Promise<{ ok: boolean; message: string }>;
  clearAll: () => Promise<void>;
};

export const useKarenBucketRequestsStore = create<State>((set, get) => ({
  ready: false,
  error: null,
  requests: [],
  trolley: [],
  inTransit: [],
  reqCount: 0,
  trolleyCount: 0,
  inTransitCount: 0,
  activeTrolleyId: null,
  online: false,
  downloading: false,
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
    const [requests, trolley, inTransit, c] = await Promise.all([
      db.listRequests(),
      db.listTrolley(),
      db.listInTransit(),
      db.counts(),
    ]);
    set({
      requests,
      trolley,
      inTransit,
      reqCount: c.requests,
      trolleyCount: c.trolley,
      inTransitCount: c.inTransit,
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

  loadToTruck: async (oplName, pliIds) => {
    await get().refreshOnline();
    if (!get().online) return { ok: false, message: 'Connect to the internet to load to truck.' };
    set({ syncingOpl: oplName });
    try {
      const res = await karenBucketRequestsRepository.setOfflineTrolleyFlags({ pliIds, flag: 'loaded' });
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
