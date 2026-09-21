import {
  karenShelfOperationsApi,
  type RawTransferPayload,
  type RawTransferResponse,
  type RawOfflineIssuingPayload,
  type RawOfflineIssuingResponse,
} from '../api/karen-shelf-operations-api';

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
};
