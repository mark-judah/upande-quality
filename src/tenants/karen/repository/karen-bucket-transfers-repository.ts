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
  issued: boolean;
};

/** Order-level shelving status → drives the tabs and the incoming/arrived label. */
export type TransferStatus = 'none' | 'progress' | 'ready' | 'issued';

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
  issuedCount: number;
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
    issued: !!r.issued,
  };
}

/** A bucket counts as arrived once shelved, and stays arrived after it is
 *  issued (issuing may clear the shelf). */
function statusOf(buckets: TransferBucket[], shelved: number, issued: number, total: number): TransferStatus {
  const arrived = buckets.length
    ? buckets.filter((b) => b.shelved || b.issued).length
    : Math.max(shelved, issued);
  if (total > 0 && issued >= total) return 'issued';
  if (total > 0 && arrived >= total) return 'ready';
  if (arrived > 0) return 'progress';
  return 'none';
}

function mapGroup(r: RawInTransitGroup): TransferGroup {
  const buckets = (r.buckets ?? []).map(mapBucket);
  const total = typeof r.total === 'number' ? r.total : buckets.length;
  const shelvedCount =
    typeof r.shelved_count === 'number'
      ? r.shelved_count
      : buckets.filter((b) => b.shelved).length;
  const issuedCount =
    typeof r.issued_count === 'number'
      ? r.issued_count
      : buckets.filter((b) => b.issued).length;
  return {
    oplName: r.opl_name ?? '',
    orderName: r.order_name || r.opl_name || '',
    customer: r.customer ?? '',
    farm: r.farm ?? '',
    truck: r.truck ?? '',
    deliveryDate: r.delivery_date ?? '',
    total,
    shelvedCount,
    issuedCount,
    status: statusOf(buckets, shelvedCount, issuedCount, total),
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
