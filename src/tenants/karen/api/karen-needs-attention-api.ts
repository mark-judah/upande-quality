import { api } from '@/src/core/api/client';

export type RawAttentionItem = {
  /** 'reshelve': a bunch graded out of a bucket waiting to be reshelved;
   *  'replacement': an open Bucket Replacement. */
  kind?: 'reshelve' | 'replacement';
  name?: string;
  bucket?: string;
  bunch?: string;
  farm?: string;
  variety?: string;
  stem_length?: string;
  stems?: number;
  reason?: string;
  since?: string;
};

export type RawNeedsAttentionResponse = {
  message?: { farm?: string; items?: RawAttentionItem[]; error?: string };
};

/** What the Quality home's Needs Attention tile counts. Backed by
 *  upande_quality.mobile.api.getNeedsAttentionBuckets. */
export const karenNeedsAttentionApi = {
  async fetch(params: { farm?: string; stationFarm?: string; company?: string }): Promise<RawNeedsAttentionResponse> {
    return api<RawNeedsAttentionResponse>({
      method: 'GET',
      url: '/api/method/upande_quality.mobile.api.getNeedsAttentionBuckets',
      params: {
        ...(params.farm !== undefined ? { farm: params.farm } : {}),
        ...(params.stationFarm ? { station_farm: params.stationFarm } : {}),
        ...(params.company ? { company: params.company } : {}),
      },
    });
  },
};
