import { api } from '@/src/core/api/client';
import { fetchRoseVarieties } from './rose-varieties';

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
    qty?: number | null;
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

export type IssueOfflineReason = 'not_found' | 'wrong_variety';
/** What the scan says about the line: the allocated bucket itself was found, or why not. */
export type IssueOfflineScanReason = IssueOfflineReason | 'found';

export type RawOfflineOpl = {
  opl_name: string;
  order_name?: string | null;
  customer?: string | null;
  team?: string | null;
  delivery_date?: string | null;
  total_stems?: number;
  issued_stems?: number;
  issued_pct?: number;
  open_buckets?: number;
  varieties?: string[];
};

export type RawOfflineBucket = {
  bucket: string;
  variety?: string | null;
  stem_length?: string | null;
  stems?: number;
  shelf?: string | null;
  on_shelf?: boolean;
  not_found?: boolean;
  in_transit?: boolean;
};

export type RawReplacementCandidate = {
  new_bucket: string;
  shelf?: string | null;
  variety?: string | null;
  stem_length?: string | null;
  available_qty?: number;
  harvest_date?: string | null;
};

export type RawOfflineHistory = {
  replacement: string;
  reason: 'not_found' | 'wrong_variety';
  status?: string | null;
  new_bucket?: string | null;
  opl_name?: string | null;
  order_name?: string | null;
  reported_by?: string | null;
  reported_at?: string | null;
};

export type RawReplacementOptions = {
  found?: boolean;
  message?: string;
  needed_qty?: number;
  farm?: string;
  candidates?: RawReplacementCandidate[];
  history?: RawOfflineHistory[];
};

export type RawIssueOfflineResponse = {
  success?: boolean;
  message?: string;
  reason?: string;
  issued_bucket?: string;
  replacement?: string | null;
  candidates?: RawReplacementCandidate[];
  correction?: { ok?: boolean; message?: string } | null;
};

const OFFLINE_ISSUE = '/api/method/upande_packhouse.api.offline_issue';

export const karenShelfOperationsApi = {
  /** Open OPLs that still have buckets to issue — delivering on `deliveryDate`
   *  (YYYY-MM-DD), or recent delivery dates when it is not given. */
  async fetchOfflineIssueOpls(deliveryDate?: string, farm?: string): Promise<RawOfflineOpl[]> {
    const res = await api<{ message?: { opls?: RawOfflineOpl[] } }>({
      method: 'GET',
      url: `${OFFLINE_ISSUE}.offline_issue_opls`,
      params: { ...(deliveryDate ? { delivery_date: deliveryDate } : {}), ...(farm ? { farm } : {}) },
    });
    return res.message?.opls ?? [];
  },

  /** The buckets an OPL is still waiting on. */
  async fetchOfflineIssueBuckets(oplName: string, farm?: string): Promise<RawOfflineBucket[]> {
    const res = await api<{ message?: { buckets?: RawOfflineBucket[] } }>({
      method: 'GET',
      url: `${OFFLINE_ISSUE}.offline_issue_buckets`,
      params: { opl_name: oplName, ...(farm ? { farm } : {}) },
    });
    return res.message?.buckets ?? [];
  },

  /** Buckets that can stand in for `bucket` on the OPL, and the bucket's earlier
   *  not-found / wrong-variety reports. */
  async fetchReplacementOptions(oplName: string, bucket: string, farm?: string): Promise<RawReplacementOptions> {
    const res = await api<{ message?: RawReplacementOptions }>({
      method: 'GET',
      url: `${OFFLINE_ISSUE}.replacement_options`,
      // `farm`: the station — substitutes come from there, and a remote-transfer
      // bucket that left its farm but never arrived can be replaced.
      params: { opl_name: oplName, bucket, limit: 20, ...(farm ? { farm } : {}) },
    });
    return res.message ?? {};
  },

  /** Swap the allocated bucket for the scanned one (when they differ) and
   * issue it against the OPL, as the packhouse issuing scan would. */
  async issueOffline(args: {
    oplName: string;
    allocatedBucket: string;
    scannedBucket: string;
    reason: IssueOfflineScanReason;
    variety?: string;
    stemLength?: string;
    notes?: string;
    farm?: string;
  }): Promise<RawIssueOfflineResponse> {
    const res = await api<{ message?: RawIssueOfflineResponse }>({
      method: 'POST',
      url: `${OFFLINE_ISSUE}.issue_offline`,
      data: {
        opl_name: args.oplName,
        allocated_bucket: args.allocatedBucket,
        scanned_bucket: args.scannedBucket,
        reason: args.reason,
        variety: args.variety || undefined,
        stem_length: args.stemLength || undefined,
        notes: args.notes || undefined,
        farm: args.farm || undefined,
      },
      // A swap can wait on stock locks and retry (see offline_issue._swap).
      timeout: 120000,
    });
    return res.message ?? {};
  },

  /** Rose varieties, for correcting a wrong-variety bucket. Same lookup as the
   * Replacement screen's (karen-replacement-api.ts), inlined per this file's
   * convention. */
  /** Every rose variety, sub-groups included (see rose-varieties). */
  async fetchVarieties(): Promise<string[]> {
    return fetchRoseVarieties();
  },

  /** Stem Length masters ("37cm", "42cm", ...), shortest first. */
  async fetchStemLengths(): Promise<string[]> {
    const res = await api<{ data?: { name?: string; length?: string }[] }>({
      method: 'GET',
      url: '/api/resource/Stem Length',
      params: {
        fields: JSON.stringify(['name', 'length']),
        limit_page_length: 500,
        order_by: 'length asc',
      },
    });
    return (res.data ?? []).map((r) => r.length ?? r.name ?? '').filter((s) => s.length > 0);
  },

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
