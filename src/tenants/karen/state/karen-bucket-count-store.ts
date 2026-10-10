import { create } from 'zustand';
import { karenBucketCountRepository } from '../repository/karen-bucket-count-repository';
import { mapAxiosError } from '@/src/core/api/client';
import * as bucketCountDb from '../offline/karen-bucket-count-db';
import type { BucketCountScanRow } from '../offline/karen-bucket-count-db';

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

/** How many locally-queued scans go up in one sync request — same bound as
 *  stock take's STOCK_TAKE_SYNC_CHUNK_SIZE, same reasoning: keeps each
 *  request's doc.save() fast regardless of how many buckets the whole
 *  session ends up with. */
const BUCKET_COUNT_SYNC_CHUNK_SIZE = 200;

type State = {
  locations: string[];
  locationsLoading: boolean;
  location: string | null;
  scans: BucketCountScanRow[];
  pending: number;
  syncing: boolean;
  syncProgress: { done: number; total: number } | null;
  syncError: string | null;

  init: () => Promise<void>;
  loadLocations: () => Promise<void>;
  setLocation: (location: string) => void;
  scanBucket: (farm: string, rawBucket: string) => Promise<{ ok: boolean; message?: string }>;
  refreshScans: (farm: string) => Promise<void>;
  syncBucketCount: (farm: string) => Promise<void>;
  reset: () => void;
};

const initialState = {
  locations: [] as string[],
  locationsLoading: false,
  location: null as string | null,
  scans: [] as BucketCountScanRow[],
  pending: 0,
  syncing: false,
  syncProgress: null as { done: number; total: number } | null,
  syncError: null as string | null,
};

export const useKarenBucketCountStore = create<State>((set, get) => ({
  ...initialState,

  init: async () => {
    try {
      await bucketCountDb.initBucketCountDb();
    } catch {
      // The screen still works for scanning once a location is picked; a
      // failed open here just means this app run never got that far.
    }
  },

  loadLocations: async () => {
    set({ locationsLoading: true });
    try {
      const locations = await karenBucketCountRepository.fetchBucketCountLocations();
      set({ locations, locationsLoading: false });
    } catch {
      set({ locationsLoading: false });
    }
  },

  // Switching location mid-session does NOT clear scans/pending — unlike
  // stock take's setColdstore, this isn't switching to a different day's
  // document, just changing where the NEXT scan records. The farm+day's
  // Bucket Count document (and its running list) stays exactly as it is.
  setLocation: (location) => set({ location }),

  // Local only — no network, so this is instant regardless of connectivity.
  // Always succeeds: either a fresh scan, or (bucket already counted today)
  // its location moves — see karen-bucket-count-db.ts.
  scanBucket: async (farm, rawBucket) => {
    const { location } = get();
    if (!location) {
      return { ok: false, message: 'Pick a location first.' };
    }
    const bucketId = karenBucketCountRepository.extractBucketIdFromScan(rawBucket);
    if (!bucketId) {
      return { ok: false, message: 'Please scan a valid bucket QR code.' };
    }
    await bucketCountDb.scanBucket(farm, bucketId, location);
    await get().refreshScans(farm);
    return { ok: true };
  },

  refreshScans: async (farm) => {
    const [scans, pending] = await Promise.all([
      bucketCountDb.listScans(farm),
      bucketCountDb.countPending(farm),
    ]);
    set({ scans, pending });
  },

  // Uploads every not-yet-synced scan in chunks, one request at a time — same
  // shape as stock take's syncStockTake. A failed chunk stops the loop and
  // leaves every remaining scan exactly as pending as it was; calling this
  // again (Retry) picks up from there.
  syncBucketCount: async (farm) => {
    const total = await bucketCountDb.countPending(farm);
    if (total === 0) return;
    set({ syncing: true, syncError: null, syncProgress: { done: 0, total } });
    const countDate = todayStr();
    let done = 0;
    try {
      while (true) {
        const batch = await bucketCountDb.getPendingBatch(farm, BUCKET_COUNT_SYNC_CHUNK_SIZE);
        if (!batch.length) break;
        const outcome = await karenBucketCountRepository.syncBucketCountScans({
          farm,
          countDate,
          buckets: batch,
        });
        if (outcome.kind !== 'success') {
          set({ syncing: false, syncError: outcome.message });
          await get().refreshScans(farm);
          return;
        }
        await bucketCountDb.applySyncResults(farm, outcome.results);
        done += batch.length;
        set({ syncProgress: { done, total } });
        await get().refreshScans(farm);
      }
      set({ syncing: false, syncProgress: null });
    } catch (err) {
      set({ syncing: false, syncError: mapAxiosError(err).message });
      await get().refreshScans(farm);
    }
  },

  reset: () => set({ ...initialState }),
}));
