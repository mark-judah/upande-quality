import { api } from '@/src/core/api/client';

export type RawNotShelvedBucket = {
  bucket?: string;
  farm?: string;
  greenhouse?: string;
  varieties?: string[];
  stems?: number;
  last_received?: string;
};

export type RawNotShelvedResponse = {
  message?: { date?: string; farm?: string; buckets?: RawNotShelvedBucket[]; error?: string };
};

/** The buckets behind the Quality home's Received Not Shelved tile. Backed by
 *  upande_quality.mobile.api.getReceivedNotShelvedBuckets. */
export const karenNotShelvedApi = {
  async fetch(params: {
    date: string;
    farm?: string;
    stationFarm?: string;
    company?: string;
  }): Promise<RawNotShelvedResponse> {
    return api<RawNotShelvedResponse>({
      method: 'GET',
      url: '/api/method/upande_quality.mobile.api.getReceivedNotShelvedBuckets',
      params: {
        date: params.date,
        ...(params.farm !== undefined ? { farm: params.farm } : {}),
        ...(params.stationFarm ? { station_farm: params.stationFarm } : {}),
        ...(params.company ? { company: params.company } : {}),
      },
    });
  },
};
