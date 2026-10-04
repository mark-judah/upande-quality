import { api } from '@/src/core/api/client';

export type RawFarm = { name: string; farm_name?: string };
export type RawWarehouse = { name: string; disabled?: 0 | 1 };

export type RawList<T> = { data?: T[] };

export const stationApi = {
  /** `company`: only that company's farms (a site can hold several companies). */
  fetchFarms(company?: string): Promise<RawList<RawFarm>> {
    return api<RawList<RawFarm>>({
      method: 'GET',
      url: '/api/resource/Farm',
      params: {
        fields: '["*"]',
        limit: 1000,
        ...(company ? { filters: JSON.stringify([['company', '=', company]]) } : {}),
      },
    });
  },
  fetchWarehouses(): Promise<RawList<RawWarehouse>> {
    return api<RawList<RawWarehouse>>({
      method: 'GET',
      url: '/api/resource/Warehouse',
      params: {
        fields: '["*"]',
        filters: '[["disabled","=","0"]]',
        limit: 5000,
      },
    });
  },
};
