import {
  karenShelfOperationsApi,
  type RawTransferPayload,
  type RawTransferResponse,
  type RawOfflineIssuingPayload,
  type RawOfflineIssuingResponse,
  type RawStockTakeSyncResponse,
} from '../api/karen-shelf-operations-api';
import type { StockTakeSyncResult } from '../offline/karen-stock-take-db';

export type TransferSuccess = {
  kind: 'success';
  bucketId: string;
  fromShelfId: string;
  toShelfId: string;
  stems: number | null;
  syncedOpls: string[];
  message: string;
};

export type TransferFailure = {
  kind: 'failure';
  bucketId: string;
  reason: string;
  message: string;
  payload: RawTransferPayload | null;
};

export type TransferError = { kind: 'error'; message: string };

export type TransferOutcome = TransferSuccess | TransferFailure | TransferError;

export type OfflineIssuingSuccess = {
  kind: 'success';
  bucketId: string;
  stems: number | null;
  stockEntry: string | null;
  message: string;
};

export type OfflineIssuingFailure = {
  kind: 'failure';
  bucketId: string;
  reason: string;
  message: string;
  payload: RawOfflineIssuingPayload | null;
};

export type OfflineIssuingError = { kind: 'error'; message: string };

export type OfflineIssuingOutcome = OfflineIssuingSuccess | OfflineIssuingFailure | OfflineIssuingError;

export type StockTakeSyncSuccess = {
  kind: 'success';
  stockTake: string;
  results: StockTakeSyncResult[];
  message: string;
};

export type StockTakeSyncFailure = { kind: 'failure'; reason: string; message: string };

export type StockTakeSyncError = { kind: 'error'; message: string };

export type StockTakeSyncOutcome = StockTakeSyncSuccess | StockTakeSyncFailure | StockTakeSyncError;

function pickMessage(raw: { message?: string }, fallback: string): string {
  return raw.message?.trim() || fallback;
}

export const karenShelfOperationsRepository = {
  /** Shelf QR is `{"shelf": "<id>"}` -- same shape shelving already uses. */
  extractShelfIdFromScan(raw: string): string | null {
    const text = raw.trim();
    if (!text.startsWith('{') || !text.endsWith('}')) return null;
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === 'object') {
        const shelf = (parsed as Record<string, unknown>)['shelf'];
        return typeof shelf === 'string' && shelf ? shelf : null;
      }
      return null;
    } catch {
      return null;
    }
  },

  /** Bucket QR is `{"<bucket_id>": "bucket"}`. */
  extractBucketIdFromScan(raw: string): string | null {
    const text = raw.trim();
    if (!text.startsWith('{') || !text.endsWith('}')) return null;
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === 'object') {
        const entry = Object.entries(parsed as Record<string, unknown>).find(
          ([, v]) => v === 'bucket',
        );
        return entry ? entry[0] : null;
      }
      return null;
    } catch {
      return null;
    }
  },

  async transfer(args: { bucketId: string; toShelfId: string }): Promise<TransferOutcome> {
    const raw: RawTransferResponse = await karenShelfOperationsApi.transferBucket(args);
    if (raw.status === 'success') {
      return {
        kind: 'success',
        bucketId: raw.payload?.bucket_id ?? args.bucketId,
        fromShelfId: raw.payload?.from_shelf_id ?? '',
        toShelfId: raw.payload?.to_shelf_id ?? args.toShelfId,
        stems: typeof raw.payload?.stems === 'number' ? raw.payload.stems : null,
        syncedOpls: raw.payload?.synced_opls ?? [],
        message: pickMessage(raw, 'Bucket transferred.'),
      };
    }
    if (raw.status === 'failed') {
      return {
        kind: 'failure',
        bucketId: raw.payload?.bucket_id ?? args.bucketId,
        reason: raw.reason ?? 'unknown',
        message: pickMessage(raw, 'Transfer failed.'),
        payload: raw.payload ?? null,
      };
    }
    return { kind: 'error', message: pickMessage(raw, 'Transfer failed.') };
  },

  async reportOfflineRemoval(args: {
    bucketId: string;
    reason: string;
  }): Promise<OfflineIssuingOutcome> {
    const raw: RawOfflineIssuingResponse = await karenShelfOperationsApi.reportOfflineRemoval(args);
    if (raw.status === 'success') {
      return {
        kind: 'success',
        bucketId: raw.payload?.bucket_id ?? args.bucketId,
        stems: typeof raw.payload?.stems === 'number' ? raw.payload.stems : null,
        stockEntry: raw.payload?.stock_entry ?? null,
        message: pickMessage(raw, 'Removal reported.'),
      };
    }
    if (raw.status === 'failed') {
      return {
        kind: 'failure',
        bucketId: raw.payload?.bucket_id ?? args.bucketId,
        reason: raw.reason ?? 'unknown',
        message: pickMessage(raw, 'Report failed.'),
        payload: raw.payload ?? null,
      };
    }
    return { kind: 'error', message: pickMessage(raw, 'Report failed.') };
  },

  async syncStockTakeBuckets(args: {
    coldstore: string;
    farm: string;
    stockTakeDate: string;
    buckets: { bucketId: string; scannedAt: string }[];
  }): Promise<StockTakeSyncOutcome> {
    const raw: RawStockTakeSyncResponse = await karenShelfOperationsApi.syncStockTakeBuckets(args);
    if (raw.status === 'success' && raw.payload) {
      const results: StockTakeSyncResult[] = (raw.payload.results ?? []).map((r) => {
        if (r.status === 'success' && r.payload) {
          return {
            bucketId: r.bucket_id ?? '',
            ok: true,
            status: r.payload.status === 'Shelved' ? 'Shelved' : 'Unshelved',
            shelf: r.payload.shelf ?? null,
            variety: r.payload.variety ?? null,
            stemLength: r.payload.stem_length ?? null,
            ageDays: typeof r.payload.age_days === 'number' ? r.payload.age_days : null,
          };
        }
        return { bucketId: r.bucket_id ?? '', ok: false, message: pickMessage(r, 'Could not resolve this bucket.') };
      });
      return {
        kind: 'success',
        stockTake: raw.payload.stock_take ?? '',
        results,
        message: pickMessage(raw, 'Synced.'),
      };
    }
    if (raw.status === 'failed') {
      return { kind: 'failure', reason: raw.reason ?? 'unknown', message: pickMessage(raw, 'Sync failed.') };
    }
    return { kind: 'error', message: pickMessage(raw, 'Sync failed.') };
  },

  async fetchColdStores(farm?: string): Promise<string[]> {
    const res = await karenShelfOperationsApi.fetchColdStores(farm);
    return (res.message ?? []).map((c) => c.name).filter(Boolean);
  },
};
