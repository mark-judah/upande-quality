import { create } from 'zustand';
import { mapAxiosError } from '@/src/core/api/client';
import type {
  BucketOplAllocation,
  BucketReplaceOutcome,
  BunchMoveOutcome,
  BunchMovePayload,
  DetailsCorrectionOutcome,
  DetailsCorrectionPayload,
  PendingBunch,
  ReplacementCandidatesResult,
  ReplacementRepository,
  StemReplaceOutcome,
} from './types';

type State = {
  /** Whether an action (replace/move) is currently in flight. */
  acting: boolean;

  /** Bucket candidate lookups. */
  bucketCandidatesLoading: boolean;
  bucketCandidatesError: string | null;
  bucketCandidates: ReplacementCandidatesResult | null;

  /** OPLs currently allocated to the scanned bucket — used to scope replacement. */
  bucketOplsLoading: boolean;
  bucketOplsError: string | null;
  bucketOpls: BucketOplAllocation[];

  /** Bunch destination lookups (dynamic — refetched when corrected variety/length changes). */
  bunchDestinationsLoading: boolean;
  bunchDestinationsError: string | null;
  bunchDestinations: ReplacementCandidatesResult | null;

  /** Pending reshelving inbox. */
  pendingLoading: boolean;
  pendingError: string | null;
  pending: PendingBunch[];

  loadBucketCandidates: (repo: ReplacementRepository, bucketId: string) => Promise<void>;
  loadBucketOpls: (repo: ReplacementRepository, bucketId: string) => Promise<void>;
  loadBunchDestinations: (
    repo: ReplacementRepository,
    variety: string,
    stemLength: string,
    farm: string,
    excludeBucket?: string,
  ) => Promise<void>;
  loadPending: (repo: ReplacementRepository) => Promise<void>;

  replaceBucket: (
    repo: ReplacementRepository,
    bucketId: string,
    newBucketId: string,
    pickListItem: string,
  ) => Promise<BucketReplaceOutcome>;
  moveBunch: (
    repo: ReplacementRepository,
    payload: BunchMovePayload,
  ) => Promise<BunchMoveOutcome>;
  replaceStems: (
    repo: ReplacementRepository,
    payload: { pickListItem: string; donorBucketId: string; stems: number; reason?: string },
  ) => Promise<StemReplaceOutcome>;
  replaceBunchInOpl: (
    repo: ReplacementRepository,
    payload: { pickListItem: string; donorBucketId: string; stems?: number; reason?: string },
  ) => Promise<StemReplaceOutcome>;
  correctDetails: (
    repo: ReplacementRepository,
    payload: DetailsCorrectionPayload,
  ) => Promise<DetailsCorrectionOutcome>;

  reset: () => void;
};

export const useReplacementStore = create<State>((set) => ({
  acting: false,

  bucketCandidatesLoading: false,
  bucketCandidatesError: null,
  bucketCandidates: null,

  bucketOplsLoading: false,
  bucketOplsError: null,
  bucketOpls: [],

  bunchDestinationsLoading: false,
  bunchDestinationsError: null,
  bunchDestinations: null,

  pendingLoading: false,
  pendingError: null,
  pending: [],

  loadBucketCandidates: async (repo, bucketId) => {
    set({ bucketCandidatesLoading: true, bucketCandidatesError: null, bucketCandidates: null });
    try {
      const res = await repo.listBucketCandidates(bucketId);
      set({ bucketCandidates: res, bucketCandidatesLoading: false });
    } catch (err) {
      const e = mapAxiosError(err);
      set({ bucketCandidatesError: e.message, bucketCandidatesLoading: false });
    }
  },

  loadBucketOpls: async (repo, bucketId) => {
    set({ bucketOplsLoading: true, bucketOplsError: null, bucketOpls: [] });
    try {
      const list = await repo.listBucketOpls(bucketId);
      set({ bucketOpls: list, bucketOplsLoading: false });
    } catch (err) {
      const e = mapAxiosError(err);
      set({ bucketOplsError: e.message, bucketOplsLoading: false });
    }
  },

  loadBunchDestinations: async (repo, variety, stemLength, farm, excludeBucket) => {
    // Clear stale data immediately so the UI doesn't show old destinations
    // while the new query (with potentially different criteria) is in flight.
    set({
      bunchDestinationsLoading: true,
      bunchDestinationsError: null,
      bunchDestinations: null,
    });
    try {
      const res = await repo.listBunchDestinations(variety, stemLength, farm, excludeBucket);
      set({ bunchDestinations: res, bunchDestinationsLoading: false });
    } catch (err) {
      const e = mapAxiosError(err);
      set({ bunchDestinationsError: e.message, bunchDestinationsLoading: false });
    }
  },

  loadPending: async (repo) => {
    set({ pendingLoading: true, pendingError: null });
    try {
      const list = await repo.listPendingReshelving();
      set({ pending: list, pendingLoading: false });
    } catch (err) {
      const e = mapAxiosError(err);
      set({ pendingError: e.message, pendingLoading: false });
    }
  },

  replaceBucket: async (repo, bucketId, newBucketId, pickListItem) => {
    set({ acting: true });
    try {
      const outcome = await repo.replaceBucket(bucketId, newBucketId, pickListItem);
      set({ acting: false });
      return outcome;
    } catch (err) {
      const e = mapAxiosError(err);
      set({ acting: false });
      return { ok: false, error: e.message };
    }
  },

  moveBunch: async (repo, payload) => {
    set({ acting: true });
    try {
      const outcome = await repo.moveBunch(payload);
      set({ acting: false });
      return outcome;
    } catch (err) {
      const e = mapAxiosError(err);
      set({ acting: false });
      return { ok: false, error: e.message };
    }
  },

  replaceStems: async (repo, payload) => {
    set({ acting: true });
    try {
      const outcome = await repo.replaceStems(payload);
      set({ acting: false });
      return outcome;
    } catch (err) {
      const e = mapAxiosError(err);
      set({ acting: false });
      return { ok: false, error: e.message };
    }
  },

  replaceBunchInOpl: async (repo, payload) => {
    set({ acting: true });
    try {
      const outcome = await repo.replaceBunchInOpl(payload);
      set({ acting: false });
      return outcome;
    } catch (err) {
      const e = mapAxiosError(err);
      set({ acting: false });
      return { ok: false, error: e.message };
    }
  },

  correctDetails: async (repo, payload) => {
    set({ acting: true });
    try {
      const outcome = await repo.correctDetails(payload);
      set({ acting: false });
      return outcome;
    } catch (err) {
      const e = mapAxiosError(err);
      set({ acting: false });
      return { ok: false, error: e.message };
    }
  },

  reset: () =>
    set({
      acting: false,
      bucketCandidatesLoading: false,
      bucketCandidatesError: null,
      bucketCandidates: null,
      bucketOplsLoading: false,
      bucketOplsError: null,
      bucketOpls: [],
      bunchDestinationsLoading: false,
      bunchDestinationsError: null,
      bunchDestinations: null,
      pendingLoading: false,
      pendingError: null,
      pending: [],
    }),
}));
