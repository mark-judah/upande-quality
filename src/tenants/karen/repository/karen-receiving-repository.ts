import { karenReceivingApi, type RawReceivingResponse } from '../api/karen-receiving-api';

export type BucketDetails = {
  farm: string;
  greenhouse: string;
  stemLength: string;
  numberOfStems: string;
  /** Optional — server populates when the bucket has a known last entry. */
  variety?: string;
  /** Optional — YYYY-MM-DD of the harvest posting_date. */
  harvestDate?: string;
  /** Optional — only for spray roses (stems / 10). */
  bunches?: string;
};

export type ReceivingOutcome =
  | { kind: 'received'; bucketId: string; stockEntryName: string | null; details: BucketDetails }
  | { kind: 'already_received'; bucketId: string; message: string; details: BucketDetails }
  | { kind: 'not_harvested'; bucketId: string; message: string }
  | { kind: 'not_exist'; bucketId: string; message: string }
  | { kind: 'no_harvest_on_date'; bucketId: string; message: string; details: BucketDetails }
  | { kind: 'error'; message: string };

function detailsFrom(raw: RawReceivingResponse): BucketDetails {
  return {
    farm: raw.farm ?? '',
    greenhouse: raw.greenhouse ?? '',
    stemLength: raw.stem_length ?? '',
    numberOfStems: raw.number_of_stems ?? '',
    variety: raw.variety || undefined,
    harvestDate: raw.harvest_date || undefined,
    bunches: raw.bunches && raw.bunches !== '0' ? raw.bunches : undefined,
  };
}

function pickMessage(raw: RawReceivingResponse, fallback: string): string {
  return raw.message?.trim() || raw.error?.trim() || fallback;
}

export const karenReceivingRepository = {
  /**
   * Karen QR codes are JSON objects like {"BKT-123": "bucket"}. The bucket id is
   * the key whose value equals "bucket".
   */
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

  async submit(
    bucketId: string,
    batchId: string | null,
    confirmReceive?: boolean,
  ): Promise<ReceivingOutcome> {
    const raw = await karenReceivingApi.createReceiving(bucketId, batchId, confirmReceive);

    switch (raw.status) {
      case 'received':
        return {
          kind: 'received',
          bucketId,
          stockEntryName: raw.stock_entry_name ?? null,
          details: detailsFrom(raw),
        };
      case 'already_received':
        return {
          kind: 'already_received',
          bucketId,
          message: pickMessage(raw, 'Bucket already received.'),
          details: detailsFrom(raw),
        };
      case 'not_harvested':
        return {
          kind: 'not_harvested',
          bucketId,
          message: pickMessage(raw, `No stock entry found for bucket ${bucketId}.`),
        };
      case 'not_exist':
        return {
          kind: 'not_exist',
          bucketId,
          message: pickMessage(raw, `Bucket ${bucketId} does not exist.`),
        };
      case 'no_harvest_on_date':
        return {
          kind: 'no_harvest_on_date',
          bucketId,
          message: pickMessage(raw, 'No harvesting entries on the bucket date.'),
          details: detailsFrom(raw),
        };
      case 'error':
        return { kind: 'error', message: pickMessage(raw, 'Receiving failed.') };
      default:
        // Unexpected shape — try to surface whatever message the server sent.
        return {
          kind: 'error',
          message: pickMessage(raw, `Unexpected response (status: ${raw.status ?? 'unknown'}).`),
        };
    }
  },
};
