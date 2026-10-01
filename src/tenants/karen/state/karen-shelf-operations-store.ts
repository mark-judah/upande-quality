import { create } from 'zustand';
import {
  karenShelfOperationsRepository,
  type TransferOutcome,
  type OfflineIssuingOutcome,
} from '../repository/karen-shelf-operations-repository';
import { mapAxiosError } from '@/src/core/api/client';
import * as stockTakeDb from '../offline/karen-stock-take-db';
import type { StockTakeScanRow } from '../offline/karen-stock-take-db';

export type ShelfOperationsMode = 'transfer' | 'offline-removal' | 'stock-take';

/** How many locally-queued scans go up in one sync request. Keeps each
 * request's doc.save() fast and bounded regardless of how many thousand
 * buckets the whole session ends up with - a session syncs in several of
 * these rather than one giant request. */
const STOCK_TAKE_SYNC_CHUNK_SIZE = 200;

type State = {
  mode: ShelfOperationsMode;
  /** Destination shelf for Transfer mode. Not used in Offline Removal mode. */
  shelfId: string | null;
  /** Free-text reason for Offline Removal mode. */
  reason: string;
  loading: boolean;
  lastTransferOutcome: TransferOutcome | null;
  lastOfflineOutcome: OfflineIssuingOutcome | null;

  // Stock Take mode - scanning is local-only (karen-stock-take-db.ts,
  // expo-sqlite - no new library), so it's instant regardless of
  // connectivity; syncStockTake is the one thing that talks to the server.
  coldStores: string[];
  coldStoresLoading: boolean;
  coldstore: string | null;
  stockTakeScans: StockTakeScanRow[];
  stockTakePending: number;
  stockTakeSyncing: boolean;
  stockTakeSyncProgress: { done: number; total: number } | null;
  stockTakeSyncError: string | null;

  setMode: (mode: ShelfOperationsMode) => void;
  setShelfFromScan: (raw: string) => { ok: boolean; message?: string; shelfId?: string };
  clearShelf: () => void;
  setReason: (reason: string) => void;
  submitTransfer: (rawBucket: string) => Promise<TransferOutcome>;
  submitOfflineRemoval: (rawBucket: string) => Promise<OfflineIssuingOutcome>;
  initStockTake: () => Promise<void>;
  loadColdStores: (farm?: string) => Promise<void>;
  setColdstore: (coldstore: string) => Promise<void>;
  scanStockTakeBucket: (rawBucket: string) => Promise<{ ok: boolean; message?: string }>;
  refreshStockTakeScans: () => Promise<void>;
  syncStockTake: (farm: string) => Promise<void>;
  reset: () => void;
};

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

export const useKarenShelfOperationsStore = create<State>((set, get) => ({
  mode: 'transfer',
  shelfId: null,
  reason: '',
  loading: false,
  lastTransferOutcome: null,
  lastOfflineOutcome: null,

  coldStores: [],
  coldStoresLoading: false,
  coldstore: null,
  stockTakeScans: [],
  stockTakePending: 0,
  stockTakeSyncing: false,
  stockTakeSyncProgress: null,
  stockTakeSyncError: null,

  setMode: (mode) =>
    set({
      mode,
      shelfId: null,
      reason: '',
      lastTransferOutcome: null,
      lastOfflineOutcome: null,
      coldstore: null,
      stockTakeScans: [],
      stockTakePending: 0,
      stockTakeSyncProgress: null,
      stockTakeSyncError: null,
    }),

  setShelfFromScan: (raw) => {
    const shelfId = karenShelfOperationsRepository.extractShelfIdFromScan(raw);
    if (!shelfId) {
      return { ok: false, message: 'Please scan a valid shelf QR code.' };
    }
    set({ shelfId, lastTransferOutcome: null });
    return { ok: true, shelfId };
  },

  clearShelf: () => set({ shelfId: null, lastTransferOutcome: null }),

  setReason: (reason) => set({ reason }),

  submitTransfer: async (rawBucket) => {
    const state = get();
    if (!state.shelfId) {
      const out: TransferOutcome = { kind: 'error', message: 'Scan the destination shelf first.' };
      set({ lastTransferOutcome: out });
      return out;
    }
    const bucketId = karenShelfOperationsRepository.extractBucketIdFromScan(rawBucket);
    if (!bucketId) {
      const out: TransferOutcome = { kind: 'error', message: 'Please scan a valid bucket QR code.' };
      set({ lastTransferOutcome: out });
      return out;
    }
    set({ loading: true });
    try {
      const outcome = await karenShelfOperationsRepository.transfer({
        bucketId,
        toShelfId: state.shelfId,
      });
      set({ loading: false, lastTransferOutcome: outcome });
      return outcome;
    } catch (err) {
      const out: TransferOutcome = { kind: 'error', message: mapAxiosError(err).message };
      set({ loading: false, lastTransferOutcome: out });
      return out;
    }
  },

  submitOfflineRemoval: async (rawBucket) => {
    const state = get();
    if (!state.reason.trim()) {
      const out: OfflineIssuingOutcome = { kind: 'error', message: 'Enter a reason first.' };
      set({ lastOfflineOutcome: out });
      return out;
    }
    const bucketId = karenShelfOperationsRepository.extractBucketIdFromScan(rawBucket);
    if (!bucketId) {
      const out: OfflineIssuingOutcome = { kind: 'error', message: 'Please scan a valid bucket QR code.' };
      set({ lastOfflineOutcome: out });
      return out;
    }
    set({ loading: true });
    try {
      const outcome = await karenShelfOperationsRepository.reportOfflineRemoval({
        bucketId,
        reason: state.reason.trim(),
      });
      set({ loading: false, lastOfflineOutcome: outcome });
      return outcome;
    } catch (err) {
      const out: OfflineIssuingOutcome = { kind: 'error', message: mapAxiosError(err).message };
      set({ loading: false, lastOfflineOutcome: out });
      return out;
    }
  },

  initStockTake: async () => {
    try {
      await stockTakeDb.initStockTakeDb();
    } catch {
      // The screen still works for scanning once a cold store is picked;
      // a failed open here just means this app run never got that far.
    }
  },

  loadColdStores: async (farm) => {
    set({ coldStoresLoading: true });
    try {
      const coldStores = await karenShelfOperationsRepository.fetchColdStores(farm);
      set({ coldStores, coldStoresLoading: false });
    } catch {
      set({ coldStoresLoading: false });
    }
  },

  setColdstore: async (coldstore) => {
    set({
      coldstore,
      stockTakeScans: [],
      stockTakePending: 0,
      stockTakeSyncProgress: null,
      stockTakeSyncError: null,
    });
    await get().refreshStockTakeScans();
  },

  // Local only - no network, so this is instant no matter how many buckets
  // have already been scanned this session or whether there's connectivity
  // at all. A bucket already in today's list for this cold store is left
  // untouched and reported back as a duplicate, so the screen can alert
  // instead of silently re-scanning it (see karen-stock-take-db.ts).
  scanStockTakeBucket: async (rawBucket) => {
    const state = get();
    if (!state.coldstore) {
      return { ok: false, message: 'Pick a cold store first.' };
    }
    const bucketId = karenShelfOperationsRepository.extractBucketIdFromScan(rawBucket);
    if (!bucketId) {
      return { ok: false, message: 'Please scan a valid bucket QR code.' };
    }
    const { alreadyScanned } = await stockTakeDb.scanBucket(state.coldstore, bucketId);
    if (alreadyScanned) {
      return { ok: false, message: `${bucketId} has already been scanned.` };
    }
    await get().refreshStockTakeScans();
    return { ok: true };
  },

  refreshStockTakeScans: async () => {
    const { coldstore } = get();
    if (!coldstore) return;
    const [stockTakeScans, stockTakePending] = await Promise.all([
      stockTakeDb.listScans(coldstore),
      stockTakeDb.countPending(coldstore),
    ]);
    set({ stockTakeScans, stockTakePending });
  },

  // Uploads every not-yet-synced scan in chunks, one request at a time -
  // each chunk is resolved and saved server-side in one bulk round trip
  // (see syncStockTakeBuckets), never one request per bucket. A failed
  // chunk (network error, or the server rejecting the batch outright)
  // stops the loop and leaves every remaining scan exactly as pending as
  // it was - calling this again (Retry) simply picks up from there, since
  // getPendingBatch only ever returns what's still unsynced.
  syncStockTake: async (farm) => {
    const { coldstore } = get();
    if (!coldstore) return;
    const total = await stockTakeDb.countPending(coldstore);
    if (total === 0) return;
    set({ stockTakeSyncing: true, stockTakeSyncError: null, stockTakeSyncProgress: { done: 0, total } });
    const stockTakeDate = todayStr();
    let done = 0;
    try {
      while (true) {
        const batch = await stockTakeDb.getPendingBatch(coldstore, STOCK_TAKE_SYNC_CHUNK_SIZE);
        if (!batch.length) break;
        const outcome = await karenShelfOperationsRepository.syncStockTakeBuckets({
          coldstore,
          farm,
          stockTakeDate,
          buckets: batch,
        });
        if (outcome.kind !== 'success') {
          set({ stockTakeSyncing: false, stockTakeSyncError: outcome.message });
          await get().refreshStockTakeScans();
          return;
        }
        await stockTakeDb.applySyncResults(coldstore, outcome.results);
        done += batch.length;
        set({ stockTakeSyncProgress: { done, total } });
        await get().refreshStockTakeScans();
      }
      set({ stockTakeSyncing: false, stockTakeSyncProgress: null });
    } catch (err) {
      set({ stockTakeSyncing: false, stockTakeSyncError: mapAxiosError(err).message });
      await get().refreshStockTakeScans();
    }
  },

  reset: () =>
    set({
      mode: 'transfer',
      shelfId: null,
      reason: '',
      loading: false,
      lastTransferOutcome: null,
      lastOfflineOutcome: null,
      coldstore: null,
      stockTakeScans: [],
      stockTakePending: 0,
      stockTakeSyncing: false,
      stockTakeSyncProgress: null,
      stockTakeSyncError: null,
    }),
}));
