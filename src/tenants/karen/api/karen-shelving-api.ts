import { api } from '@/src/core/api/client';

/** What the Server Script returns under `data` for shelving outcomes. The
 *  `reason` enum mirrors the Flutter app's expectations so we can map it to
 *  user-facing wording without losing the distinction. */
export type ShelvingReason =
  | 'shelf_id_not_null'
  | 'bucket_id_not_null'
  | 'farm_not_null'
  | 'two_buckets_per_shelf'
  | 'duplicate_entry'
  | 'not_received'
  | 'no_matching_harvest'
  | 'harvest_receiving_gap_too_large'
  | 'stale_receiving_date'
  | 'unknown_error';

export type RawShelvingPayload = {
  shelf_id?: string;
  bucket_id?: string;
  stems?: number;
  stem_length?: string;
  transit_updated?: boolean;
  bas_updated?: boolean;
  bas_available_qty?: number;
  opl_submitted?: string[];
  origin_farm?: string;
  received_on?: string;
  harvested_on?: string;
  gap_days?: number;
  days_since_receiving?: number;
  max_allowed_days?: number;
};

export type RawShelvingResponse = {
  status?: 'success' | 'failed' | 'error' | string;
  reason?: ShelvingReason | string;
  message?: string;
  payload?: RawShelvingPayload;
};

export const karenShelvingApi = {
  /** POST /api/method/upande_quality.mobile.api.createShelvingEntry – body matches the Flutter client. */
  async createShelvingEntry(args: {
    farm: string;
    shelfId: string;
    bucketId: string;
  }): Promise<RawShelvingResponse> {
    const res = await api<{ data?: RawShelvingResponse } | RawShelvingResponse>({
      method: 'POST',
      url: '/api/method/upande_quality.mobile.api.createShelvingEntry',
      data: {
        farm: args.farm,
        shelf_id: args.shelfId,
        bucket_id: args.bucketId,
      },
      validateStatus: () => true,
    });
    // The Server Script wraps its response in `frappe.response["data"]`, which
    // the Frappe API layer surfaces as either `{ message: { data: {...} } }` or
    // (when called via /api/method/) `{ data: {...} }`. Normalise both.
    const unwrapped = res as { data?: RawShelvingResponse } & RawShelvingResponse;
    return unwrapped.data ?? unwrapped;
  },
};
