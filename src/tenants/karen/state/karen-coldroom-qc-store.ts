import { create } from 'zustand';
import {
  extractColdroomBucketId,
  karenColdroomQcRepository,
  type ColdroomBucket,
  type ColdroomParameter,
} from '@/src/tenants/karen/repository/karen-coldroom-qc-repository';

/** One reject line: a QC parameter (reason) + the stems rejected for it. */
export type ColdroomRejectRow = { id: number; reason: string; reasonLabel: string; stems: string };

export type SubmitOutcome = { kind: 'ok'; message: string } | { kind: 'error'; message: string };

type State = {
  loading: boolean;
  loadError: string | null;
  parameters: ColdroomParameter[];
  categories: string[];

  scanning: boolean;
  scanError: string | null;
  bucket: ColdroomBucket | null;

  rejects: ColdroomRejectRow[];

  submitting: boolean;

  loadInitialData: () => Promise<void>;
  scanBucket: (raw: string) => Promise<{ ok: boolean; message?: string }>;
  addReject: (reasonName: string) => void;
  removeReject: (id: number) => void;
  setRejectStems: (id: number, v: string) => void;
  totalRejected: () => number;
  canSubmit: () => boolean;
  submit: () => Promise<SubmitOutcome>;
  reset: () => void;
};

export const useKarenColdroomQcStore = create<State>((set, get) => ({
  loading: false,
  loadError: null,
  parameters: [],
  categories: [],

  scanning: false,
  scanError: null,
  bucket: null,

  rejects: [],

  submitting: false,

  loadInitialData: async () => {
    set({ loading: true, loadError: null });
    const outcome = await karenColdroomQcRepository.fetchParameters();
    if (outcome.kind === 'error') {
      set({ loading: false, loadError: outcome.message });
      return;
    }
    set({ loading: false, parameters: outcome.parameters, categories: outcome.categories });
  },

  scanBucket: async (raw) => {
    const bucketId = extractColdroomBucketId(raw);
    if (!bucketId) return { ok: false, message: 'Empty scan.' };
    set({ scanning: true, scanError: null });
    const outcome = await karenColdroomQcRepository.getBucket(bucketId);
    if (outcome.kind === 'error') {
      set({ scanning: false, scanError: outcome.message });
      return { ok: false, message: outcome.message };
    }
    set({ scanning: false, bucket: outcome.bucket, rejects: [] });
    return { ok: true };
  },

  addReject: (reasonName) =>
    set((s) => {
      if (s.rejects.some((r) => r.reason === reasonName)) return s;
      const p = s.parameters.find((x) => x.name === reasonName);
      return {
        rejects: [
          ...s.rejects,
          {
            id: s.rejects.reduce((m, r) => Math.max(m, r.id), 0) + 1,
            reason: reasonName,
            reasonLabel: p?.label ?? reasonName,
            stems: '',
          },
        ],
      };
    }),

  removeReject: (id) => set((s) => ({ rejects: s.rejects.filter((r) => r.id !== id) })),

  setRejectStems: (id, v) =>
    set((s) => ({
      rejects: s.rejects.map((r) => (r.id === id ? { ...r, stems: v.replace(/[^0-9]/g, '') } : r)),
    })),

  totalRejected: () => get().rejects.reduce((sum, r) => sum + (Number(r.stems) || 0), 0),

  canSubmit: () => {
    const s = get();
    if (s.submitting || !s.bucket) return false;
    const total = s.rejects.reduce((sum, r) => sum + (Number(r.stems) || 0), 0);
    if (total <= 0) return false;
    // Client-side over-rejection guard (backend also enforces).
    if (total > s.bucket.availableStems) return false;
    return true;
  },

  submit: async () => {
    const s = get();
    if (!s.bucket) return { kind: 'error', message: 'Scan a bucket first.' };
    const failures = s.rejects
      .map((r) => ({ reason: r.reason, stems: Number(r.stems) || 0 }))
      .filter((r) => r.reason && r.stems > 0);
    if (!failures.length) return { kind: 'error', message: 'Add at least one reason with stems.' };
    const total = failures.reduce((sum, r) => sum + r.stems, 0);
    if (total > s.bucket.availableStems) {
      return {
        kind: 'error',
        message: `Cannot reject ${total} stems; only ${s.bucket.availableStems} available.`,
      };
    }

    set({ submitting: true });
    const outcome = await karenColdroomQcRepository.save(s.bucket.bucketId, failures);
    if (outcome.kind === 'ok') {
      set({ submitting: false, bucket: null, rejects: [] });
      return { kind: 'ok', message: outcome.message };
    }
    set({ submitting: false });
    return { kind: 'error', message: outcome.message };
  },

  reset: () => set({ bucket: null, rejects: [], scanError: null }),
}));
