import {
  karenBucketReturnApi,
  type RawBucketReturn,
  type RawRef,
} from '../api/karen-bucket-return-api';

export type Ref = { value: string; label: string };

export type DispatchOutcome =
  | { kind: 'success'; name: string; count: number; message: string }
  | { kind: 'error'; message: string };

export type ReceiptOutcome =
  | { kind: 'success'; name: string; count: number; message: string }
  | { kind: 'error'; message: string };

export type ScannedBucket = { bucketId: string; scannedTime: string };

/** Frappe-friendly "YYYY-MM-DD HH:MM:SS" from the device clock. */
function now(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** Pull the human message out of a Frappe error body (_server_messages / exc). */
function frappeError(body: { _server_messages?: string; message?: string; exc_type?: string }, fallback: string): string {
  try {
    if (body._server_messages) {
      const arr = JSON.parse(body._server_messages) as string[];
      if (arr.length) return (JSON.parse(arr[0]) as { message?: string }).message || fallback;
    }
  } catch {
    /* fall through */
  }
  return body.message || body.exc_type || fallback;
}

function mapRefs(rows: RawRef[] | undefined): Ref[] {
  return (rows ?? [])
    .filter((r) => !!r.name)
    .map((r) => ({ value: r.name as string, label: r.license_plate || (r.name as string) }));
}

export const karenBucketReturnRepository = {
  /** QR payload is `{"BUCKET-ID":"bucket"}`; fall back to the raw code. */
  extractBucketIdFromScan(raw: string): string | null {
    const text = raw.trim();
    if (text.startsWith('{') && text.endsWith('}')) {
      try {
        const parsed = JSON.parse(text);
        if (parsed && typeof parsed === 'object') {
          const entry = Object.entries(parsed as Record<string, unknown>).find(([, v]) => v === 'bucket');
          if (entry) return entry[0];
        }
      } catch {
        /* not our JSON shape */
      }
      return null;
    }
    return text || null;
  },

  async loadFarms(): Promise<Ref[]> {
    return mapRefs((await karenBucketReturnApi.listFarms()).data);
  },

  async loadVehicles(): Promise<Ref[]> {
    return mapRefs((await karenBucketReturnApi.listVehicles()).data);
  },

  async createDispatch(input: {
    farm: string;
    vehicle: string;
    user: string | null;
    buckets: ScannedBucket[];
  }): Promise<DispatchOutcome> {
    const doc: RawBucketReturn = {
      target_farm: input.farm,
      vehicle: input.vehicle || undefined,
      dispatch_datetime: now(),
      status: 'Dispatched',
      dispatched_by: input.user || undefined,
      total_dispatched: input.buckets.length,
      remarks: 'Dispatched via mobile app',
      buckets: input.buckets.map((b) => ({ bucket_id: b.bucketId, scanned_time: b.scannedTime })),
    };
    const res = await karenBucketReturnApi.create(doc);
    if (res.data?.name) {
      return {
        kind: 'success',
        name: res.data.name,
        count: input.buckets.length,
        message: `Dispatched ${input.buckets.length} bucket(s) to ${input.farm} (${res.data.name}).`,
      };
    }
    return { kind: 'error', message: frappeError(res, 'Could not create the dispatch.') };
  },

  /** One scan confirms the whole batch: find the open batch for this farm that
   *  contains the bucket, then mark every row received + status Fully Received. */
  async receiveScan(bucketId: string, farm: string, user: string | null): Promise<ReceiptOutcome> {
    const list = await karenBucketReturnApi.openBatchesForFarm(farm);
    const target = (list.data ?? []).find((r) => (r.bucket_id || '').toUpperCase() === bucketId.toUpperCase());
    if (!target?.name) {
      return { kind: 'error', message: `${bucketId} is not in any open dispatch to ${farm}.` };
    }
    const docRes = await karenBucketReturnApi.getDoc(target.name);
    const doc = docRes.data;
    if (!doc) return { kind: 'error', message: frappeError(docRes, 'Could not load the batch.') };

    const ts = now();
    const buckets = (doc.buckets ?? []).map((b) => ({
      ...b,
      received: 1,
      received_time: ts,
      received_by: user || undefined,
    }));
    const upRes = await karenBucketReturnApi.update(target.name, {
      status: 'Fully Received',
      received_scan: bucketId,
      received_time: ts,
      received_by: user || undefined,
      total_received: buckets.length,
      buckets,
    });
    if (upRes.data?.name) {
      return {
        kind: 'success',
        name: target.name,
        count: buckets.length,
        message: `Batch ${target.name} received — ${buckets.length} bucket(s).`,
      };
    }
    return { kind: 'error', message: frappeError(upRes, 'Could not confirm receipt.') };
  },
};
