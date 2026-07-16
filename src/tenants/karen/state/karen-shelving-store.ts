import { create } from 'zustand';
import {
  karenShelvingRepository,
  type ShelvingOutcome,
} from '../repository/karen-shelving-repository';
import { mapAxiosError } from '@/src/core/api/client';

/** Buckets per shelf — after this many successful scans the shelf auto-clears so
 *  the operator flows straight to the next shelf without tapping "Change shelf". */
const SHELF_CAPACITY = 2;

type State = {
  /** Sticky between bucket scans — operators load buckets onto one shelf. */
  shelfId: string | null;
  /** Successful buckets shelved on the CURRENT shelf (0..SHELF_CAPACITY). */
  shelfCount: number;
  /** Exposed so the UI can show a "n / capacity" hint. */
  shelfCapacity: number;
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
  shelfCount: 0,
  shelfCapacity: SHELF_CAPACITY,
  loading: false,
  lastOutcome: null,

  setShelfFromScan: (raw) => {
    const shelfId = karenShelvingRepository.extractShelfIdFromScan(raw);
    if (!shelfId) {
      return { ok: false, message: 'Please scan a valid shelf QR code.' };
    }
    // Fresh shelf — reset its bucket tally.
    set({ shelfId, shelfCount: 0, lastOutcome: null });
    return { ok: true, shelfId };
  },

  clearShelf: () => set({ shelfId: null, shelfCount: 0, lastOutcome: null }),

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
      if (outcome.kind === 'success') {
        const nextCount = get().shelfCount + 1;
        if (nextCount >= SHELF_CAPACITY) {
          // Shelf full — auto-clear so focus returns to the shelf field and the
          // operator moves to the next shelf.
          set({ loading: false, lastOutcome: outcome, shelfId: null, shelfCount: 0 });
        } else {
          set({ loading: false, lastOutcome: outcome, shelfCount: nextCount });
        }
      } else {
        set({ loading: false, lastOutcome: outcome });
      }
      return outcome;
    } catch (err) {
      const message = mapAxiosError(err).message;
      const out: ShelvingOutcome = { kind: 'error', message };
      set({ loading: false, lastOutcome: out });
      return out;
    }
  },

  reset: () => set({ shelfId: null, shelfCount: 0, loading: false, lastOutcome: null }),
}));
