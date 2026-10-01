import { api } from '@/src/core/api/client';

export type StockTakeSyncReason =
  | 'coldstore_not_null'
  | 'farm_not_null'
  | 'buckets_not_null'
  | 'unknown_error';

export type RawStockTakeBucketResult = {
  bucket_id?: string;
  status?: 'success' | 'failed' | string;
  reason?: string;
  message?: string;
  payload?: {
    status?: 'Shelved' | 'Unshelved' | string;
    shelf?: string | null;
    variety?: string | null;
    stem_length?: string | null;
    age_days?: number | null;
  };
};

export type RawStockTakeSyncPayload = {
  stock_take?: string;
  results?: RawStockTakeBucketResult[];
};

export type RawStockTakeSyncResponse = {
  status?: 'success' | 'failed' | 'error' | string;
  reason?: StockTakeSyncReason | string;
  message?: string;
  payload?: RawStockTakeSyncPayload;
};

export type RawColdStore = { name: string };

export type TransferReason =
  | 'bucket_id_not_null'
  | 'to_shelf_id_not_null'
  | 'not_on_shelf'
  | 'same_shelf'
  | 'destination_not_found'
  | 'cross_farm_not_allowed'
  | 'mid_truck_transfer'
  | 'two_buckets_per_shelf'
  | 'unknown_error';

export type RawTransferPayload = {
  bucket_id?: string;
  from_shelf_id?: string;
  to_shelf_id?: string;
  shelf_id?: string;
  from_farm?: string;
  to_farm?: string;
  stems?: number;
  synced_opls?: string[];
  bas_updated?: string[];
};

export type RawTransferResponse = {
  status?: 'success' | 'failed' | 'error' | string;
  reason?: TransferReason | string;
  message?: string;
  payload?: RawTransferPayload;
};

export type OfflineIssuingReason =
  | 'bucket_id_not_null'
  | 'reason_not_null'
  | 'not_on_shelf'
  | 'bucket_allocated'
  | 'unknown_error';

export type RawOfflineIssuingPayload = {
  bucket_id?: string;
  stems?: number;
  stock_entry?: string;
  sales_orders?: string[];
};

export type RawOfflineIssuingResponse = {
  status?: 'success' | 'failed' | 'error' | string;
  reason?: OfflineIssuingReason | string;
  message?: string;
  payload?: RawOfflineIssuingPayload;
};

export const karenShelfOperationsApi = {
  /** POST /api/method/upande_quality.mobile.api.transferBucket */
  async transferBucket(args: { bucketId: string; toShelfId: string }): Promise<RawTransferResponse> {
    const res = await api<{ data?: RawTransferResponse } | RawTransferResponse>({
      method: 'POST',
      url: '/api/method/upande_quality.mobile.api.transferBucket',
      data: { bucket_id: args.bucketId, to_shelf_id: args.toShelfId },
      validateStatus: () => true,
    });
    const unwrapped = res as { data?: RawTransferResponse } & RawTransferResponse;
    return unwrapped.data ?? unwrapped;
  },

  /** POST /api/method/upande_quality.mobile.api.createOfflineIssuingEntry */
  async reportOfflineRemoval(args: {
    bucketId: string;
    reason: string;
  }): Promise<RawOfflineIssuingResponse> {
    const res = await api<{ data?: RawOfflineIssuingResponse } | RawOfflineIssuingResponse>({
      method: 'POST',
      url: '/api/method/upande_quality.mobile.api.createOfflineIssuingEntry',
      data: { bucket_id: args.bucketId, reason: args.reason },
      validateStatus: () => true,
    });
    const unwrapped = res as { data?: RawOfflineIssuingResponse } & RawOfflineIssuingResponse;
    return unwrapped.data ?? unwrapped;
  },

  /** Cold-store warehouses — same Warehouse-name-pattern lookup the Cold
   * Store Temperature screen uses (karen-coldroom-api.ts), inlined here
   * rather than cross-imported, matching that file's own stated convention
   * of duplicating this one small lookup instead of adding a cross-feature
   * dependency between otherwise-unrelated screens. */
  async fetchColdStores(farm?: string): Promise<{ message?: RawColdStore[] }> {
    const filters: unknown[] = [['name', 'like', '%Cold Store%']];
    if (farm) filters.push(['name', 'like', '%' + farm + '%']);
    return api({
      method: 'GET',
      url: '/api/method/frappe.client.get_list',
      params: {
        doctype: 'Warehouse',
        filters: JSON.stringify(filters),
        fields: JSON.stringify(['name']),
        order_by: 'name asc',
        limit_page_length: 100,
      },
      validateStatus: () => true,
    });
  },

  /** POST /api/method/upande_quality.mobile.api.syncStockTakeBuckets - one
   * call per chunk of locally-queued scans (see karen-stock-take-db.ts).
   * The server resolves and saves the whole chunk in one round trip
   * (bulk Shelf Item / Harvesting Stock Entry lookups, one doc.save()) -
   * never one request per bucket, which is what makes a large stock take
   * slow. */
  async syncStockTakeBuckets(args: {
    coldstore: string;
    farm: string;
    stockTakeDate: string;
    buckets: { bucketId: string; scannedAt: string }[];
  }): Promise<RawStockTakeSyncResponse> {
    const res = await api<{ data?: RawStockTakeSyncResponse } | RawStockTakeSyncResponse>({
      method: 'POST',
      url: '/api/method/upande_quality.mobile.api.syncStockTakeBuckets',
      data: {
        data: {
          coldstore: args.coldstore,
          farm: args.farm,
          stock_take_date: args.stockTakeDate,
          buckets: args.buckets.map((b) => ({ bucket_id: b.bucketId, scanned_at: b.scannedAt })),
        },
      },
      validateStatus: () => true,
    });
    const unwrapped = res as { data?: RawStockTakeSyncResponse } & RawStockTakeSyncResponse;
    return unwrapped.data ?? unwrapped;
  },
};
