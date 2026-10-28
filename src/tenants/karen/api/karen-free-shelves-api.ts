import { api } from '@/src/core/api/client';

/** One shelf that can still take a bucket. */
export type RawFreeShelf = {
  shelf?: string;
  shelf_id?: string;
  /** Distinct buckets on it now (0 = empty). */
  buckets?: number;
  /** Room left: capacity minus buckets (2 = empty shelf, 1 = one bucket on it). */
  free?: number;
};

export type RawFreeShelvesResponse = {
  message?: {
    status?: string;
    capacity?: number;
    farms?: { farm?: string; free_shelves?: number; shelves?: RawFreeShelf[] }[];
    free_shelves?: number;
    free_slots?: number;
    empty_shelves?: number;
  };
};

export const karenFreeShelvesApi = {
  /** Shelves with room, for the farms configured in Production Settings > Shelf
   *  Locations. `farm` narrows to one of them. */
  list(farm?: string): Promise<RawFreeShelvesResponse> {
    return api<RawFreeShelvesResponse>({
      method: 'GET',
      url: '/api/method/upande_quality.mobile.api.getFreeShelves',
      params: farm ? { farm } : {},
    });
  },
};
