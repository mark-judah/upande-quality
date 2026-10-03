import { create } from 'zustand';
import {
  karenShelfOperationsRepository,
  type TransferOutcome,
  type IssueOfflineOutcome,
  type OfflineBucket,
  type OfflineOpl,
} from '../repository/karen-shelf-operations-repository';
import type { IssueOfflineReason } from '../api/karen-shelf-operations-api';
import { mapAxiosError } from '@/src/core/api/client';
import * as stockTakeDb from '../offline/karen-stock-take-db';
import type { StockTakeScanRow } from '../offline/karen-stock-take-db';

export type ShelfOperationsMode = 'transfer' | 'issue-offline' | 'stock-take';

/** How many locally-queued scans go up in one sync request. Keeps each
 * request's doc.save() fast and bounded regardless of how many thousand
 * buckets the whole session ends up with - a session syncs in several of
 * these rather than one giant request. */
const STOCK_TAKE_SYNC_CHUNK_SIZE = 200;

type State = {
  mode: ShelfOperationsMode;
  /** Destination shelf for Transfer mode. */
  shelfId: string | null;
  loading: boolean;
  lastTransferOutcome: TransferOutcome | null;

  // Issue Offline mode: pick the OPL, the allocated bucket that never reached
  // the issuing scan and why, then scan the bucket that went out instead.
  opls: OfflineOpl[];
  oplsLoading: boolean;
  /** Delivery date the OPL list is for (YYYY-MM-DD); opens on tomorrow. */
  oplDeliveryDate: string;
  /** Packing team the OPL list is narrowed to; '' = every team. */
  oplTeam: string;
  opl: string | null;
  offlineBuckets: OfflineBucket[];
  offlineBucketsLoading: boolean;
  allocatedBucket: string | null;
  reason: IssueOfflineReason | null;
  /** Wrong variety: the allocated bucket's real details, for its record. */
  correctVariety: string;
  correctStemLength: string;
  varieties: string[];
  /** Stem Length masters the real length is picked from. */
  stemLengths: string[];
  lastOfflineOutcome: IssueOfflineOutcome | null;

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
  submitTransfer: (rawBucket: string) => Promise<TransferOutcome>;
  loadOpls: () => Promise<void>;
  setOplDeliveryDate: (date: string) => Promise<void>;
  setOplTeam: (team: string) => void;
  selectOpl: (opl: string) => Promise<void>;
  selectAllocatedBucket: (bucket: string | null) => void;
  setReason: (reason: IssueOfflineReason) => void;
  setCorrectVariety: (variety: string) => void;
  setCorrectStemLength: (length: string) => void;
  submitIssueOffline: (rawBucket: string) => Promise<IssueOfflineOutcome>;
  initStockTake: () => Promise<void>;
  loadColdStores: (farm?: string) => Promise<void>;
  setColdstore: (coldstore: string) => Promise<void>;
  scanStockTakeBucket: (rawBucket: string) => Promise<{ ok: boolean; message?: string }>;
  refreshStockTakeScans: () => Promise<void>;
  syncStockTake: (farm: string) => Promise<void>;
  reset: () => void;
};

/** Local YYYY-MM-DD, `addDays` from today. */
export function localDay(addDays = 0): string {
  const dt = new Date();
  dt.setDate(dt.getDate() + addDays);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Everything Issue Offline keeps for one OPL; cleared on mode or OPL change. */
const ISSUE_OFFLINE_RESET = {
  opl: null,
  offlineBuckets: [],
  offlineBucketsLoading: false,
  allocatedBucket: null,
  reason: null,
  correctVariety: '',
  correctStemLength: '',
  lastOfflineOutcome: null,
} satisfies Partial<State>;

export const useKarenShelfOperationsStore = create<State>((set, get) => ({
  mode: 'transfer',
  shelfId: null,
  loading: false,
  lastTransferOutcome: null,
  ...ISSUE_OFFLINE_RESET,
  opls: [],
  oplsLoading: false,
  oplDeliveryDate: localDay(1),
  oplTeam: '',
  varieties: [],
  stemLengths: [],

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
      lastTransferOutcome: null,
      ...ISSUE_OFFLINE_RESET,
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

  loadOpls: async () => {
    const date = get().oplDeliveryDate;
    set({ oplsLoading: true });
    try {
      const opls = await karenShelfOperationsRepository.fetchOfflineIssueOpls(date);
      // A slow answer for a date the operator has since moved off is dropped.
      if (get().oplDeliveryDate !== date) return;
      // Keep the team filter only while that team still has OPLs on this date.
      const team = get().oplTeam;
      set({ opls, oplsLoading: false, oplTeam: opls.some((o) => o.team === team) ? team : '' });
    } catch {
      if (get().oplDeliveryDate === date) set({ oplsLoading: false });
    }
  },

  setOplDeliveryDate: async (oplDeliveryDate) => {
    // The picked OPL belongs to the old date's list: start over on the new one.
    set({ ...ISSUE_OFFLINE_RESET, oplDeliveryDate, opls: [] });
    await get().loadOpls();
  },

  setOplTeam: (oplTeam) => {
    const picked = get().opls.find((o) => o.oplName === get().opl);
    // An OPL of another team drops out of the list, so it can't stay picked.
    if (oplTeam && picked && picked.team !== oplTeam) set({ ...ISSUE_OFFLINE_RESET, oplTeam });
    else set({ oplTeam });
  },

  selectOpl: async (opl) => {
    set({ ...ISSUE_OFFLINE_RESET, opl, offlineBucketsLoading: true });
    try {
      const offlineBuckets = await karenShelfOperationsRepository.fetchOfflineIssueBuckets(opl);
      // A slow answer for an OPL the operator has since moved off is dropped.
      if (get().opl === opl) set({ offlineBuckets, offlineBucketsLoading: false });
    } catch {
      if (get().opl === opl) set({ offlineBucketsLoading: false });
    }
  },

  selectAllocatedBucket: (allocatedBucket) =>
    set({ allocatedBucket, correctVariety: '', correctStemLength: '', lastOfflineOutcome: null }),

  setReason: (reason) => {
    set({ reason, lastOfflineOutcome: null });
    if (reason === 'wrong_variety' && !get().varieties.length) {
      karenShelfOperationsRepository
        .fetchVarieties()
        .then((varieties) => set({ varieties }))
        .catch(() => {});
    }
    if (reason === 'wrong_variety' && !get().stemLengths.length) {
      karenShelfOperationsRepository
        .fetchStemLengths()
        .then((stemLengths) => set({ stemLengths }))
        .catch(() => {});
    }
  },

  setCorrectVariety: (correctVariety) => set({ correctVariety }),
  setCorrectStemLength: (correctStemLength) => set({ correctStemLength }),

  submitIssueOffline: async (rawBucket) => {
    const state = get();
    const fail = (message: string): IssueOfflineOutcome => {
      const out: IssueOfflineOutcome = { kind: 'failure', message, candidates: [] };
      set({ lastOfflineOutcome: out });
      return out;
    };
    if (!state.opl) return fail('Pick the OPL first.');
    if (!state.allocatedBucket) return fail('Pick the allocated bucket first.');
    if (!state.reason) return fail('Say why it was not issued: not found or wrong variety.');
    if (state.reason === 'wrong_variety' && !state.correctVariety && !state.correctStemLength.trim()) {
      return fail("Enter the allocated bucket's real variety or stem length.");
    }
    const scannedBucket = karenShelfOperationsRepository.extractBucketIdFromScan(rawBucket);
    if (!scannedBucket) return fail('Please scan a valid bucket QR code.');

    set({ loading: true });
    try {
      const outcome = await karenShelfOperationsRepository.issueOffline({
        oplName: state.opl,
        allocatedBucket: state.allocatedBucket,
        scannedBucket,
        reason: state.reason,
        variety: state.reason === 'wrong_variety' ? state.correctVariety : undefined,
        stemLength: state.reason === 'wrong_variety' ? state.correctStemLength.trim() : undefined,
      });
      set({ loading: false, lastOfflineOutcome: outcome });
      if (outcome.kind === 'success') {
        // The bucket is done: drop it from the list and refresh the OPL's progress.
        set({ allocatedBucket: null, reason: null, correctVariety: '', correctStemLength: '' });
        const opl = state.opl;
        karenShelfOperationsRepository
          .fetchOfflineIssueBuckets(opl)
          .then((offlineBuckets) => {
            if (get().opl === opl) set({ offlineBuckets });
          })
          .catch(() => {});
        get().loadOpls();
      }
      return outcome;
    } catch (err) {
      set({ loading: false });
      return fail(mapAxiosError(err).message);
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
      loading: false,
      lastTransferOutcome: null,
      ...ISSUE_OFFLINE_RESET,
      oplDeliveryDate: localDay(1),
      oplTeam: '',
      coldstore: null,
      stockTakeScans: [],
      stockTakePending: 0,
      stockTakeSyncing: false,
      stockTakeSyncProgress: null,
      stockTakeSyncError: null,
    }),
}));
