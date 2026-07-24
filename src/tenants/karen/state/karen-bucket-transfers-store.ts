import { create } from 'zustand';
import { addDays, format } from 'date-fns';
import {
  karenBucketTransfersRepository,
  type TransferGroup,
} from '../repository/karen-bucket-transfers-repository';
import { mapAxiosError } from '@/src/core/api/client';

/** The three status tabs (order-level shelving progress). */
export type TransferTab = 'progress' | 'ready' | 'none';

function isoDay(d: Date): string {
  return format(d, 'yyyy-MM-dd');
}

type State = {
  /** Selected delivery date (single day; from == to). Defaults to tomorrow. */
  date: string;
  tab: TransferTab;
  groups: TransferGroup[];
  loading: boolean;
  error: string | null;
  loaded: boolean;

  setTab: (t: TransferTab) => void;
  /** Step the delivery date by ±1 day and reload. */
  stepDate: (deltaDays: number) => Promise<void>;
  load: () => Promise<void>;
  reset: () => void;
};

export const useKarenBucketTransfersStore = create<State>((set, get) => ({
  date: isoDay(addDays(new Date(), 1)),
  tab: 'progress',
  groups: [],
  loading: false,
  error: null,
  loaded: false,

  setTab: (t) => set({ tab: t }),

  stepDate: async (deltaDays) => {
    const next = isoDay(addDays(new Date(get().date + 'T00:00:00'), deltaDays));
    set({ date: next });
    await get().load();
  },

  load: async () => {
    const day = get().date;
    set({ loading: true, error: null });
    try {
      const outcome = await karenBucketTransfersRepository.fetchInTransit(day, day);
      if (outcome.kind === 'ok') {
        set({ groups: outcome.groups, loading: false, loaded: true });
      } else {
        set({ loading: false, error: outcome.message, loaded: true });
      }
    } catch (err) {
      set({ loading: false, error: mapAxiosError(err).message, loaded: true });
    }
  },

  reset: () =>
    set({
      date: isoDay(addDays(new Date(), 1)),
      tab: 'progress',
      groups: [],
      loading: false,
      error: null,
      loaded: false,
    }),
}));

export type { TransferGroup };
