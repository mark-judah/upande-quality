import { api } from '@/src/core/api/client';

export type DiscardReason =
  | 'bucket_id_missing'
  | 'not_received'
  | 'already_discarded'
  | 'bucket_allocated'
  | 'bucket_too_young'
  | 'unknown_error';

export type RawDiscardPayload = {
  bucket_id?: string;
  age_days?: number;
  variety?: string;
  stems?: number;
  discard_entry?: string;
  override_age?: boolean;
  removed_from_shelves?: string[];
};

export type RawDiscardResponse = {
  status?: 'success' | 'failed' | 'error' | string;
  reason?: DiscardReason | string;
  message?: string;
  payload?: RawDiscardPayload;
};

/** One bucket on the farm's discard work-list (from an Approved Discard Request). */
export type RawDiscardListBucket = {
  bucket_id?: string;
  shelf?: string;
  variety?: string;
  stem_qty?: number;
  age_days?: number;
  is_shelved?: number;
  greenhouse?: string;
  stem_length?: string;
  discard_request?: string;
};

export type RawDiscardListResponse = {
  message?: {
    status?: string;
    farm?: string;
    buckets?: RawDiscardListBucket[];
    message?: string;
  };
};

export const karenDiscardApi = {
  /** The farm's discard work-list — buckets on Approved Discard Requests. */
  getDiscardRequestBuckets(farm: string): Promise<RawDiscardListResponse> {
    return api<RawDiscardListResponse>({
      method: 'POST',
      url: '/api/method/upande_quality.mobile.api.getDiscardRequestBuckets',
      data: { farm },
      validateStatus: () => true,
    });
  },

  async createDiscardEntry(
    bucketId: string,
    opts?: { fromDiscardRequest?: boolean; farm?: string },
  ): Promise<RawDiscardResponse> {
    const res = await api<{ data?: RawDiscardResponse } | RawDiscardResponse>({
      method: 'POST',
      url: '/api/method/upande_quality.mobile.api.createDiscardEntry',
      data: {
        bucket_id: bucketId,
        // Signals the server to verify the bucket is on an Approved Discard
        // Request for the farm, then bypass the age + allocation validations.
        ...(opts?.fromDiscardRequest ? { from_discard_request: 1 } : {}),
        ...(opts?.farm ? { farm: opts.farm } : {}),
      },
      validateStatus: () => true,
    });
    const unwrapped = res as { data?: RawDiscardResponse } & RawDiscardResponse;
    return unwrapped.data ?? unwrapped;
  },
};
