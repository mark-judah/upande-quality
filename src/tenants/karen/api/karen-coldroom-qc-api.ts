import { api } from '@/src/core/api/client';

// ── fetchColdroomBucket ──────────────────────────────────────────────────────
export type RawColdroomBucket = {
  status?: string;
  message?: string;
  bucket_id?: string;
  farm?: string;
  greenhouse?: string;
  variety?: string;
  stems_received?: number;
  rejected_so_far?: number;
  available_stems?: number;
  is_shelved?: number;
  source_warehouse?: string;
  receiving_entry?: string;
};

// ── Categorized reasons (fetchColdroomParameters — QC Parameters grouped) ─────
export type RawColdroomParameter = { name?: string; label?: string; category?: string };
export type RawColdroomParametersData = {
  status?: string;
  message?: string;
  parameters?: RawColdroomParameter[];
  categories?: { name?: string }[];
};

// ── saveColdroomReject ───────────────────────────────────────────────────────
export type RawColdroomSave = {
  status?: string;
  message?: string;
  quality_reporting?: string;
  stock_entry?: string;
  total_rejected?: number;
  available_after?: number;
  is_shelved?: number;
  shelf_new_qty?: number | null;
};

type Envelope<T> = { message?: T; data?: T; http_status_code?: number };

export const karenColdroomQcApi = {
  fetchParameters(): Promise<Envelope<RawColdroomParametersData>> {
    return api<Envelope<RawColdroomParametersData>>({
      method: 'GET',
      url: '/api/method/upande_quality.mobile.api.fetchColdroomParameters',
      validateStatus: () => true,
    });
  },

  getBucket(bucketId: string): Promise<Envelope<RawColdroomBucket>> {
    return api<Envelope<RawColdroomBucket>>({
      method: 'POST',
      url: '/api/method/upande_quality.mobile.api.fetchColdroomBucket',
      data: { bucket_id: bucketId },
      validateStatus: () => true,
    });
  },

  save(
    bucketId: string,
    failures: { reason: string; stems: number }[],
  ): Promise<Envelope<RawColdroomSave>> {
    return api<Envelope<RawColdroomSave>>({
      method: 'POST',
      url: '/api/method/upande_quality.mobile.api.saveColdroomReject',
      data: { bucket_id: bucketId, failures: JSON.stringify(failures) },
      validateStatus: () => true,
      timeout: 120000,
    });
  },
};
