import {
  karenBucketCountApi,
  type RawBucketCountSyncResponse,
} from '../api/karen-bucket-count-api';
import type { BucketCountSyncResult } from '../offline/karen-bucket-count-db';

export type BucketCountSyncSuccess = {
  kind: 'success';
  bucketCount: string;
  results: BucketCountSyncResult[];
  message: string;
};

export type BucketCountSyncFailure = { kind: 'failure'; reason: string; message: string };

export type BucketCountSyncError = { kind: 'error'; message: string };

export type BucketCountSyncOutcome = BucketCountSyncSuccess | BucketCountSyncFailure | BucketCountSyncError;

function pickMessage(raw: { message?: string }, fallback: string): string {
  return raw.message?.trim() || fallback;
}

export const karenBucketCountRepository = {
  /** Bucket QR is `{"<bucket_id>": "bucket"}` — duplicated from
   *  karen-shelf-operations-repository.ts rather than cross-imported, same
   *  convention that file's own fetchColdStores already follows (see its
   *  comment re: karen-coldroom-api.ts). */
  extractBucketIdFromScan(raw: string): string | null {
    const text = raw.trim();
    if (!text.startsWith('{') || !text.endsWith('}')) return null;
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === 'object') {
        const entry = Object.entries(parsed as Record<string, unknown>).find(
          ([, v]) => v === 'bucket',
        );
        return entry ? entry[0] : null;
      }
      return null;
    } catch {
      return null;
    }
  },

  async fetchBucketCountLocations(): Promise<string[]> {
    const res = await karenBucketCountApi.fetchBucketCountLocations();
    return (res.message ?? []).map((l) => l.name).filter(Boolean);
  },

  async syncBucketCountScans(args: {
    farm: string;
    countDate: string;
    buckets: { bucketId: string; location: string; scannedAt: string }[];
  }): Promise<BucketCountSyncOutcome> {
    const raw: RawBucketCountSyncResponse = await karenBucketCountApi.syncBucketCountScans(args);
    if (raw.status === 'success' && raw.payload) {
      const results: BucketCountSyncResult[] = (raw.payload.results ?? []).map((r) => {
        if (r.status === 'success' && r.payload?.location) {
          return {
            bucketId: r.bucket_id ?? '',
            ok: true,
            location: r.payload.location,
            warning: r.warning ?? null,
          };
        }
        return { bucketId: r.bucket_id ?? '', ok: false, message: pickMessage(r, 'Could not resolve this bucket.') };
      });
      return {
        kind: 'success',
        bucketCount: raw.payload.bucket_count ?? '',
        results,
        message: pickMessage(raw, 'Synced.'),
      };
    }
    if (raw.status === 'failed') {
      return { kind: 'failure', reason: raw.reason ?? 'unknown', message: pickMessage(raw, 'Sync failed.') };
    }
    return { kind: 'error', message: pickMessage(raw, 'Sync failed.') };
  },
};
