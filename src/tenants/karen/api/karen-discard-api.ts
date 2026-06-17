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

export const karenDiscardApi = {
  async createDiscardEntry(bucketId: string): Promise<RawDiscardResponse> {
    const res = await api<{ data?: RawDiscardResponse } | RawDiscardResponse>({
      method: 'POST',
      url: '/api/method/createDiscardEntry',
      data: { bucket_id: bucketId },
      validateStatus: () => true,
    });
    const unwrapped = res as { data?: RawDiscardResponse } & RawDiscardResponse;
    return unwrapped.data ?? unwrapped;
  },
};
