import { create } from 'zustand';
import {
  karenBucketReturnRepository,
  type ReceiptOutcome,
} from '../repository/karen-bucket-return-repository';
import { useAuthStore } from '@/src/core/auth/store';
import { mapAxiosError } from '@/src/core/api/client';

type State = {
  receiving: boolean;
  received: { name: string; count: number }[];
  receiveScan: (raw: string, farm: string) => Promise<ReceiptOutcome>;
  reset: () => void;
};

export const useKarenBucketReturnReceiptStore = create<State>((set) => ({
  receiving: false,
  received: [],

  receiveScan: async (raw, farm) => {
    const id = karenBucketReturnRepository.extractBucketIdFromScan(raw);
    if (!id) return { kind: 'error', message: 'Please scan a valid bucket QR code.' };
    set({ receiving: true });
    try {
      const outcome = await karenBucketReturnRepository.receiveScan(id, farm, useAuthStore.getState().email);
      set((s) => ({
        receiving: false,
        received: outcome.kind === 'success' ? [{ name: outcome.name, count: outcome.count }, ...s.received] : s.received,
      }));
      return outcome;
    } catch (err) {
      set({ receiving: false });
      return { kind: 'error', message: mapAxiosError(err).message };
    }
  },

  reset: () => set({ receiving: false, received: [] }),
}));
