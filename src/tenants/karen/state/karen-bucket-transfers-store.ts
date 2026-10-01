import { create } from 'zustand';
import { addDays, format } from 'date-fns';
import {
  karenBucketTransfersRepository,
  type TransferGroup,
} from '../repository/karen-bucket-transfers-repository';
import { mapAxiosError } from '@/src/core/api/client';

/** The status tabs, in the order an order moves through them. */
export type TransferTab = 'none' | 'progress' | 'ready' | 'issued';

/** Last result per delivery date for this app session, so revisiting a date
 *  (or reopening the screen) shows it at once while a fresh load runs. */
const cache = new Map<string, TransferGroup[]>();

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
  tab: 'none',
  groups: [],
  loading: false,
  error: null,
  loaded: false,

  setTab: (t) => set({ tab: t }),

  stepDate: async (deltaDays) => {
    const next = isoDay(addDays(new Date(get().date + 'T00:00:00'), deltaDays));
    // Never show the previous day's orders under the new date.
    const cached = cache.get(next);
    set({ date: next, groups: cached ?? [], loaded: !!cached, error: null });
    await get().load();
  },

  load: async () => {
    const day = get().date;
    const cached = cache.get(day);
    if (cached && get().groups.length === 0) set({ groups: cached, loaded: true });
    set({ loading: true, error: null });
    try {
      const outcome = await karenBucketTransfersRepository.fetchInTransit(day, day);
      // Ignore a reply for a date the user has already stepped away from.
      if (get().date !== day) return;
      if (outcome.kind === 'ok') {
        cache.set(day, outcome.groups);
        set({ groups: outcome.groups, loading: false, loaded: true });
      } else {
        set({ loading: false, error: outcome.message, loaded: true });
      }
    } catch (err) {
      if (get().date !== day) return;
      set({ loading: false, error: mapAxiosError(err).message, loaded: true });
    }
  },

  reset: () =>
    set({
      date: isoDay(addDays(new Date(), 1)),
      tab: 'none',
      groups: [],
      loading: false,
      error: null,
      loaded: false,
    }),
}));

export type { TransferGroup };
