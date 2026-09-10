import { api } from '@/src/core/api/client';

// ── fetchColdroomQCFormData ──────────────────────────────────────────────────
export type RawColdroomControlPoint = {
  name?: string;
  control_point?: string;
  control_area?: string;
};
export type RawColdroomReason = {
  name?: string;
  parameter?: string;
  tolerance_thresholds?: number;
};
export type RawColdroomIncharge = { name?: string; full_name?: string };

export type RawColdroomFormData = {
  success?: boolean;
  error?: string;
  control_points?: RawColdroomControlPoint[];
  reasons?: RawColdroomReason[];
  qc_incharge_options?: RawColdroomIncharge[];
};

// ── getColdroomBucket ────────────────────────────────────────────────────────
export type RawColdroomVariety = {
  variety?: string;
  item_name?: string;
  stems?: number;
  length?: string;
  greenhouse?: string;
};
export type RawColdroomBucket = {
  success?: boolean;
  error?: string;
  bucket_id?: string;
  farm?: string;
  greenhouse?: string;
  packhouse?: string;
  days_in_stock?: number;
  harvest_date?: string;
  varieties?: RawColdroomVariety[];
};

// ── saveColdroomQC ───────────────────────────────────────────────────────────
export type RawColdroomSave = {
  status?: string;
  name?: string;
  message?: string;
  total_stems_rejected?: number;
  stock_entry?: string | null;
  stock_entry_error?: string | null;
  http_status_code?: number;
};

type Envelope<T> = { message?: T; data?: T; http_status_code?: number };

export const karenColdroomQcApi = {
  fetchFormData(): Promise<Envelope<RawColdroomFormData>> {
    return api<Envelope<RawColdroomFormData>>({
      method: 'GET',
      url: '/api/method/fetchColdroomQCFormData',
      validateStatus: () => true,
    });
  },

  getBucket(bucketId: string): Promise<Envelope<RawColdroomBucket>> {
    return api<Envelope<RawColdroomBucket>>({
      method: 'POST',
      url: '/api/method/getColdroomBucket',
      data: { bucket_id: bucketId },
      validateStatus: () => true,
    });
  },

  save(payload: Record<string, unknown>): Promise<Envelope<RawColdroomSave>> {
    return api<Envelope<RawColdroomSave>>({
      method: 'POST',
      url: '/api/method/saveColdroomQC',
      data: { data: payload },
      validateStatus: () => true,
      // Server-side write — give it room like the other QC submits.
      timeout: 120000,
    });
  },
};
