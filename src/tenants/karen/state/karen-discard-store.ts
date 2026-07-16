import { create } from 'zustand';
import {
  karenDiscardRepository,
  type DiscardListBucket,
  type DiscardOutcome,
} from '../repository/karen-discard-repository';
import { mapAxiosError } from '@/src/core/api/client';

type State = {
  /** The farm's discard work-list (buckets on Approved Discard Requests). */
  buckets: DiscardListBucket[];
  listLoading: boolean;
  listError: string | null;
  /** bucket_ids discarded this session (lower-cased), so the UI can mark them. */
  discardedIds: string[];
  /** bucket_id currently being discarded (lower-cased), for per-row spinners. */
  discardingId: string | null;
  lastOutcome: DiscardOutcome | null;

  loadList: (farm: string) => Promise<void>;
  /** Discard one listed bucket. Rejects anything not on the list. */
  discard: (bucketId: string, farm: string) => Promise<DiscardOutcome>;
  /** Extract a bucket_id from a scan, then discard it (list-restricted). */
  submitScan: (rawBucket: string, farm: string) => Promise<DiscardOutcome>;
  reset: () => void;
};

const norm = (id: string): string => id.trim().toLowerCase();

export const useKarenDiscardStore = create<State>((set, get) => ({
  buckets: [],
  listLoading: false,
  listError: null,
  discardedIds: [],
  discardingId: null,
  lastOutcome: null,

  loadList: async (farm) => {
    set({ listLoading: true, listError: null });
    const outcome = await karenDiscardRepository.fetchDiscardList(farm);
    if (outcome.kind === 'ok') {
      set({ buckets: outcome.buckets, listLoading: false });
    } else {
      set({ listLoading: false, listError: outcome.message });
    }
  },

  discard: async (bucketId, farm) => {
    const id = norm(bucketId);
    // Enforce "can't discard what isn't on the list" (server re-checks too).
    const onList = get().buckets.some((b) => norm(b.bucketId) === id);
    if (!onList) {
      const out: DiscardOutcome = {
        kind: 'error',
        message: `${bucketId} is not on the discard list.`,
      };
      set({ lastOutcome: out });
      return out;
    }
    if (get().discardedIds.includes(id)) {
      const out: DiscardOutcome = { kind: 'error', message: `${bucketId} is already discarded.` };
      set({ lastOutcome: out });
      return out;
    }
    set({ discardingId: id });
    try {
      const outcome = await karenDiscardRepository.submit(bucketId, {
        fromDiscardRequest: true,
        farm,
      });
      set((s) => ({
        discardingId: null,
        lastOutcome: outcome,
        discardedIds:
          outcome.kind === 'success' ? [...s.discardedIds, id] : s.discardedIds,
      }));
      return outcome;
    } catch (err) {
      const out: DiscardOutcome = { kind: 'error', message: mapAxiosError(err).message };
      set({ discardingId: null, lastOutcome: out });
      return out;
    }
  },

  submitScan: async (rawBucket, farm) => {
    const bucketId = karenDiscardRepository.extractBucketIdFromScan(rawBucket);
    if (!bucketId) {
      const out: DiscardOutcome = { kind: 'error', message: 'Please scan a valid bucket QR code.' };
      set({ lastOutcome: out });
      return out;
    }
    return get().discard(bucketId, farm);
  },

  reset: () =>
    set({
      buckets: [],
      listLoading: false,
      listError: null,
      discardedIds: [],
      discardingId: null,
      lastOutcome: null,
    }),
}));
