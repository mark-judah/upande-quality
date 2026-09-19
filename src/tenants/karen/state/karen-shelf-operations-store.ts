import { create } from 'zustand';
import {
  karenShelfOperationsRepository,
  type TransferOutcome,
  type OfflineIssuingOutcome,
} from '../repository/karen-shelf-operations-repository';
import { mapAxiosError } from '@/src/core/api/client';

export type ShelfOperationsMode = 'transfer' | 'offline-removal';

type State = {
  mode: ShelfOperationsMode;
  /** Destination shelf for Transfer mode. Not used in Offline Removal mode. */
  shelfId: string | null;
  /** Free-text reason for Offline Removal mode. */
  reason: string;
  loading: boolean;
  lastTransferOutcome: TransferOutcome | null;
  lastOfflineOutcome: OfflineIssuingOutcome | null;

  setMode: (mode: ShelfOperationsMode) => void;
  setShelfFromScan: (raw: string) => { ok: boolean; message?: string; shelfId?: string };
  clearShelf: () => void;
  setReason: (reason: string) => void;
  submitTransfer: (rawBucket: string) => Promise<TransferOutcome>;
  submitOfflineRemoval: (rawBucket: string) => Promise<OfflineIssuingOutcome>;
  reset: () => void;
};

export const useKarenShelfOperationsStore = create<State>((set, get) => ({
  mode: 'transfer',
  shelfId: null,
  reason: '',
  loading: false,
  lastTransferOutcome: null,
  lastOfflineOutcome: null,

  setMode: (mode) =>
    set({ mode, shelfId: null, reason: '', lastTransferOutcome: null, lastOfflineOutcome: null }),

  setShelfFromScan: (raw) => {
    const shelfId = karenShelfOperationsRepository.extractShelfIdFromScan(raw);
    if (!shelfId) {
      return { ok: false, message: 'Please scan a valid shelf QR code.' };
    }
    set({ shelfId, lastTransferOutcome: null });
    return { ok: true, shelfId };
  },

  clearShelf: () => set({ shelfId: null, lastTransferOutcome: null }),

  setReason: (reason) => set({ reason }),

  submitTransfer: async (rawBucket) => {
    const state = get();
    if (!state.shelfId) {
      const out: TransferOutcome = { kind: 'error', message: 'Scan the destination shelf first.' };
      set({ lastTransferOutcome: out });
      return out;
    }
    const bucketId = karenShelfOperationsRepository.extractBucketIdFromScan(rawBucket);
    if (!bucketId) {
      const out: TransferOutcome = { kind: 'error', message: 'Please scan a valid bucket QR code.' };
      set({ lastTransferOutcome: out });
      return out;
    }
    set({ loading: true });
    try {
      const outcome = await karenShelfOperationsRepository.transfer({
        bucketId,
        toShelfId: state.shelfId,
      });
      set({ loading: false, lastTransferOutcome: outcome });
      return outcome;
    } catch (err) {
      const out: TransferOutcome = { kind: 'error', message: mapAxiosError(err).message };
      set({ loading: false, lastTransferOutcome: out });
      return out;
    }
  },

  submitOfflineRemoval: async (rawBucket) => {
    const state = get();
    if (!state.reason.trim()) {
      const out: OfflineIssuingOutcome = { kind: 'error', message: 'Enter a reason first.' };
      set({ lastOfflineOutcome: out });
      return out;
    }
    const bucketId = karenShelfOperationsRepository.extractBucketIdFromScan(rawBucket);
    if (!bucketId) {
      const out: OfflineIssuingOutcome = { kind: 'error', message: 'Please scan a valid bucket QR code.' };
      set({ lastOfflineOutcome: out });
      return out;
    }
    set({ loading: true });
    try {
      const outcome = await karenShelfOperationsRepository.reportOfflineRemoval({
        bucketId,
        reason: state.reason.trim(),
      });
      set({ loading: false, lastOfflineOutcome: outcome });
      return outcome;
    } catch (err) {
      const out: OfflineIssuingOutcome = { kind: 'error', message: mapAxiosError(err).message };
      set({ loading: false, lastOfflineOutcome: out });
      return out;
    }
  },

  reset: () =>
    set({
      mode: 'transfer',
      shelfId: null,
      reason: '',
      loading: false,
      lastTransferOutcome: null,
      lastOfflineOutcome: null,
    }),
}));
