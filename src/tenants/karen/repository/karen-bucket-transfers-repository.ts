import {
  karenBucketTransfersApi,
  type RawInTransitBucket,
  type RawInTransitGroup,
} from '../api/karen-bucket-transfers-api';

/** A transferred bucket as the UI consumes it. */
export type TransferBucket = {
  bucketId: string;
  variety: string;
  stems: number | null;
  stemLength: string;
  shelf: string;
  shelved: boolean;
};

/** Order-level shelving status → drives the tabs and the incoming/arrived label. */
export type TransferStatus = 'none' | 'progress' | 'ready';

/** An order group of transferred buckets. */
export type TransferGroup = {
  oplName: string;
  orderName: string;
  customer: string;
  farm: string;
  truck: string;
  deliveryDate: string;
  total: number;
  shelvedCount: number;
  status: TransferStatus;
  buckets: TransferBucket[];
};

export type FetchTransfersOutcome =
  | { kind: 'ok'; groups: TransferGroup[] }
  | { kind: 'error'; message: string };

function mapBucket(r: RawInTransitBucket): TransferBucket {
  return {
    bucketId: r.bucket_id ?? '',
    variety: r.variety ?? '',
    stems: typeof r.stems === 'number' ? r.stems : null,
    stemLength: r.stem_length ?? '',
    shelf: r.shelf ?? '',
    shelved: !!r.shelved,
  };
}

function statusOf(shelved: number, total: number): TransferStatus {
  if (total > 0 && shelved >= total) return 'ready';
  if (shelved > 0) return 'progress';
  return 'none';
}

function mapGroup(r: RawInTransitGroup): TransferGroup {
  const buckets = (r.buckets ?? []).map(mapBucket);
  const total = typeof r.total === 'number' ? r.total : buckets.length;
  const shelvedCount =
    typeof r.shelved_count === 'number'
      ? r.shelved_count
      : buckets.filter((b) => b.shelved).length;
  return {
    oplName: r.opl_name ?? '',
    orderName: r.order_name || r.opl_name || '',
    customer: r.customer ?? '',
    farm: r.farm ?? '',
    truck: r.truck ?? '',
    deliveryDate: r.delivery_date ?? '',
    total,
    shelvedCount,
    status: statusOf(shelvedCount, total),
    buckets,
  };
}

export const karenBucketTransfersRepository = {
  async fetchInTransit(fromDate: string, toDate: string): Promise<FetchTransfersOutcome> {
    const raw = await karenBucketTransfersApi.getInTransitBuckets(fromDate, toDate);
    const m = raw.message ?? {};
    if (m.status === 'success') {
      return { kind: 'ok', groups: (m.groups ?? []).map(mapGroup) };
    }
    return { kind: 'error', message: m.message ?? 'Failed to load bucket transfers.' };
  },
};
