import { api } from '@/src/core/api/client';

export type RawTraceabilityRow = {
  stock_entry?: string;
  custom_farm?: string;
  custom_greenhouse?: string;
  custom_stem_length?: string;
  number_of_stems?: string | number;
  variety?: string | null;
  posting_date?: string | null;
};

export type RawTraceabilityResponse = {
  data?: RawTraceabilityRow[];
  message?: RawTraceabilityRow[] | RawTraceabilityRow;
};

export const monaTraceabilityApi = {
  async getStatus(bucketId: string): Promise<RawTraceabilityResponse> {
    return api<RawTraceabilityResponse>({
      method: 'POST',
      url: '/api/method/getBucketStatus',
      data: { bucket_id: bucketId },
    });
  },
};
