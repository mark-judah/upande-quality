import { api } from '@/src/core/api/client';

export type BucketCountSyncReason = 'farm_not_null' | 'buckets_not_null' | 'unknown_error';

export type RawBucketCountResult = {
  bucket_id?: string;
  status?: 'success' | 'failed' | string;
  reason?: string;
  message?: string;
  warning?: string;
  payload?: { location?: string };
};

export type RawBucketCountSyncPayload = {
  bucket_count?: string;
  results?: RawBucketCountResult[];
};

export type RawBucketCountSyncResponse = {
  status?: 'success' | 'failed' | 'error' | string;
  reason?: BucketCountSyncReason | string;
  message?: string;
  payload?: RawBucketCountSyncPayload;
};

export type RawBucketCountLocation = { name: string };

export const karenBucketCountApi = {
  /** Bucket Count's location master list (Packhouse, Washing Area, Greenhouse,
   *  Coldroom, ...) — a plain Frappe list lookup, same convention
   *  fetchColdStores (karen-shelf-operations-api.ts) uses: hit
   *  frappe.client.get_list directly rather than add a bespoke endpoint for a
   *  simple master-doctype read. A location added later from the Desk shows
   *  up here with no app change. */
  async fetchBucketCountLocations(): Promise<{ message?: RawBucketCountLocation[] }> {
    return api({
      method: 'GET',
      url: '/api/method/frappe.client.get_list',
      params: {
        doctype: 'Bucket Count Location',
        fields: JSON.stringify(['name']),
        order_by: 'name asc',
        limit_page_length: 100,
      },
      validateStatus: () => true,
    });
  },

  /** POST /api/method/upande_quality.mobile.api.syncBucketCountScans — one
   *  call per chunk of locally-queued scans (see karen-bucket-count-db.ts).
   *  The server resolves and saves the whole chunk in one round trip (one
   *  doc.save()) — never one request per bucket. */
  async syncBucketCountScans(args: {
    farm: string;
    countDate: string;
    buckets: { bucketId: string; location: string; scannedAt: string }[];
  }): Promise<RawBucketCountSyncResponse> {
    const res = await api<{ data?: RawBucketCountSyncResponse } | RawBucketCountSyncResponse>({
      method: 'POST',
      url: '/api/method/upande_quality.mobile.api.syncBucketCountScans',
      data: {
        data: {
          farm: args.farm,
          count_date: args.countDate,
          buckets: args.buckets.map((b) => ({
            bucket_id: b.bucketId,
            location: b.location,
            scanned_at: b.scannedAt,
          })),
        },
      },
      validateStatus: () => true,
    });
    const unwrapped = res as { data?: RawBucketCountSyncResponse } & RawBucketCountSyncResponse;
    return unwrapped.data ?? unwrapped;
  },
};
