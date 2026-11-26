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
  /** 1 = issued out of the coldroom to the order. */
  issued?: number;
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
  issued_count?: number;
  buckets?: RawInTransitBucket[];
  /** Packhouse Schedule: its team's place (0 = not scheduled), the team, and
   *  whether it is the first order with a bucket still to shelve. */
  schedule?: number;
  team?: string;
  shelve_next?: boolean;
  /** 1 = a Quality B pick list: received in one go (no shelving) and issued then. */
  quality_b?: number;
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

export type RawQualityBReceive = {
  message?: { received?: number; issued?: number; failed?: { bucket?: string; message?: string }[] };
  exception?: string;
  _server_messages?: string;
};

export const karenBucketTransfersApi = {
  /** Every bucket of a Quality B pick list on the truck received at the sales farm and issued to its order. */
  receiveQualityB(oplName: string): Promise<RawQualityBReceive> {
    return api<RawQualityBReceive>({
      method: 'POST',
      url: '/api/method/upande_packhouse.api.quality_b_receive.receive',
      data: { opl_name: oplName },
      validateStatus: () => true,
    });
  },

  /** Transferred buckets (in-transit + shelved) for the delivery-date window,
   *  grouped by order (all farms). */
  getInTransitBuckets(fromDate: string, toDate: string): Promise<RawInTransitResponse> {
    return api<RawInTransitResponse>({
      method: 'POST',
      url: '/api/method/upande_quality.mobile.api.getInTransitBuckets',
      data: { from_date: fromDate, to_date: toDate },
      validateStatus: () => true,
    });
  },
};
