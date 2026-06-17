import { create } from 'zustand';
import {
  karenBucketRequestsRepository,
  type AllocationItem,
  type SavedTrolley,
} from '../repository/karen-bucket-requests-repository';
import { mapAxiosError } from '@/src/core/api/client';

export type TrolleyStatus = 'scanning' | 'saving' | 'saved';

/** A trolley being filled on-device. Lives only in the store until the user
 *  hits Save — at which point it transitions through `saving` → `saved`. */
export type LocalTrolley = {
  trolleyId: string;
  /** Snapshot of every bucket assigned to this trolley. Kept here (rather
   *  than only as an `assignedMap`) so we can render an ordered, removable
   *  list of buckets per trolley. */
  buckets: AllocationItem[];
  status: TrolleyStatus;
};

type State = {
  // ── Pick list ─────────────────────────────────────────────────────────
  loading: boolean;
  loadError: string | null;
  /** Everything the server returned for this farm, untouched. */
  allItems: AllocationItem[];
  /** Bucket IDs the operator has scanned into a trolley this session. */
  assigned: Set<string>;
  /** Mapping bucketId → trolleyId, used for "already-on-trolley" guard. */
  assignedTo: Record<string, string>;
  /** Trolleys being filled, keyed by trolleyId. */
  trolleys: Record<string, LocalTrolley>;
  /** Order of trolley creation — used to render newest-last in the UI. */
  trolleyOrder: string[];
  activeTrolleyId: string | null;
  vehicles: string[];

  // ── Saved trolleys tab ────────────────────────────────────────────────
  savedLoading: boolean;
  savedError: string | null;
  savedTrolleys: SavedTrolley[];

  // ── Misc ──────────────────────────────────────────────────────────────
  saving: boolean;
  loadingToTruck: Record<string, boolean>;
  deleting: Record<string, boolean>;

  // ── Actions ───────────────────────────────────────────────────────────
  loadPickList: (farm: string) => Promise<{ ok: boolean; message?: string }>;
  setTrolleyFromScan: (raw: string) => { ok: boolean; message?: string; trolleyId?: string };
  clearActiveTrolley: () => void;
  assignBucketFromScan: (raw: string) => { ok: boolean; message?: string };
  removeBucket: (bucketId: string) => void;
  saveAllUnsaved: () => Promise<{ ok: boolean; message?: string }>;
  loadSaved: (farm: string) => Promise<{ ok: boolean; message?: string }>;
  loadTrolleyInTruck: (
    trolleyId: string,
    truckId: string,
  ) => Promise<{ ok: boolean; message?: string }>;
  deleteSavedTrolley: (
    trolleyId: string,
    farm: string,
  ) => Promise<{ ok: boolean; message?: string }>;
  clearSavedTrolleys: (farm: string) => Promise<{ ok: boolean; message?: string }>;
  reset: () => void;
};

const initial = {
  loading: false,
  loadError: null as string | null,
  allItems: [] as AllocationItem[],
  assigned: new Set<string>(),
  assignedTo: {} as Record<string, string>,
  trolleys: {} as Record<string, LocalTrolley>,
  trolleyOrder: [] as string[],
  activeTrolleyId: null as string | null,
  vehicles: [] as string[],
  savedLoading: false,
  savedError: null as string | null,
  savedTrolleys: [] as SavedTrolley[],
  saving: false,
  loadingToTruck: {} as Record<string, boolean>,
  deleting: {} as Record<string, boolean>,
};

export const useKarenBucketRequestsStore = create<State>((set, get) => ({
  ...initial,

  loadPickList: async (farm) => {
    set({ loading: true, loadError: null });
    try {
      const outcome = await karenBucketRequestsRepository.fetchAllocations(farm);
      if (outcome.kind === 'error') {
        set({ loading: false, loadError: outcome.message });
        return { ok: false, message: outcome.message };
      }
      set({
        loading: false,
        loadError: null,
        allItems: outcome.items,
        vehicles: outcome.vehicles,
      });
      return { ok: true };
    } catch (err) {
      const message = mapAxiosError(err).message;
      set({ loading: false, loadError: message });
      return { ok: false, message };
    }
  },

  setTrolleyFromScan: (raw) => {
    const trolleyId = karenBucketRequestsRepository.extractTrolleyIdFromScan(raw);
    if (!trolleyId) return { ok: false, message: 'Not a trolley QR code.' };
    set((s) => {
      const existing = s.trolleys[trolleyId];
      const trolleys = existing
        ? s.trolleys
        : {
            ...s.trolleys,
            [trolleyId]: { trolleyId, buckets: [], status: 'scanning' as TrolleyStatus },
          };
      const trolleyOrder = existing ? s.trolleyOrder : [...s.trolleyOrder, trolleyId];
      return { trolleys, trolleyOrder, activeTrolleyId: trolleyId };
    });
    return { ok: true, trolleyId };
  },

  clearActiveTrolley: () => set({ activeTrolleyId: null }),

  assignBucketFromScan: (raw) => {
    const scanned = karenBucketRequestsRepository.extractBucketIdFromScan(raw);
    if (!scanned) return { ok: false, message: 'Not a bucket QR code.' };
    const s = get();
    if (!s.activeTrolleyId) {
      return { ok: false, message: 'Scan the trolley first.' };
    }
    // Match the pick list case-insensitively (a scan of ABCD should resolve to
    // a pick-list entry AbcD). Then adopt the pick list's own casing as the
    // canonical id for assignment keys and the save payload, so everything
    // downstream stays consistent.
    const bucket = s.allItems.find(
      (b) => b.bucketId.toLowerCase() === scanned.toLowerCase(),
    );
    if (!bucket) {
      return { ok: false, message: `Bucket ${scanned} is not on the pick list.` };
    }
    const bucketId = bucket.bucketId;
    if (s.assigned.has(bucketId)) {
      const t = s.assignedTo[bucketId];
      return {
        ok: false,
        message: t ? `Already on trolley ${t}.` : 'Already assigned.',
      };
    }
    const trolleyId = s.activeTrolleyId;
    set((cur) => {
      const trolley = cur.trolleys[trolleyId];
      if (!trolley) return cur;
      const nextAssigned = new Set(cur.assigned);
      nextAssigned.add(bucketId);
      return {
        assigned: nextAssigned,
        assignedTo: { ...cur.assignedTo, [bucketId]: trolleyId },
        trolleys: {
          ...cur.trolleys,
          [trolleyId]: { ...trolley, buckets: [...trolley.buckets, bucket] },
        },
      };
    });
    return { ok: true, message: `${bucketId} → ${trolleyId}` };
  },

  removeBucket: (bucketId) => {
    set((cur) => {
      const trolleyId = cur.assignedTo[bucketId];
      if (!trolleyId) return cur;
      const trolley = cur.trolleys[trolleyId];
      const nextAssigned = new Set(cur.assigned);
      nextAssigned.delete(bucketId);
      const { [bucketId]: _removed, ...restAssignedTo } = cur.assignedTo;
      void _removed;
      const filteredBuckets = trolley
        ? trolley.buckets.filter((b) => b.bucketId !== bucketId)
        : [];
      // If the trolley is now empty AND we haven't saved it yet, drop it
      // entirely — keeps the UI clean.
      if (trolley && trolley.status === 'scanning' && filteredBuckets.length === 0) {
        const { [trolleyId]: _t, ...restTrolleys } = cur.trolleys;
        void _t;
        return {
          assigned: nextAssigned,
          assignedTo: restAssignedTo,
          trolleys: restTrolleys,
          trolleyOrder: cur.trolleyOrder.filter((id) => id !== trolleyId),
          activeTrolleyId: cur.activeTrolleyId === trolleyId ? null : cur.activeTrolleyId,
        };
      }
      return {
        assigned: nextAssigned,
        assignedTo: restAssignedTo,
        trolleys: trolley
          ? { ...cur.trolleys, [trolleyId]: { ...trolley, buckets: filteredBuckets } }
          : cur.trolleys,
      };
    });
  },

  saveAllUnsaved: async () => {
    const s = get();
    const unsaved = s.trolleyOrder
      .map((id) => s.trolleys[id])
      .filter((t): t is LocalTrolley => !!t && t.status === 'scanning' && t.buckets.length > 0);
    if (unsaved.length === 0) {
      return { ok: false, message: 'Nothing to save.' };
    }
    set({ saving: true });
    // Mark all as saving up-front so the UI gives feedback immediately.
    set((cur) => {
      const trolleys = { ...cur.trolleys };
      for (const t of unsaved) trolleys[t.trolleyId] = { ...t, status: 'saving' };
      return { trolleys };
    });
    try {
      let okCount = 0;
      let firstErr: string | null = null;
      for (const t of unsaved) {
        const outcome = await karenBucketRequestsRepository.saveTrolley({
          trolleyId: t.trolleyId,
          buckets: t.buckets.map((b) => ({ oplName: b.oplName, bucketId: b.bucketId })),
        });
        set((cur) => {
          const trolley = cur.trolleys[t.trolleyId];
          if (!trolley) return cur;
          return {
            trolleys: {
              ...cur.trolleys,
              [t.trolleyId]: {
                ...trolley,
                status: outcome.kind === 'ok' ? 'saved' : 'scanning',
              },
            },
          };
        });
        if (outcome.kind === 'ok') okCount++;
        else if (!firstErr) firstErr = outcome.message;
      }
      set({ saving: false });
      if (okCount === 0) {
        return { ok: false, message: firstErr ?? 'Save failed.' };
      }
      return {
        ok: true,
        message: `Saved ${okCount} trolley${okCount === 1 ? '' : 's'}.${firstErr ? ' (Some failed.)' : ''}`,
      };
    } catch (err) {
      set({ saving: false });
      // Revert any still-saving trolleys
      set((cur) => {
        const trolleys = { ...cur.trolleys };
        for (const id of Object.keys(trolleys)) {
          if (trolleys[id].status === 'saving') {
            trolleys[id] = { ...trolleys[id], status: 'scanning' };
          }
        }
        return { trolleys };
      });
      return { ok: false, message: mapAxiosError(err).message };
    }
  },

  loadSaved: async (farm) => {
    set({ savedLoading: true, savedError: null });
    try {
      const outcome = await karenBucketRequestsRepository.loadSavedTrolleys(farm);
      if (outcome.kind === 'error') {
        set({ savedLoading: false, savedError: outcome.message });
        return { ok: false, message: outcome.message };
      }
      set({ savedLoading: false, savedTrolleys: outcome.trolleys });
      return { ok: true };
    } catch (err) {
      const message = mapAxiosError(err).message;
      set({ savedLoading: false, savedError: message });
      return { ok: false, message };
    }
  },

  loadTrolleyInTruck: async (trolleyId, truckId) => {
    set((cur) => ({
      loadingToTruck: { ...cur.loadingToTruck, [trolleyId]: true },
    }));
    try {
      const outcome = await karenBucketRequestsRepository.loadTrolleyInTruck({
        trolleyId,
        truckId,
      });
      set((cur) => {
        const next = { ...cur.loadingToTruck };
        delete next[trolleyId];
        // Optimistically reflect the truck id on the saved trolley.
        const savedTrolleys =
          outcome.kind === 'ok'
            ? cur.savedTrolleys.map((t) =>
                t.trolleyId === trolleyId ? { ...t, truckId } : t,
              )
            : cur.savedTrolleys;
        return { loadingToTruck: next, savedTrolleys };
      });
      return outcome.kind === 'ok'
        ? { ok: true, message: outcome.message }
        : { ok: false, message: outcome.message };
    } catch (err) {
      set((cur) => {
        const next = { ...cur.loadingToTruck };
        delete next[trolleyId];
        return { loadingToTruck: next };
      });
      return { ok: false, message: mapAxiosError(err).message };
    }
  },

  deleteSavedTrolley: async (trolleyId, farm) => {
    set((cur) => ({ deleting: { ...cur.deleting, [trolleyId]: true } }));
    try {
      const outcome = await karenBucketRequestsRepository.deleteSavedTrolleys({
        trolleyIds: [trolleyId],
        farm,
      });
      if (outcome.kind === 'ok') {
        set((cur) => {
          const next = { ...cur.deleting };
          delete next[trolleyId];
          return {
            deleting: next,
            savedTrolleys: cur.savedTrolleys.filter((t) => t.trolleyId !== trolleyId),
          };
        });
        return { ok: true, message: 'Trolley cleared.' };
      }
      // error: drop the in-flight flag and re-fetch to restore truth
      set((cur) => {
        const next = { ...cur.deleting };
        delete next[trolleyId];
        return { deleting: next };
      });
      await get().loadSaved(farm);
      return { ok: false, message: outcome.message };
    } catch (err) {
      set((cur) => {
        const next = { ...cur.deleting };
        delete next[trolleyId];
        return { deleting: next };
      });
      await get().loadSaved(farm);
      return { ok: false, message: mapAxiosError(err).message };
    }
  },

  clearSavedTrolleys: async (farm) => {
    const ids = get()
      .savedTrolleys.filter((t) => !t.truckId)
      .map((t) => t.trolleyId);
    if (ids.length === 0) return { ok: false, message: 'Nothing to clear.' };
    set((cur) => {
      const deleting = { ...cur.deleting };
      for (const id of ids) deleting[id] = true;
      return { deleting };
    });
    try {
      const outcome = await karenBucketRequestsRepository.deleteSavedTrolleys({
        trolleyIds: ids,
        farm,
      });
      if (outcome.kind === 'ok') {
        const idSet = new Set(ids);
        set((cur) => {
          const next = { ...cur.deleting };
          for (const id of ids) delete next[id];
          return {
            deleting: next,
            savedTrolleys: cur.savedTrolleys.filter((t) => !idSet.has(t.trolleyId)),
          };
        });
        return {
          ok: true,
          message: `Cleared ${outcome.clearedCount} trolley${outcome.clearedCount === 1 ? '' : 's'}.`,
        };
      }
      set((cur) => {
        const next = { ...cur.deleting };
        for (const id of ids) delete next[id];
        return { deleting: next };
      });
      await get().loadSaved(farm);
      return { ok: false, message: outcome.message };
    } catch (err) {
      set((cur) => {
        const next = { ...cur.deleting };
        for (const id of ids) delete next[id];
        return { deleting: next };
      });
      await get().loadSaved(farm);
      return { ok: false, message: mapAxiosError(err).message };
    }
  },

  reset: () => set({ ...initial, assigned: new Set() }),
}));
