import { api } from '@/src/core/api/client';

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
};
