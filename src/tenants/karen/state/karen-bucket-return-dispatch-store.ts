import { create } from 'zustand';
import {
  karenBucketReturnRepository,
  type DispatchOutcome,
  type Ref,
  type ScannedBucket,
} from '../repository/karen-bucket-return-repository';
import { useAuthStore } from '@/src/core/auth/store';
import { mapAxiosError } from '@/src/core/api/client';

function nowStr(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

type State = {
  farms: Ref[];
  vehicles: Ref[];
  refsLoading: boolean;
  farm: string | null;
  vehicle: string | null;
  buckets: ScannedBucket[];
  submitting: boolean;

  loadRefs: (defaultFarm: string) => Promise<void>;
  setFarm: (f: string) => void;
  setVehicle: (v: string) => void;
  /** Add a scanned bucket (deduped). Returns a hint for the toast. */
  addScan: (raw: string) => { ok: boolean; message?: string };
  remove: (bucketId: string) => void;
  submit: () => Promise<DispatchOutcome>;
  reset: () => void;
};

export const useKarenBucketReturnDispatchStore = create<State>((set, get) => ({
  farms: [],
  vehicles: [],
  refsLoading: false,
  farm: null,
  vehicle: null,
  buckets: [],
  submitting: false,

  loadRefs: async (defaultFarm) => {
    set({ refsLoading: true });
    try {
      const [farms, vehicles] = await Promise.all([
        karenBucketReturnRepository.loadFarms(),
        karenBucketReturnRepository.loadVehicles(),
      ]);
      set({ farms, vehicles, refsLoading: false, farm: get().farm ?? defaultFarm });
    } catch {
      set({ refsLoading: false, farm: get().farm ?? defaultFarm });
    }
  },

  setFarm: (f) => set({ farm: f }),
  setVehicle: (v) => set({ vehicle: v }),

  addScan: (raw) => {
    const id = karenBucketReturnRepository.extractBucketIdFromScan(raw);
    if (!id) return { ok: false, message: 'Please scan a valid bucket QR code.' };
    if (get().buckets.some((b) => b.bucketId.toUpperCase() === id.toUpperCase())) {
      return { ok: false, message: `${id} already scanned.` };
    }
    set((s) => ({ buckets: [{ bucketId: id, scannedTime: nowStr() }, ...s.buckets] }));
    return { ok: true, message: `${id} added.` };
  },

  remove: (bucketId) => set((s) => ({ buckets: s.buckets.filter((b) => b.bucketId !== bucketId) })),

  submit: async () => {
    const { farm, vehicle, buckets } = get();
    if (!farm) return { kind: 'error', message: 'Pick a destination farm.' };
    if (!buckets.length) return { kind: 'error', message: 'Scan at least one bucket.' };
    set({ submitting: true });
    try {
      const outcome = await karenBucketReturnRepository.createDispatch({
        farm,
        vehicle: vehicle ?? '',
        user: useAuthStore.getState().email,
        buckets,
      });
      set({ submitting: false });
      if (outcome.kind === 'success') set({ buckets: [], vehicle: null });
      return outcome;
    } catch (err) {
      set({ submitting: false });
      return { kind: 'error', message: mapAxiosError(err).message };
    }
  },

  reset: () => set({ buckets: [], vehicle: null, submitting: false }),
}));
