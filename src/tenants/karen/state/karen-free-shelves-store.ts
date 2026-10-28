import { create } from 'zustand';
import { mapAxiosError } from '@/src/core/api/client';
import { karenFreeShelvesApi } from '../api/karen-free-shelves-api';

export type FreeShelf = {
  shelfId: string;
  farm: string;
  /** Distinct buckets on it now. */
  buckets: number;
  /** Buckets it can still take (2 on an empty shelf, 1 with one bucket on it). */
  free: number;
};

interface State {
  shelves: FreeShelf[];
  /** Farms configured on the server, in its order (the picker's options). */
  farms: string[];
  loading: boolean;
  error: string | null;
  load: () => Promise<void>;
  reset: () => void;
}

export const useKarenFreeShelvesStore = create<State>((set) => ({
  shelves: [],
  farms: [],
  loading: false,
  error: null,

  load: async () => {
    set({ loading: true, error: null });
    try {
      const raw = await karenFreeShelvesApi.list();
      const m = raw?.message;
      if (!m || m.status !== 'success') throw new Error('The server returned no shelf data.');
      const shelves: FreeShelf[] = [];
      const farms: string[] = [];
      for (const g of m.farms ?? []) {
        const farm = String(g.farm ?? '');
        if (!farm) continue;
        farms.push(farm);
        for (const sh of g.shelves ?? []) {
          shelves.push({
            shelfId: String(sh.shelf_id ?? sh.shelf ?? ''),
            farm,
            buckets: Number(sh.buckets ?? 0),
            free: Number(sh.free ?? 0),
          });
        }
      }
      set({
        shelves,
        farms,
        loading: false,
      });
    } catch (err) {
      set({ error: mapAxiosError(err).message || 'Could not load free shelves.', loading: false });
    }
  },

  reset: () => set({ shelves: [], farms: [], loading: false, error: null }),
}));
