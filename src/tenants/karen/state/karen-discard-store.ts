import { create } from 'zustand';
import {
  karenDiscardRepository,
  type DiscardOutcome,
} from '../repository/karen-discard-repository';
import { mapAxiosError } from '@/src/core/api/client';

type State = {
  loading: boolean;
  lastOutcome: DiscardOutcome | null;
  submitScan: (rawBucket: string) => Promise<DiscardOutcome>;
  reset: () => void;
};

export const useKarenDiscardStore = create<State>((set) => ({
  loading: false,
  lastOutcome: null,
  submitScan: async (rawBucket) => {
    const bucketId = karenDiscardRepository.extractBucketIdFromScan(rawBucket);
    if (!bucketId) {
      const out: DiscardOutcome = {
        kind: 'error',
        message: 'Please scan a valid bucket QR code.',
      };
      set({ lastOutcome: out });
      return out;
    }
    set({ loading: true });
    try {
      const outcome = await karenDiscardRepository.submit(bucketId);
      set({ loading: false, lastOutcome: outcome });
      return outcome;
    } catch (err) {
      const message = mapAxiosError(err).message;
      const out: DiscardOutcome = { kind: 'error', message };
      set({ loading: false, lastOutcome: out });
      return out;
    }
  },
  reset: () => set({ loading: false, lastOutcome: null }),
}));
