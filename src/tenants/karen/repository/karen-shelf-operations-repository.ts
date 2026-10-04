import {
  karenShelfOperationsApi,
  type RawTransferPayload,
  type RawTransferResponse,
  type IssueOfflineReason,
  type RawOfflineBucket,
  type RawOfflineOpl,
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

export type OfflineOpl = {
  oplName: string;
  orderName: string;
  customer: string | null;
  /** Packing team stamped on the OPL at allocation. */
  team: string | null;
  deliveryDate: string | null;
  issuedPct: number;
  openBuckets: number;
  /** Varieties on the OPL, shown in the list before it is opened. */
  varieties: string[];
};

export type OfflineBucket = {
  bucket: string;
  variety: string | null;
  stemLength: string | null;
  stems: number;
  shelf: string | null;
  onShelf: boolean;
  /** A remote-transfer bucket on a trolley or truck, not arrived yet. */
  inTransit: boolean;
};

export type ReplacementCandidate = {
  bucket: string;
  variety: string | null;
  shelf: string | null;
  stemLength: string | null;
  stems: number | null;
};

/** An earlier time this bucket went through offline issuing (not found or
 *  wrong variety). */
export type OfflineHistory = {
  reason: 'not_found' | 'wrong_variety';
  status: string | null;
  newBucket: string | null;
  oplName: string | null;
  orderName: string | null;
  reportedBy: string | null;
  reportedAt: string | null;
};

export type SubstituteOptions = {
  candidates: ReplacementCandidate[];
  /** Why there are none, when there are none. */
  message: string | null;
  history: OfflineHistory[];
};

export type IssueOfflineOutcome =
  | {
      kind: 'success';
      issuedBucket: string;
      replacement: string | null;
      /** The wrong-variety correction, when one was asked for. */
      correction: { ok: boolean; message: string } | null;
      message: string;
    }
  | {
      kind: 'failure';
      message: string;
      /** Buckets that could have gone out instead, when the scan could not. */
      candidates: ReplacementCandidate[];
    };

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

  /** A remote `farm` gets only the OPLs with its buckets; the sales farm gets all. */
  async fetchOfflineIssueOpls(deliveryDate?: string, farm?: string): Promise<OfflineOpl[]> {
    const rows: RawOfflineOpl[] = await karenShelfOperationsApi.fetchOfflineIssueOpls(deliveryDate, farm);
    return rows.map((r) => ({
      oplName: r.opl_name,
      orderName: r.order_name || r.opl_name,
      customer: r.customer ?? null,
      team: r.team || null,
      deliveryDate: r.delivery_date ?? null,
      issuedPct: typeof r.issued_pct === 'number' ? r.issued_pct : 0,
      openBuckets: typeof r.open_buckets === 'number' ? r.open_buckets : 0,
      varieties: Array.isArray(r.varieties) ? r.varieties : [],
    }));
  },

  async fetchOfflineIssueBuckets(oplName: string, farm?: string): Promise<OfflineBucket[]> {
    const rows: RawOfflineBucket[] = await karenShelfOperationsApi.fetchOfflineIssueBuckets(oplName, farm);
    return rows.map((r) => ({
      bucket: r.bucket,
      variety: r.variety ?? null,
      stemLength: r.stem_length ?? null,
      stems: typeof r.stems === 'number' ? r.stems : 0,
      shelf: r.shelf ?? null,
      onShelf: !!r.on_shelf,
      inTransit: !!r.in_transit,
    }));
  },

  async issueOffline(args: {
    oplName: string;
    allocatedBucket: string;
    scannedBucket: string;
    reason: IssueOfflineReason;
    variety?: string;
    stemLength?: string;
    farm?: string;
  }): Promise<IssueOfflineOutcome> {
    const raw = await karenShelfOperationsApi.issueOffline(args);
    if (raw.success) {
      return {
        kind: 'success',
        issuedBucket: raw.issued_bucket ?? args.scannedBucket,
        replacement: raw.replacement ?? null,
        correction: raw.correction
          ? { ok: !!raw.correction.ok, message: raw.correction.message ?? '' }
          : null,
        message: pickMessage(raw, 'Issued offline.'),
      };
    }
    return {
      kind: 'failure',
      message: pickMessage(raw, 'Issue failed.'),
      candidates: (raw.candidates ?? []).map((c) => ({
        bucket: c.new_bucket,
        variety: c.variety ?? null,
        shelf: c.shelf ?? null,
        stemLength: c.stem_length ?? null,
        stems: typeof c.available_qty === 'number' ? c.available_qty : null,
      })),
    };
  },

  async fetchSubstitutes(oplName: string, bucket: string, farm?: string): Promise<SubstituteOptions> {
    const raw = await karenShelfOperationsApi.fetchReplacementOptions(oplName, bucket, farm);
    return {
      candidates: (raw.candidates ?? []).map((c) => ({
        bucket: c.new_bucket,
        variety: c.variety ?? null,
        shelf: c.shelf ?? null,
        stemLength: c.stem_length ?? null,
        stems: typeof c.available_qty === 'number' ? c.available_qty : null,
      })),
      message: raw.found === false ? raw.message ?? null : null,
      history: (raw.history ?? []).map((h) => ({
        reason: h.reason,
        status: h.status ?? null,
        newBucket: h.new_bucket ?? null,
        oplName: h.opl_name ?? null,
        orderName: h.order_name ?? null,
        reportedBy: h.reported_by ?? null,
        reportedAt: h.reported_at ?? null,
      })),
    };
  },

  async fetchVarieties(): Promise<string[]> {
    return karenShelfOperationsApi.fetchVarieties();
  },

  async fetchStemLengths(): Promise<string[]> {
    return karenShelfOperationsApi.fetchStemLengths();
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
