import { api } from '@/src/core/api/client';

// ── fetchBucketCleaningFormData ──────────────────────────────────────────────
export type RawChemical = { name?: string; item_name?: string };

export type RawBucketCleaningFormData = {
  success?: boolean;
  error?: string;
  detergents?: RawChemical[];
  disinfectants?: RawChemical[];
};

// ── submitBucketCleaningLog ──────────────────────────────────────────────────
export type RawSubmitResponse = {
  message?: { status?: 'success' | 'error' | string; name?: string; message?: string };
};

export type BucketCleaningPayload = {
  buckets_cleaned: number;
  detergent_used?: string;
  qty_of_detergent?: number;
  volume_of_solution_detergent?: number;
  disinfectant_used?: string;
  qty_of_disinfectant?: number;
  volume_of_solution_disinfectant?: number;
  remarks?: string;
};

export const karenBucketCleaningApi = {
  fetchFormData(): Promise<{ message?: RawBucketCleaningFormData }> {
    return api<{ message?: RawBucketCleaningFormData }>({
      method: 'GET',
      url: '/api/method/upande_quality.mobile.api.fetchBucketCleaningFormData',
      validateStatus: () => true,
    });
  },

  submit(data: BucketCleaningPayload): Promise<RawSubmitResponse> {
    return api<RawSubmitResponse>({
      method: 'POST',
      url: '/api/method/upande_quality.mobile.api.submitBucketCleaningLog',
      data: { data },
      validateStatus: () => true,
    });
  },
};
