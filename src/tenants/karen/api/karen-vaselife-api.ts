import { api } from '@/src/core/api/client';

// ── fetchVaselifeFormData ────────────────────────────────────────────────────
export type RawVaselifeBreeder = { name?: string };
export type RawVaselifeVariety = { name?: string; variety?: string; breeder?: string; item_group?: string };
export type RawVaselifeCrop = { name?: string };
export type RawVaselifeCommercialStatus = { name?: string };
export type RawVaselifeCutStage = { name?: string };
export type RawVaselifeFailureReason = { name?: string };
export type RawVaselifeSampleRef = { name?: string; variety?: string; sampling_date?: string };

export type RawVaselifeFormData = {
  success?: boolean;
  error?: string;
  breeders?: RawVaselifeBreeder[];
  varieties?: RawVaselifeVariety[];
  crops?: RawVaselifeCrop[];
  commercial_statuses?: RawVaselifeCommercialStatus[];
  cut_stages?: RawVaselifeCutStage[];
  failure_reasons?: RawVaselifeFailureReason[];
  samples?: RawVaselifeSampleRef[];
};

// ── getVaselifeBucket ────────────────────────────────────────────────────────
export type RawVaselifeBucket = {
  success?: boolean;
  error?: string;
  bucket_id?: string;
  harvest_date?: string;
  harvest_time?: string;
  farm?: string;
  greenhouse?: string;
  length?: string;
};

// ── saveVaselifeSample ───────────────────────────────────────────────────────
export type RawVaselifeSampleSave = {
  status?: string;
  name?: string;
  sample_code?: string;
  message?: string;
};

// ── saveVaselifeObservation ──────────────────────────────────────────────────
export type RawVaselifeObservationSave = {
  status?: string;
  name?: string;
  message?: string;
};

type Envelope<T> = { message?: T; data?: T; http_status_code?: number };

export const karenVaselifeApi = {
  fetchFormData(): Promise<Envelope<RawVaselifeFormData>> {
    return api<Envelope<RawVaselifeFormData>>({
      method: 'GET',
      url: '/api/method/fetchVaselifeFormData',
      validateStatus: () => true,
    });
  },

  getBucket(bucketId: string): Promise<Envelope<RawVaselifeBucket>> {
    return api<Envelope<RawVaselifeBucket>>({
      method: 'POST',
      url: '/api/method/getVaselifeBucket',
      data: { bucket_id: bucketId },
      validateStatus: () => true,
    });
  },

  saveSample(payload: Record<string, unknown>): Promise<Envelope<RawVaselifeSampleSave>> {
    return api<Envelope<RawVaselifeSampleSave>>({
      method: 'POST',
      url: '/api/method/saveVaselifeSample',
      data: { data: payload },
      validateStatus: () => true,
      timeout: 120000,
    });
  },

  saveObservation(payload: Record<string, unknown>): Promise<Envelope<RawVaselifeObservationSave>> {
    return api<Envelope<RawVaselifeObservationSave>>({
      method: 'POST',
      url: '/api/method/saveVaselifeObservation',
      data: { data: payload },
      validateStatus: () => true,
      timeout: 120000,
    });
  },
};
