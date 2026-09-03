import {
  karenVaselifeRepository,
  type VaselifeBreeder,
  type VaselifeCommercialStatus,
  type VaselifeCrop,
  type VaselifeCutStage,
  type VaselifeFailureReason,
  type VaselifeSampleRef,
  type VaselifeVariety,
} from '@/src/tenants/karen/repository/karen-vaselife-repository';
import { create } from 'zustand';

/** Bucket QRs may encode as `{ "<bucket-id>": "bucket" }`; fall back to raw text. */
export function extractVaselifeBucketId(raw: string): string {
  const t = (raw ?? '').trim();
  if (t.startsWith('{')) {
    try {
      const obj = JSON.parse(t) as Record<string, unknown>;
      const keys = Object.keys(obj);
      if (keys.length) return keys[0];
    } catch {
      // not JSON — use raw
    }
  }
  return t;
}

export type SubmitOutcome = { kind: 'ok'; message: string } | { kind: 'error'; message: string };

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Parses YYYY-MM-DD in local time to avoid UTC-offset day shifts.
function addDays(dateStr: string, days: number): string {
  const parts = dateStr.split('-').map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) return '';
  const [y, m, d] = parts;
  const result = new Date(y, m - 1, d + days);
  return `${result.getFullYear()}-${String(result.getMonth() + 1).padStart(2, '0')}-${String(result.getDate()).padStart(2, '0')}`;
}

// Sampling → supermarket/due/vase day offsets. Spray Roses run 5 days longer
// through the chain than Standard Roses (supermarket 12 vs 7 days after
// sampling), keeping the same gaps to due/vase.
const VASELIFE_DATE_OFFSETS = {
  spray: { supermarket: 12, due: 16, vase: 17 },
  standard: { supermarket: 7, due: 11, vase: 12 },
};

function vaselifeDatesFor(samplingDate: string, itemGroup?: string | null) {
  const o =
    (itemGroup ?? '').trim().toLowerCase() === 'spray roses'
      ? VASELIFE_DATE_OFFSETS.spray
      : VASELIFE_DATE_OFFSETS.standard;
  return {
    supermarketDate: addDays(samplingDate, o.supermarket),
    dueDate: addDays(samplingDate, o.due),
    vaseDate: addDays(samplingDate, o.vase),
  };
}

type State = {
  // Shared form options
  loading: boolean;
  loadError: string | null;
  breeders: VaselifeBreeder[];
  varieties: VaselifeVariety[];
  crops: VaselifeCrop[];
  commercialStatuses: VaselifeCommercialStatus[];
  cutStages: VaselifeCutStage[];
  failureReasons: VaselifeFailureReason[];
  samples: VaselifeSampleRef[];

  // ── Sample form ────────────────────────────────────────────────────────────
  scanning: boolean;
  scanError: string | null;
  scannedBucketId: string | null;

  samplingDate: string;
  consignment: string;
  supermarketDate: string;
  dueDate: string;
  vaseDate: string;
  breeder: string | null;
  variety: string | null;
  commercialStatus: string | null;
  crop: string | null;
  harvestDate: string;
  harvestTime: string;
  lineCode: string;
  farm: string;
  gh: string;
  length: string;
  noOfStems: string;
  budHeight: string;
  budWidth: string;
  initialCutStage: string | null;
  sampleSubmitting: boolean;
  lastSampleCode: string | null;

  // ── Observation form ───────────────────────────────────────────────────────
  obsDate: string;
  obsSampleCode: string;
  obsStemsFailed: string;
  obsReasons: string[];
  obsNotes: string;
  obsSubmitting: boolean;

  loadInitialData: () => Promise<void>;
  scanBucket: (raw: string) => Promise<{ ok: boolean; message?: string }>;

  // Sample actions
  setSamplingDate: (v: string) => void;
  setConsignment: (v: string) => void;
  setSupermarketDate: (v: string) => void;
  setDueDate: (v: string) => void;
  setVaseDate: (v: string) => void;
  setBreeder: (v: string | null) => void;
  setVariety: (v: string | null) => void;
  setCommercialStatus: (v: string | null) => void;
  setCrop: (v: string | null) => void;
  setHarvestDate: (v: string) => void;
  setHarvestTime: (v: string) => void;
  setLineCode: (v: string) => void;
  setFarm: (v: string) => void;
  setGh: (v: string) => void;
  setLength: (v: string) => void;
  setNoOfStems: (v: string) => void;
  setBudHeight: (v: string) => void;
  setBudWidth: (v: string) => void;
  setInitialCutStage: (v: string | null) => void;
  canSubmitSample: () => boolean;
  submitSample: () => Promise<SubmitOutcome>;
  resetSample: () => void;

  // Observation actions
  setObsSampleCode: (v: string) => void;
  setObsStemsFailed: (v: string) => void;
  setObsNotes: (v: string) => void;
  toggleObsReason: (reason: string) => void;
  canSubmitObservation: () => boolean;
  submitObservation: () => Promise<SubmitOutcome>;
  resetObservation: () => void;
};

export const useKarenVaselifeStore = create<State>((set, get) => ({
  loading: false,
  loadError: null,
  breeders: [],
  varieties: [],
  crops: [],
  commercialStatuses: [],
  cutStages: [],
  failureReasons: [],
  samples: [],

  scanning: false,
  scanError: null,
  scannedBucketId: null,

  samplingDate: today(),
  consignment: '',
  supermarketDate: addDays(today(), 7),
  dueDate: addDays(today(), 11),
  vaseDate: addDays(today(), 12),
  breeder: null,
  variety: null,
  commercialStatus: null,
  crop: null,
  harvestDate: '',
  harvestTime: '',
  lineCode: '',
  farm: '',
  gh: '',
  length: '',
  noOfStems: '',
  budHeight: '',
  budWidth: '',
  initialCutStage: null,
  sampleSubmitting: false,
  lastSampleCode: null,

  obsDate: today(),
  obsSampleCode: '',
  obsStemsFailed: '',
  obsReasons: [],
  obsNotes: '',
  obsSubmitting: false,

  loadInitialData: async () => {
    set({ loading: true, loadError: null });
    const outcome = await karenVaselifeRepository.fetchFormData();
    if (outcome.kind === 'error') {
      set({ loading: false, loadError: outcome.message });
      return;
    }
    set({
      loading: false,
      breeders: outcome.breeders,
      varieties: outcome.varieties,
      crops: outcome.crops,
      commercialStatuses: outcome.commercialStatuses,
      cutStages: outcome.cutStages,
      failureReasons: outcome.failureReasons,
      samples: outcome.samples,
    });
  },

  scanBucket: async (raw) => {
    const bucketId = extractVaselifeBucketId(raw);
    if (!bucketId) return { ok: false, message: 'Empty scan.' };
    set({ scanning: true, scanError: null });
    const outcome = await karenVaselifeRepository.getBucket(bucketId);
    if (outcome.kind === 'error') {
      set({ scanning: false, scanError: outcome.message });
      return { ok: false, message: outcome.message };
    }
    const { bucket } = outcome;
    set({
      scanning: false,
      scannedBucketId: bucket.bucketId,
      harvestDate: bucket.harvestDate,
      harvestTime: bucket.harvestTime,
      farm: bucket.farm,
      gh: bucket.gh,
      length: bucket.length,
    });
    return { ok: true };
  },

  setSamplingDate: (v) => {
    const g = get();
    const match = g.varieties.find((vr) => vr.name === g.variety);
    set({ samplingDate: v, ...vaselifeDatesFor(v, match?.item_group) });
  },

  setConsignment: (v) => set({ consignment: v }),
  setSupermarketDate: (v) => set({ supermarketDate: v }),
  setDueDate: (v) => set({ dueDate: v }),
  setVaseDate: (v) => set({ vaseDate: v }),
  setBreeder: (v) => set({ breeder: v }),
  // Auto-fill breeder from the selected variety's metadata, and recompute the
  // supermarket/due/vase dates using that variety's item group (Spray Roses
  // run longer than Standard Roses).
  setVariety: (v) => {
    const g = get();
    const match = g.varieties.find((vr) => vr.name === v);
    set({
      variety: v,
      breeder: match?.breeder ?? g.breeder,
      ...vaselifeDatesFor(g.samplingDate, match?.item_group),
    });
  },
  setCommercialStatus: (v) => set({ commercialStatus: v }),
  setCrop: (v) => set({ crop: v }),
  setHarvestDate: (v) => set({ harvestDate: v }),
  setHarvestTime: (v) => set({ harvestTime: v }),
  setLineCode: (v) => set({ lineCode: v }),
  setFarm: (v) => set({ farm: v }),
  setGh: (v) => set({ gh: v }),
  setLength: (v) => set({ length: v.replace(/[^0-9.]/g, '') }),
  setNoOfStems: (v) => set({ noOfStems: v.replace(/[^0-9]/g, '') }),
  setBudHeight: (v) => set({ budHeight: v.replace(/[^0-9.]/g, '') }),
  setBudWidth: (v) => set({ budWidth: v.replace(/[^0-9.]/g, '') }),
  setInitialCutStage: (v) => set({ initialCutStage: v }),

  canSubmitSample: () => {
    const s = get();
    if (!s.variety || !s.samplingDate) return false;
    return !s.sampleSubmitting;
  },

  submitSample: async () => {
    const s = get();
    if (!s.variety) return { kind: 'error', message: 'Variety is required.' };

    const payload: Record<string, unknown> = {
      sampling_date: s.samplingDate,
      consignment: s.consignment,
      supermarket_date: s.supermarketDate,
      due_date: s.dueDate,
      vase_date: s.vaseDate,
      breeder: s.breeder,
      variety: s.variety,
      commercial_status: s.commercialStatus,
      crop: s.crop,
      harvest_date: s.harvestDate,
      harvest_time: s.harvestTime,
      line_code: s.lineCode,
      farm: s.farm,
      gh: s.gh,
      length: s.length ? Number(s.length) : null,
      no_of_stems: s.noOfStems ? Number(s.noOfStems) : null,
      bud_height: s.budHeight ? Number(s.budHeight) : null,
      bud_width: s.budWidth ? Number(s.budWidth) : null,
      initial_cut_stage: s.initialCutStage,
    };

    set({ sampleSubmitting: true });
    const outcome = await karenVaselifeRepository.saveSample(payload);
    if (outcome.kind === 'ok') {
      const newRef: VaselifeSampleRef = {
        code: outcome.sampleCode,
        variety: s.variety ?? '',
        samplingDate: s.samplingDate,
      };
      set((st) => ({
        sampleSubmitting: false,
        lastSampleCode: outcome.sampleCode,
        // Make the just-created code available to the observation type-ahead now.
        samples: [newRef, ...st.samples.filter((sm) => sm.code !== newRef.code)],
      }));
      return { kind: 'ok', message: outcome.message };
    }
    set({ sampleSubmitting: false });
    return { kind: 'error', message: outcome.message };
  },

  resetSample: () => {
    const t = today();
    return set({
      scanning: false,
      scanError: null,
      scannedBucketId: null,
      samplingDate: t,
      consignment: '',
      supermarketDate: addDays(t, 7),
      dueDate: addDays(t, 11),
      vaseDate: addDays(t, 12),
      breeder: null,
      variety: null,
      commercialStatus: null,
      crop: null,
      harvestDate: '',
      harvestTime: '',
      lineCode: '',
      farm: '',
      gh: '',
      length: '',
      noOfStems: '',
      budHeight: '',
      budWidth: '',
      initialCutStage: null,
      lastSampleCode: null,
    });
  },

  setObsSampleCode: (v) => set({ obsSampleCode: v }),
  setObsStemsFailed: (v) => set({ obsStemsFailed: v.replace(/[^0-9]/g, '') }),
  setObsNotes: (v) => set({ obsNotes: v }),
  toggleObsReason: (reason) =>
    set((s) => ({
      obsReasons: s.obsReasons.includes(reason)
        ? s.obsReasons.filter((r) => r !== reason)
        : [...s.obsReasons, reason],
    })),

  canSubmitObservation: () => {
    const s = get();
    if (!s.obsSampleCode.trim()) return false;
    return !s.obsSubmitting;
  },

  submitObservation: async () => {
    const s = get();
    if (!s.obsSampleCode.trim()) return { kind: 'error', message: 'Sample code is required.' };

    const payload: Record<string, unknown> = {
      sample_code: s.obsSampleCode.trim(),
      date: s.obsDate,
      stems_failed: s.obsStemsFailed ? Number(s.obsStemsFailed) : 0,
      failure_reasons: s.obsReasons,
      notes: s.obsNotes.trim(),
    };

    set({ obsSubmitting: true });
    const outcome = await karenVaselifeRepository.saveObservation(payload);
    if (outcome.kind === 'ok') {
      set({ obsSubmitting: false });
      return { kind: 'ok', message: outcome.message };
    }
    set({ obsSubmitting: false });
    return { kind: 'error', message: outcome.message };
  },

  resetObservation: () =>
    set({
      obsDate: today(),
      obsSampleCode: '',
      obsStemsFailed: '',
      obsReasons: [],
      obsNotes: '',
    }),
}));
