import { api } from '@/src/core/api/client';

export type RawNotReceivedBucket = {
  bucket?: string;
  farm?: string;
  greenhouse?: string;
  varieties?: string[];
  stems?: number;
  last_harvest?: string;
};

export type RawNotReceivedResponse = {
  message?: { date?: string; farm?: string; buckets?: RawNotReceivedBucket[]; error?: string };
};

/** The buckets behind the Quality home's Not Received tile. Backed by
 *  upande_quality.mobile.api.getNotReceivedBuckets. */
export const karenNotReceivedApi = {
  async fetch(params: {
    date: string;
    farm?: string;
    stationFarm?: string;
    company?: string;
  }): Promise<RawNotReceivedResponse> {
    return api<RawNotReceivedResponse>({
      method: 'GET',
      url: '/api/method/upande_quality.mobile.api.getNotReceivedBuckets',
      params: {
        date: params.date,
        ...(params.farm !== undefined ? { farm: params.farm } : {}),
        ...(params.stationFarm ? { station_farm: params.stationFarm } : {}),
        ...(params.company ? { company: params.company } : {}),
      },
    });
  },
};
