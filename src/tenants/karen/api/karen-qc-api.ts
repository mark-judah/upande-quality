import { api } from '@/src/core/api/client';

// ── getBatchByBucket ────────────────────────────────────────────────────────

export type RawBucket = {
  bucket_id?: string;
  stems?: number;
  item_code?: string;
  item_name?: string;
  warehouse?: string;
  quarantine_warehouse?: string | null;
  basic_rate?: number;
  cost_center?: string;
  farm?: string;
  greenhouse?: string;
  stock_entry?: string;
  status?: string;
  selected?: boolean;
  quarantine_stems?: number;
  is_in_quarantine?: boolean;
};

export type RawBatchByBucketResponse = {
  status?: string;
  message?: string;
  batch_no?: string;
  farm?: string;
  company?: string;
  total_buckets?: number;
  total_stems?: number;
  buckets?: RawBucket[];
  scanned_bucket?: string;
  has_active_quarantine?: boolean;
};

// ── fetchQcParameters ───────────────────────────────────────────────────────

export type RawQualityParameter = {
  name?: string;
  parameter?: string;
  tolerance_thresholds?: number;
};

export type RawQcParametersResponse = {
  message?: RawQualityParameter[];
  data?: RawQualityParameter[];
};

// ── getGreenhouseData ───────────────────────────────────────────────────────

export type RawGreenhouseData = {
  varieties?: { variety: string; area?: number }[];
  employees?: { employee_name: string }[];
};

export type RawGreenhouseResponse = {
  message?: RawGreenhouseData;
  data?: RawGreenhouseData;
};

// ── submit responses ────────────────────────────────────────────────────────

export type RawSubmitResponse = {
  http_status_code?: number;
  status?: string;
  message?: string;
  error?: string;
};

// ── API functions ───────────────────────────────────────────────────────────

export const karenQcApi = {
  fetchParameters(): Promise<RawQcParametersResponse> {
    return api<RawQcParametersResponse>({
      method: 'GET',
      url: '/api/method/fetchQcParameters',
    });
  },

  getBatchByBucket(bucketId: string): Promise<RawBatchByBucketResponse> {
    return api<RawBatchByBucketResponse>({
      method: 'POST',
      url: '/api/method/getBatchByBucket',
      data: { bucket_id: bucketId },
      validateStatus: () => true,
    });
  },

  submitBatchQuality(payload: Record<string, unknown>): Promise<RawSubmitResponse> {
    return api<RawSubmitResponse>({
      method: 'POST',
      url: '/api/method/submitBatchQuality',
      data: { data: payload },
      validateStatus: () => true,
    });
  },

  releaseFromQuarantine(args: {
    bucketId: string;
    action: 'accept' | 'reject';
    batchNo: string;
    stemsToRelease?: number;
  }): Promise<RawSubmitResponse> {
    const body: Record<string, unknown> = {
      bucket_id: args.bucketId,
      action: args.action,
      batch_no: args.batchNo,
    };
    if (args.stemsToRelease !== undefined) {
      body.stems_to_release = args.stemsToRelease;
    }
    return api<RawSubmitResponse>({
      method: 'POST',
      url: '/api/method/releaseFromQuarantine',
      data: body,
      validateStatus: () => true,
    });
  },

  getGreenhouseData(greenhouse: string): Promise<RawGreenhouseResponse> {
    return api<RawGreenhouseResponse>({
      method: 'POST',
      url: '/api/method/getGreenhouseData',
      data: { greenhouse_name: greenhouse },
    });
  },

  submitFieldReject(payload: Record<string, unknown>): Promise<RawSubmitResponse> {
    return api<RawSubmitResponse>({
      method: 'POST',
      url: '/api/method/submitFieldRejects',
      data: payload,
      validateStatus: () => true,
    });
  },
};
