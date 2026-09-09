import { mapAxiosError } from '@/src/core/api/client';
import {
  karenColdroomQcApi,
  type RawColdroomBucket,
  type RawColdroomFormData,
  type RawColdroomVariety,
} from '../api/karen-coldroom-qc-api';

export type ColdroomControlPoint = { name: string; controlPoint: string; controlArea: string };
export type ColdroomReason = { name: string; parameter: string };
export type ColdroomIncharge = { name: string; fullName: string };
export type ColdroomVariety = {
  variety: string;
  itemName: string;
  stems: number;
  length: string;
  greenhouse: string;
};
export type ColdroomBucket = {
  bucketId: string;
  farm: string;
  greenhouse: string;
  packhouse: string;
  daysInStock: number;
  harvestDate: string;
  varieties: ColdroomVariety[];
};

export type ColdroomFormData = {
  controlPoints: ColdroomControlPoint[];
  reasons: ColdroomReason[];
  inchargeOptions: ColdroomIncharge[];
};

export type FormDataOutcome =
  | ({ kind: 'ok' } & ColdroomFormData)
  | { kind: 'error'; message: string };
export type BucketOutcome = { kind: 'ok'; bucket: ColdroomBucket } | { kind: 'error'; message: string };
export type SaveOutcome = { kind: 'ok'; name: string; message: string } | { kind: 'error'; message: string };

function toVariety(raw: RawColdroomVariety): ColdroomVariety {
  return {
    variety: String(raw.variety ?? raw.item_name ?? ''),
    itemName: String(raw.item_name ?? ''),
    stems: Number(raw.stems ?? 0),
    length: String(raw.length ?? ''),
    greenhouse: String(raw.greenhouse ?? ''),
  };
}

function toBucket(raw: RawColdroomBucket): ColdroomBucket {
  return {
    bucketId: String(raw.bucket_id ?? ''),
    farm: String(raw.farm ?? ''),
    greenhouse: String(raw.greenhouse ?? ''),
    packhouse: String(raw.packhouse ?? ''),
    daysInStock: Number(raw.days_in_stock ?? 0),
    harvestDate: String(raw.harvest_date ?? ''),
    varieties: (raw.varieties ?? []).map(toVariety).filter((v) => v.variety),
  };
}

export const karenColdroomQcRepository = {
  async fetchFormData(): Promise<FormDataOutcome> {
    try {
      const res = await karenColdroomQcApi.fetchFormData();
      const m: RawColdroomFormData = res.message ?? res.data ?? {};
      if (m.success === false) return { kind: 'error', message: m.error ?? 'Failed to load coldroom form data.' };
      return {
        kind: 'ok',
        controlPoints: (m.control_points ?? []).map((c) => ({
          name: String(c.name ?? ''),
          controlPoint: String(c.control_point ?? c.name ?? ''),
          controlArea: String(c.control_area ?? 'Cold Room'),
        })),
        reasons: (m.reasons ?? []).map((r) => ({
          name: String(r.name ?? ''),
          parameter: String(r.parameter ?? r.name ?? ''),
        })),
        inchargeOptions: (m.qc_incharge_options ?? []).map((u) => ({
          name: String(u.name ?? ''),
          fullName: String(u.full_name ?? u.name ?? ''),
        })),
      };
    } catch (err) {
      return { kind: 'error', message: mapAxiosError(err).message };
    }
  },

  async getBucket(bucketId: string): Promise<BucketOutcome> {
    try {
      const res = await karenColdroomQcApi.getBucket(bucketId);
      const m: RawColdroomBucket = res.message ?? res.data ?? {};
      if (m.success === false) return { kind: 'error', message: m.error ?? 'Bucket not found.' };
      const bucket = toBucket(m);
      if (!bucket.varieties.length) return { kind: 'error', message: 'No varieties found in this bucket.' };
      return { kind: 'ok', bucket };
    } catch (err) {
      return { kind: 'error', message: mapAxiosError(err).message };
    }
  },

  async save(payload: Record<string, unknown>): Promise<SaveOutcome> {
    try {
      const res = await karenColdroomQcApi.save(payload);
      const m = res.message ?? {};
      if (m.status === 'success' && m.name) {
        let message = m.message ?? `Saved ${m.name}`;
        // The QC record saved, but flag if the rejects stock transfer failed.
        if (m.stock_entry_error) {
          message += ` — note: rejects stock transfer failed (${m.stock_entry_error})`;
        }
        return { kind: 'ok', name: m.name, message };
      }
      return { kind: 'error', message: m.message ?? 'Failed to save coldroom QC.' };
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
