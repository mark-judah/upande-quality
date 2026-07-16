import {
  karenDiscardApi,
  type RawDiscardListBucket,
  type RawDiscardPayload,
  type RawDiscardResponse,
} from '../api/karen-discard-api';

/** A bucket on the farm's discard work-list, as the UI consumes it. */
export type DiscardListBucket = {
  bucketId: string;
  shelf: string;
  variety: string;
  stems: number | null;
  ageDays: number | null;
  isShelved: boolean;
  greenhouse: string;
  discardRequest: string;
};

export type DiscardListOutcome =
  | { kind: 'ok'; buckets: DiscardListBucket[] }
  | { kind: 'error'; message: string };

function mapListBucket(r: RawDiscardListBucket): DiscardListBucket {
  return {
    bucketId: r.bucket_id ?? '',
    shelf: r.shelf ?? '',
    variety: r.variety ?? '',
    stems: typeof r.stem_qty === 'number' ? r.stem_qty : null,
    ageDays: typeof r.age_days === 'number' ? r.age_days : null,
    isShelved: !!r.is_shelved,
    greenhouse: r.greenhouse ?? '',
    discardRequest: r.discard_request ?? '',
  };
}

export type DiscardSuccess = {
  kind: 'success';
  bucketId: string;
  variety: string | null;
  stems: number | null;
  ageDays: number | null;
  discardEntry: string | null;
  removedFromShelves: string[];
  message: string;
};

export type DiscardFailure = {
  kind: 'failure';
  bucketId: string;
  reason: string;
  message: string;
  payload: RawDiscardPayload | null;
};

export type DiscardError = {
  kind: 'error';
  message: string;
};

export type DiscardOutcome = DiscardSuccess | DiscardFailure | DiscardError;

function pickMessage(raw: RawDiscardResponse, fallback: string): string {
  return raw.message?.trim() || fallback;
}

export const karenDiscardRepository = {
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

  /** Fetch the farm's discard work-list (buckets on Approved Discard Requests). */
  async fetchDiscardList(farm: string): Promise<DiscardListOutcome> {
    const raw = await karenDiscardApi.getDiscardRequestBuckets(farm);
    const m = raw.message ?? {};
    if (m.status === 'success') {
      return {
        kind: 'ok',
        buckets: (m.buckets ?? []).filter((b) => !!b.bucket_id).map(mapListBucket),
      };
    }
    return { kind: 'error', message: m.message ?? 'Failed to load discard list.' };
  },

  async submit(
    bucketId: string,
    opts?: { fromDiscardRequest?: boolean; farm?: string },
  ): Promise<DiscardOutcome> {
    const raw = await karenDiscardApi.createDiscardEntry(bucketId, opts);
    const p = raw.payload ?? {};
    if (raw.status === 'success') {
      return {
        kind: 'success',
        bucketId: p.bucket_id ?? bucketId,
        variety: p.variety ?? null,
        stems: typeof p.stems === 'number' ? p.stems : null,
        ageDays: typeof p.age_days === 'number' ? p.age_days : null,
        discardEntry: p.discard_entry ?? null,
        removedFromShelves: p.removed_from_shelves ?? [],
        message: pickMessage(raw, 'Bucket discarded.'),
      };
    }
    if (raw.status === 'failed') {
      return {
        kind: 'failure',
        bucketId: p.bucket_id ?? bucketId,
        reason: raw.reason ?? 'unknown',
        message: pickMessage(raw, 'Discard failed.'),
        payload: raw.payload ?? null,
      };
    }
    return { kind: 'error', message: pickMessage(raw, 'Discard failed.') };
  },
};
