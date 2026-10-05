import { create } from 'zustand';
import { stationRepository, type Farm } from './repository';
import type { Tenant } from '@/src/core/tenant/instance-mapper';
import { mapAxiosError } from '@/src/core/api/client';

type State = {
  farms: Farm[];
  greenhouses: string[];
  loading: boolean;
  error: string | null;
  load: (tenant?: Tenant | null) => Promise<void>;
};

export const useStationStore = create<State>((set) => ({
  farms: [],
  greenhouses: [],
  loading: false,
  error: null,
  load: async (tenant) => {
    set({ loading: true, error: null });
    try {
      const [farms, greenhouses] = await Promise.all([
        stationRepository.fetchFarms(tenant),
        stationRepository.fetchGreenhouseWarehouses(),
      ]);
      set({ farms, greenhouses, loading: false });
    } catch (err) {
      set({ loading: false, error: mapAxiosError(err).message });
    }
  },
}));
