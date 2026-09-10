import { create } from 'zustand';
import { karenReceivingRepository, type ReceivingOutcome } from '../repository/karen-receiving-repository';
import { mapAxiosError } from '@/src/core/api/client';

function generateBatchId(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let out = '';
  for (let i = 0; i < 8; i++) out += chars.charAt(Math.floor(Math.random() * chars.length));
  return out;
}

type State = {
  loading: boolean;
  lastOutcome: ReceivingOutcome | null;
  batchMode: boolean;
  batchId: string | null;
  toggleBatchMode: () => void;
  endBatch: () => void;
  submitScan: (rawScan: string) => Promise<ReceivingOutcome>;
  /** Re-submits a bucket the operator already saw the "not harvested today"
   *  popup for, telling the backend to receive it anyway against the stale
   *  harvest instead of asking again. */
  confirmReceive: (bucketId: string) => Promise<ReceivingOutcome>;
  reset: () => void;
};

export const useKarenReceivingStore = create<State>((set, get) => ({
  loading: false,
  lastOutcome: null,
  batchMode: false,
  batchId: null,

  toggleBatchMode: () => {
    const { batchMode } = get();
    if (batchMode) set({ batchMode: false, batchId: null });
    else set({ batchMode: true, batchId: generateBatchId() });
  },

  endBatch: () => set({ batchMode: false, batchId: null }),

  submitScan: async (rawScan: string): Promise<ReceivingOutcome> => {
    const bucketId = karenReceivingRepository.extractBucketIdFromScan(rawScan);
    if (!bucketId) {
      const outcome: ReceivingOutcome = { kind: 'error', message: 'Please scan a valid bucket QR code.' };
      set({ lastOutcome: outcome });
      return outcome;
    }
    set({ loading: true });
    try {
      const outcome = await karenReceivingRepository.submit(bucketId, get().batchId);
      set({ loading: false, lastOutcome: outcome });
      return outcome;
    } catch (err) {
      const e = mapAxiosError(err);
      const outcome: ReceivingOutcome = { kind: 'error', message: e.message };
      set({ loading: false, lastOutcome: outcome });
      return outcome;
    }
  },

  confirmReceive: async (bucketId: string): Promise<ReceivingOutcome> => {
    set({ loading: true });
    try {
      const outcome = await karenReceivingRepository.submit(bucketId, get().batchId, true);
      set({ loading: false, lastOutcome: outcome });
      return outcome;
    } catch (err) {
      const e = mapAxiosError(err);
      const outcome: ReceivingOutcome = { kind: 'error', message: e.message };
      set({ loading: false, lastOutcome: outcome });
      return outcome;
    }
  },

  reset: () => set({ loading: false, lastOutcome: null }),
}));
