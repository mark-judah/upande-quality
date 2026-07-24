import { api } from '@/src/core/api/client';

/** One transferred bucket (in-transit or shelved) inside an order group. */
export type RawInTransitBucket = {
  bucket_id?: string;
  variety?: string;
  stems?: number;
  stem_length?: string;
  shelf?: string;
  /** 1 = shelved at the packhouse, 0 = still incoming/in transit. */
  shelved?: number;
};

/** One order group of transferred buckets. */
export type RawInTransitGroup = {
  opl_name?: string;
  order_name?: string;
  customer?: string;
  farm?: string;
  truck?: string;
  delivery_date?: string;
  total?: number;
  shelved_count?: number;
  buckets?: RawInTransitBucket[];
};

export type RawInTransitResponse = {
  message?: {
    status?: string;
    from_date?: string;
    to_date?: string;
    groups?: RawInTransitGroup[];
    message?: string;
  };
};

export const karenBucketTransfersApi = {
  /** Transferred buckets (in-transit + shelved) for the delivery-date window,
   *  grouped by order (all farms). */
  getInTransitBuckets(fromDate: string, toDate: string): Promise<RawInTransitResponse> {
    return api<RawInTransitResponse>({
      method: 'POST',
      url: '/api/method/getInTransitBuckets',
      data: { from_date: fromDate, to_date: toDate },
      validateStatus: () => true,
    });
  },
};
