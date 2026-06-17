import { create } from 'zustand';
import {
  karenShelvingRepository,
  type ShelvingOutcome,
} from '../repository/karen-shelving-repository';
import { mapAxiosError } from '@/src/core/api/client';

type State = {
  /** Sticky between bucket scans — operators load many buckets onto one shelf. */
  shelfId: string | null;
  loading: boolean;
  lastOutcome: ShelvingOutcome | null;

  setShelfFromScan: (raw: string) => { ok: boolean; message?: string; shelfId?: string };
  clearShelf: () => void;
  submitBucket: (
    rawBucket: string,
    userFarm: string,
  ) => Promise<ShelvingOutcome>;
  reset: () => void;
};

export const useKarenShelvingStore = create<State>((set, get) => ({
  shelfId: null,
  loading: false,
  lastOutcome: null,

  setShelfFromScan: (raw) => {
    const shelfId = karenShelvingRepository.extractShelfIdFromScan(raw);
    if (!shelfId) {
      return { ok: false, message: 'Please scan a valid shelf QR code.' };
    }
    set({ shelfId, lastOutcome: null });
    return { ok: true, shelfId };
  },

  clearShelf: () => set({ shelfId: null, lastOutcome: null }),

  submitBucket: async (rawBucket, userFarm) => {
    const state = get();
    if (!state.shelfId) {
      const out: ShelvingOutcome = {
        kind: 'error',
        message: 'Scan the shelf QR code first.',
      };
      set({ lastOutcome: out });
      return out;
    }
    const bucketId = karenShelvingRepository.extractBucketIdFromScan(rawBucket);
    if (!bucketId) {
      const out: ShelvingOutcome = {
        kind: 'error',
        message: 'Please scan a valid bucket QR code.',
      };
      set({ lastOutcome: out });
      return out;
    }
    set({ loading: true });
    try {
      const outcome = await karenShelvingRepository.submit({
        farm: userFarm,
        shelfId: state.shelfId,
        bucketId,
      });
      set({ loading: false, lastOutcome: outcome });
      return outcome;
    } catch (err) {
      const message = mapAxiosError(err).message;
      const out: ShelvingOutcome = { kind: 'error', message };
      set({ loading: false, lastOutcome: out });
      return out;
    }
  },

  reset: () => set({ shelfId: null, loading: false, lastOutcome: null }),
}));
