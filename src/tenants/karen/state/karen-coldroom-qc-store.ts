import { create } from 'zustand';
import { useAuthStore } from '@/src/core/auth/store';
import {
  extractColdroomBucketId,
  karenColdroomQcRepository,
  type ColdroomBucket,
  type ColdroomIncharge,
  type ColdroomReason,
  type ColdroomControlPoint,
} from '@/src/tenants/karen/repository/karen-coldroom-qc-repository';

export type ColdroomRejectionRow = {
  id: string;
  variety: string;
  reason: string; // QC Parameters name (the Link value)
  reasonLabel: string; // human label for display
  stems: string; // text input, parsed on submit
  length: string;
};

export type SubmitOutcome = { kind: 'ok'; message: string } | { kind: 'error'; message: string };

let rowSeq = 0;
const newRowId = () => `r${++rowSeq}`;

type State = {
  loading: boolean;
  loadError: string | null;
  controlPoints: ColdroomControlPoint[];
  reasons: ColdroomReason[];
  inchargeOptions: ColdroomIncharge[];

  selectedControlPoint: string | null;
  controlArea: string;

  scanning: boolean;
  scanError: string | null;
  bucket: ColdroomBucket | null;
  selectedVariety: string | null;

  rejections: ColdroomRejectionRow[];
  qcIncharge: string;
  remarks: string;

  submitting: boolean;
  lastSubmitMessage: string | null;
  lastSubmitKind: 'ok' | 'error' | null;

  loadInitialData: () => Promise<void>;
  setControlPoint: (name: string) => void;
  scanBucket: (raw: string) => Promise<{ ok: boolean; message?: string }>;
  setSelectedVariety: (variety: string) => void;
  addReason: (reasonName: string) => void;
  updateRejectionStems: (id: string, stems: string) => void;
  removeRejection: (id: string) => void;
  setQcIncharge: (email: string) => void;
  setRemarks: (text: string) => void;
  canSubmit: () => boolean;
  submit: () => Promise<SubmitOutcome>;
  reset: () => void;
};

export const useKarenColdroomQcStore = create<State>((set, get) => ({
  loading: false,
  loadError: null,
  controlPoints: [],
  reasons: [],
  inchargeOptions: [],

  selectedControlPoint: null,
  controlArea: '',

  scanning: false,
  scanError: null,
  bucket: null,
  selectedVariety: null,

  rejections: [],
  qcIncharge: '',
  remarks: '',

  submitting: false,
  lastSubmitMessage: null,
  lastSubmitKind: null,

  loadInitialData: async () => {
    set({ loading: true, loadError: null });
    const outcome = await karenColdroomQcRepository.fetchFormData();
    if (outcome.kind === 'error') {
      set({ loading: false, loadError: outcome.message });
      return;
    }
    const email = useAuthStore.getState().email ?? '';
    set({
      loading: false,
      controlPoints: outcome.controlPoints,
      reasons: outcome.reasons,
      inchargeOptions: outcome.inchargeOptions,
      qcIncharge: get().qcIncharge || email,
    });
  },

  setControlPoint: (name) => {
    const cp = get().controlPoints.find((c) => c.name === name);
    set({ selectedControlPoint: name, controlArea: cp?.controlArea ?? 'Cold Room' });
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
    set({
      scanning: false,
      bucket: outcome.bucket,
      selectedVariety: outcome.bucket.varieties[0]?.variety ?? null,
      rejections: [],
    });
    return { ok: true };
  },

  setSelectedVariety: (variety) => set({ selectedVariety: variety }),

  addReason: (reasonName) => {
    const s = get();
    const variety = s.selectedVariety;
    if (!variety) return;
    // Ignore duplicates of the same reason on the same variety.
    if (s.rejections.some((r) => r.variety === variety && r.reason === reasonName)) return;
    const reason = s.reasons.find((r) => r.name === reasonName);
    const length = s.bucket?.varieties.find((v) => v.variety === variety)?.length ?? '';
    set({
      rejections: [
        ...s.rejections,
        {
          id: newRowId(),
          variety,
          reason: reasonName,
          reasonLabel: reason?.parameter ?? reasonName,
          stems: '',
          length,
        },
      ],
    });
  },

  updateRejectionStems: (id, stems) =>
    set((s) => ({
      rejections: s.rejections.map((r) =>
        r.id === id ? { ...r, stems: stems.replace(/[^0-9]/g, '') } : r,
      ),
    })),

  removeRejection: (id) => set((s) => ({ rejections: s.rejections.filter((r) => r.id !== id) })),

  setQcIncharge: (email) => set({ qcIncharge: email }),
  setRemarks: (text) => set({ remarks: text }),

  canSubmit: () => {
    const s = get();
    // Rejections are optional — a clean quality check can still be submitted.
    if (!s.selectedControlPoint || !s.bucket || !s.qcIncharge) return false;
    return !s.submitting;
  },

  submit: async () => {
    const s = get();
    if (!s.selectedControlPoint) return { kind: 'error', message: 'Pick a control point.' };
    if (!s.bucket) return { kind: 'error', message: 'Scan a bucket first.' };
    // Rejections are optional; only completed rows are sent (each becomes a
    // Coldroom-rejects stock transfer server-side).
    const rejections = s.rejections
      .map((r) => ({
        variety: r.variety,
        reason: r.reason,
        stems: Number.parseInt(r.stems, 10) || 0,
        length: r.length,
      }))
      .filter((r) => r.variety && r.reason && r.stems > 0);

    const payload: Record<string, unknown> = {
      control_point: s.selectedControlPoint,
      bucket_id: s.bucket.bucketId,
      farm: s.bucket.farm,
      greenhouse: s.bucket.greenhouse,
      packhouse: s.bucket.packhouse,
      days_in_stock: s.bucket.daysInStock,
      qc_incharge: s.qcIncharge,
      remarks: s.remarks,
      rejections,
    };

    set({ submitting: true });
    const outcome = await karenColdroomQcRepository.save(payload);
    if (outcome.kind === 'ok') {
      set({ submitting: false, lastSubmitMessage: outcome.message, lastSubmitKind: 'ok' });
      return { kind: 'ok', message: outcome.message };
    }
    set({ submitting: false, lastSubmitMessage: outcome.message, lastSubmitKind: 'error' });
    return { kind: 'error', message: outcome.message };
  },

  reset: () =>
    set({ bucket: null, selectedVariety: null, scanError: null, rejections: [], remarks: '' }),
}));
