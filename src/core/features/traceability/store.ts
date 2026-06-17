import { create } from 'zustand';
import type {
  TraceabilityQuery,
  TraceabilityRepository,
  TraceabilitySnapshot,
} from './types';
import { mapAxiosError } from '@/src/core/api/client';

type State = {
  loading: boolean;
  error: string | null;
  snapshot: TraceabilitySnapshot | null;
  scannedKind: 'bucket' | 'bunch' | null;
  scannedId: string | null;
  fetch: (repo: TraceabilityRepository, query: TraceabilityQuery) => Promise<void>;
  reset: () => void;
};

export const useTraceabilityStore = create<State>((set) => ({
  loading: false,
  error: null,
  snapshot: null,
  scannedKind: null,
  scannedId: null,
  fetch: async (repo, query) => {
    set({
      loading: true,
      error: null,
      scannedKind: query.kind,
      scannedId: query.id,
      snapshot: null,
    });
    try {
      const snapshot = await repo.lookup(query);
      set({ loading: false, snapshot });
    } catch (err) {
      const e = mapAxiosError(err);
      set({ loading: false, error: e.message, snapshot: null });
    }
  },
  reset: () =>
    set({
      loading: false,
      error: null,
      snapshot: null,
      scannedKind: null,
      scannedId: null,
    }),
}));
