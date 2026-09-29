import { mapAxiosError } from '@/src/core/api/client';
import {
  karenColdroomQcApi,
  type RawColdroomBucket,
} from '../api/karen-coldroom-qc-api';

export type ColdroomParameter = { name: string; label: string; category: string };

export type ColdroomBucket = {
  bucketId: string;
  farm: string;
  greenhouse: string;
  variety: string;
  stemsReceived: number;
  availableStems: number;
  isShelved: boolean;
  sourceWarehouse: string;
};

export type ParametersOutcome =
  | { kind: 'ok'; parameters: ColdroomParameter[]; categories: string[] }
  | { kind: 'error'; message: string };
export type BucketOutcome = { kind: 'ok'; bucket: ColdroomBucket } | { kind: 'error'; message: string };
export type SaveOutcome =
  | { kind: 'ok'; qualityReporting: string; stockEntry: string; message: string }
  | { kind: 'error'; message: string };

function toBucket(raw: RawColdroomBucket): ColdroomBucket {
  return {
    bucketId: String(raw.bucket_id ?? ''),
    farm: String(raw.farm ?? ''),
    greenhouse: String(raw.greenhouse ?? ''),
    variety: String(raw.variety ?? ''),
    stemsReceived: Number(raw.stems_received ?? 0),
    availableStems: Number(raw.available_stems ?? 0),
    isShelved: Number(raw.is_shelved ?? 0) === 1,
    sourceWarehouse: String(raw.source_warehouse ?? ''),
  };
}

export const karenColdroomQcRepository = {
  async fetchParameters(): Promise<ParametersOutcome> {
    try {
      const res = await karenColdroomQcApi.fetchParameters();
      const m = res.message ?? res.data ?? {};
      if (m.status && m.status !== 'success') {
        return { kind: 'error', message: m.message ?? 'Failed to load reasons.' };
      }
      const parameters = (m.parameters ?? [])
        .map((p) => ({
          name: String(p.name ?? ''),
          label: String(p.label ?? p.name ?? ''),
          category: String(p.category ?? 'Other'),
        }))
        .filter((p) => p.name);
      const categories = (m.categories ?? []).map((c) => String(c.name ?? '')).filter(Boolean);
      return { kind: 'ok', parameters, categories };
    } catch (err) {
      return { kind: 'error', message: mapAxiosError(err).message };
    }
  },

  async getBucket(bucketId: string): Promise<BucketOutcome> {
    try {
      const res = await karenColdroomQcApi.getBucket(bucketId);
      const m: RawColdroomBucket = res.message ?? res.data ?? {};
      if (m.status !== 'success') {
        return { kind: 'error', message: m.message ?? 'Bucket not found.' };
      }
      return { kind: 'ok', bucket: toBucket(m) };
    } catch (err) {
      return { kind: 'error', message: mapAxiosError(err).message };
    }
  },

  async save(bucketId: string, failures: { reason: string; stems: number }[]): Promise<SaveOutcome> {
    try {
      const res = await karenColdroomQcApi.save(bucketId, failures);
      const m = res.message ?? res.data ?? {};
      if (m.status === 'success' && m.quality_reporting) {
        return {
          kind: 'ok',
          qualityReporting: m.quality_reporting,
          stockEntry: String(m.stock_entry ?? ''),
          message: m.message ?? `Rejected ${m.total_rejected ?? 0} stems (${m.quality_reporting}).`,
        };
      }
      return { kind: 'error', message: m.message ?? 'Failed to save coldroom reject.' };
    } catch (err) {
      return { kind: 'error', message: mapAxiosError(err).message };
    }
  },
};

/** Bucket QRs encode as `{ "<bucket-id>": "bucket" }`; fall back to raw text. */
export function extractColdroomBucketId(raw: string): string {
  const t = (raw ?? '').trim();
  if (t.startsWith('{')) {
    try {
      const obj = JSON.parse(t) as Record<string, unknown>;
      const keys = Object.keys(obj);
      if (keys.length) return keys[0];
    } catch {
      // not JSON — use raw
    }
  }
  return t;
}
