import {
  karenShelvingApi,
  type RawShelvingPayload,
  type RawShelvingResponse,
} from '../api/karen-shelving-api';

export type ShelvingSuccess = {
  kind: 'success';
  shelfId: string;
  bucketId: string;
  stems: number | null;
  stemLength: string | null;
  message: string;
};

export type ShelvingFailure = {
  kind: 'failure';
  shelfId: string | null;
  bucketId: string;
  reason: string;
  message: string;
  payload: RawShelvingPayload | null;
};

export type ShelvingError = {
  kind: 'error';
  message: string;
};

export type ShelvingOutcome = ShelvingSuccess | ShelvingFailure | ShelvingError;

function pickMessage(raw: RawShelvingResponse, fallback: string): string {
  return raw.message?.trim() || fallback;
}

export const karenShelvingRepository = {
  /** Shelf QR is `{"shelf": "<id>"}` — the value 'shelf' tags the key. */
  extractShelfIdFromScan(raw: string): string | null {
    const text = raw.trim();
    if (!text.startsWith('{') || !text.endsWith('}')) return null;
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === 'object') {
        const shelf = (parsed as Record<string, unknown>)['shelf'];
        return typeof shelf === 'string' && shelf ? shelf : null;
      }
      return null;
    } catch {
      return null;
    }
  },

  /** Bucket QR is `{"<bucket_id>": "bucket"}`. */
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

  async submit(args: {
    farm: string;
    shelfId: string;
    bucketId: string;
  }): Promise<ShelvingOutcome> {
    const raw = await karenShelvingApi.createShelvingEntry(args);
    if (raw.status === 'success') {
      return {
        kind: 'success',
        shelfId: raw.payload?.shelf_id ?? args.shelfId,
        bucketId: raw.payload?.bucket_id ?? args.bucketId,
        stems: typeof raw.payload?.stems === 'number' ? raw.payload.stems : null,
        stemLength: raw.payload?.stem_length ?? null,
        message: pickMessage(raw, 'Bucket shelved.'),
      };
    }
    if (raw.status === 'failed') {
      return {
        kind: 'failure',
        shelfId: raw.payload?.shelf_id ?? args.shelfId ?? null,
        bucketId: raw.payload?.bucket_id ?? args.bucketId,
        reason: raw.reason ?? 'unknown',
        message: pickMessage(raw, 'Shelving failed.'),
        payload: raw.payload ?? null,
      };
    }
    return { kind: 'error', message: pickMessage(raw, 'Shelving failed.') };
  },
};
