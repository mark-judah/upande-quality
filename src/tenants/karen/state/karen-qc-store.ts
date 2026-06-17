import { create } from 'zustand';
import {
  karenQcRepository,
  type BatchInfo,
  type GreenhouseData,
  type QualityBucket,
  type QualityParameter,
  type SubmitOutcome,
} from '../repository/karen-qc-repository';
import { mapAxiosError } from '@/src/core/api/client';

export type ControlPoint = 'Field' | 'Intake' | 'Coldroom' | 'Packhouse';
export type BatchAction = 'accept' | 'quarantine' | 'reject';
export type QuarantineScope = 'buckets' | 'batch';
export type QuarantineAction = 'accept' | 'reject';

export type Concern = {
  id: number;
  paramKey: string;        // snake_cased parameter name; matches QualityParameter.parameter
  variety: string | null;  // item_code from a bucket
  count: number;
};

export type QuarantineRowState = {
  action: QuarantineAction;
  stems: string; // text input, parsed on submit
};

type State = {
  // Mode flags ─────────────────────────────────────────────────────────────
  controlPoint: ControlPoint;
  isFieldMode: boolean;
  isQuarantineMode: boolean;

  // Async resources ────────────────────────────────────────────────────────
  parameters: QualityParameter[];
  parametersLoading: boolean;
  varieties: string[];
  varietiesLoading: boolean;

  // Batch state ────────────────────────────────────────────────────────────
  batch: BatchInfo | null;
  batchLoading: boolean;
  scannedRaw: string;

  // Inspection form ────────────────────────────────────────────────────────
  /** Stems sampled per variety. Keyed by item_code; value is a text input so
   *  the user can clear it mid-edit. Empty / unparseable → 0 on submit. */
  stemsCheckedByVariety: Record<string, string>;
  /** Which variety the variety-scoped sections (Stems Sampled + Concerns) are
   *  currently editing. Auto-set when a batch loads to the first variety. */
  selectedVariety: string | null;
  solutionLevel: string;
  solutionHygiene: string | null;
  solutionPh: number;
  chlorinePpm: number;
  concerns: Concern[];
  batchAction: BatchAction;
  quarantineScope: QuarantineScope;
  selectedBucketsForQuarantine: Record<string, boolean>;

  // Quarantine review ──────────────────────────────────────────────────────
  quarantineRows: Record<string, QuarantineRowState>;

  // Field-mode form ────────────────────────────────────────────────────────
  fieldVariety: string;
  fieldStems: string;
  fieldRejectionReason: string | null;

  // Submit state ───────────────────────────────────────────────────────────
  submitting: boolean;
  lastSubmitMessage: string | null;
  lastSubmitKind: 'ok' | 'error' | null;

  // Actions ────────────────────────────────────────────────────────────────
  setControlPoint: (cp: ControlPoint) => void;

  loadParameters: () => Promise<void>;
  loadVarieties: (greenhouse: string) => Promise<void>;

  loadBatchFromScan: (raw: string) => Promise<{ ok: boolean; message?: string }>;
  resetBatch: () => void;

  setStemsCheckedForVariety: (variety: string, v: string) => void;
  setSelectedVariety: (variety: string | null) => void;
  setSolutionLevel: (v: string) => void;
  setSolutionHygiene: (v: string | null) => void;
  setSolutionPh: (v: number) => void;
  setChlorinePpm: (v: number) => void;

  /** Adds a concern attached to the currently selected variety. */
  addConcern: (paramKey: string) => void;
  removeConcern: (id: number) => void;
  updateConcern: (id: number, patch: Partial<Concern>) => void;

  setBatchAction: (a: BatchAction) => void;
  setQuarantineScope: (s: QuarantineScope) => void;
  toggleBucketForQuarantine: (bucketId: string) => void;

  setQuarantineRowAction: (bucketId: string, action: QuarantineAction) => void;
  setQuarantineRowStems: (bucketId: string, stems: string) => void;

  setFieldVariety: (v: string) => void;
  setFieldStems: (v: string) => void;
  setFieldRejectionReason: (v: string | null) => void;

  submitInspection: () => Promise<SubmitOutcome>;
  submitQuarantine: () => Promise<SubmitOutcome>;
  submitFieldReject: (farm: string, greenhouse: string) => Promise<SubmitOutcome>;

  resetAll: () => void;
};

let concernSeed = 1;

function snakeCase(s: string): string {
  return s
    .trim()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, '_')
    .toLowerCase();
}

/** Tolerance check is per-variety: a concern exceeds when its count crosses
 *  the threshold against *its own variety's* sample size, not the batch sum.
 *  Concerns whose variety has no sample entered yet are treated as exceeding
 *  only when threshold==0 and count>0 (any count is over a zero threshold). */
function defaultBatchAction(
  concerns: Concern[],
  parameters: QualityParameter[],
  stemsCheckedByVariety: Record<string, string>,
): BatchAction {
  for (const c of concerns) {
    if (!c.variety) continue;
    const param = parameters.find((p) => snakeCase(p.parameter) === c.paramKey);
    if (!param) continue;
    const threshold = Number(param.toleranceThresholds);
    const stems = Number.parseInt(stemsCheckedByVariety[c.variety] ?? '', 10) || 0;
    if (threshold === 0 && c.count > 0) return 'quarantine';
    if (stems > 0 && (c.count / stems) * 100 > threshold) return 'quarantine';
  }
  return 'accept';
}

const inspectionInitial = {
  stemsCheckedByVariety: {} as Record<string, string>,
  selectedVariety: null as string | null,
  solutionLevel: '',
  solutionHygiene: null as string | null,
  solutionPh: 4.5,
  chlorinePpm: 50,
  concerns: [] as Concern[],
  batchAction: 'accept' as BatchAction,
  quarantineScope: 'buckets' as QuarantineScope,
  selectedBucketsForQuarantine: {} as Record<string, boolean>,
};

const fieldInitial = {
  fieldVariety: '',
  fieldStems: '',
  fieldRejectionReason: null as string | null,
};

export const useKarenQcStore = create<State>((set, get) => ({
  controlPoint: 'Intake',
  isFieldMode: false,
  isQuarantineMode: false,

  parameters: [],
  parametersLoading: false,
  varieties: [],
  varietiesLoading: false,

  batch: null,
  batchLoading: false,
  scannedRaw: '',

  ...inspectionInitial,
  quarantineRows: {},
  ...fieldInitial,

  submitting: false,
  lastSubmitMessage: null,
  lastSubmitKind: null,

  setControlPoint: (cp) => {
    set({
      controlPoint: cp,
      isFieldMode: cp === 'Field',
      // Leaving field mode clears its form; entering it clears the batch state.
      ...(cp === 'Field'
        ? { batch: null, isQuarantineMode: false, ...inspectionInitial, quarantineRows: {} }
        : { ...fieldInitial }),
    });
  },

  loadParameters: async () => {
    set({ parametersLoading: true });
    try {
      const parameters = await karenQcRepository.fetchParameters();
      set({ parameters, parametersLoading: false });
    } catch {
      set({ parametersLoading: false });
    }
  },

  loadVarieties: async (greenhouse) => {
    if (!greenhouse) return;
    set({ varietiesLoading: true });
    try {
      const data: GreenhouseData = await karenQcRepository.fetchGreenhouseData(greenhouse);
      set({
        varieties: data.varieties.map((v) => v.variety),
        varietiesLoading: false,
      });
    } catch {
      set({ varietiesLoading: false });
    }
  },

  loadBatchFromScan: async (raw) => {
    const bucketId = raw.trim().startsWith('{')
      ? extractFromJson(raw)
      : raw.trim();
    if (!bucketId) {
      return { ok: false, message: 'Please scan a valid bucket QR code.' };
    }
    set({ batchLoading: true, scannedRaw: bucketId });
    try {
      const outcome = await karenQcRepository.loadBatchFromBucket(bucketId);
      if (outcome.kind === 'error') {
        set({ batchLoading: false });
        return { ok: false, message: outcome.message };
      }
      const batch = outcome.batch;
      const quarantined = batch.buckets.filter((b) => b.isInQuarantine);
      const isQuarantineMode = batch.hasActiveQuarantine && quarantined.length > 0;
      const quarantineRows: Record<string, QuarantineRowState> = {};
      for (const b of quarantined) {
        quarantineRows[b.bucketId] = { action: 'accept', stems: String(b.stems) };
      }
      const varieties = uniqueVarieties(batch.buckets);
      set({
        batchLoading: false,
        batch,
        isQuarantineMode,
        quarantineRows: isQuarantineMode ? quarantineRows : {},
        selectedBucketsForQuarantine: {},
        // Auto-pick the first variety so the inspector lands directly on the
        // per-variety form when the batch has only one variety.
        selectedVariety: varieties[0] ?? null,
        stemsCheckedByVariety: {},
      });
      return { ok: true };
    } catch (err) {
      set({ batchLoading: false });
      return { ok: false, message: mapAxiosError(err).message };
    }
  },

  resetBatch: () => {
    set({
      batch: null,
      batchLoading: false,
      scannedRaw: '',
      isQuarantineMode: false,
      quarantineRows: {},
      ...inspectionInitial,
    });
  },

  setStemsCheckedForVariety: (variety, v) => {
    set((s) => ({
      stemsCheckedByVariety: { ...s.stemsCheckedByVariety, [variety]: v },
    }));
    syncBatchAction(set, get);
  },
  setSelectedVariety: (variety) => set({ selectedVariety: variety }),
  setSolutionLevel: (v) => set({ solutionLevel: v }),
  setSolutionHygiene: (v) => set({ solutionHygiene: v }),
  setSolutionPh: (v) => set({ solutionPh: v }),
  setChlorinePpm: (v) => set({ chlorinePpm: v }),

  addConcern: (paramKey) => {
    const id = concernSeed++;
    const variety = get().selectedVariety;
    set((s) => ({ concerns: [...s.concerns, { id, paramKey, variety, count: 0 }] }));
    syncBatchAction(set, get);
  },
  removeConcern: (id) => {
    set((s) => ({ concerns: s.concerns.filter((c) => c.id !== id) }));
    syncBatchAction(set, get);
  },
  updateConcern: (id, patch) => {
    set((s) => ({
      concerns: s.concerns.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    }));
    syncBatchAction(set, get);
  },

  setBatchAction: (a) => set({ batchAction: a }),
  setQuarantineScope: (s) => set({ quarantineScope: s }),
  toggleBucketForQuarantine: (bucketId) => {
    const id = bucketId.toUpperCase();
    set((s) => ({
      selectedBucketsForQuarantine: {
        ...s.selectedBucketsForQuarantine,
        [id]: !s.selectedBucketsForQuarantine[id],
      },
    }));
  },

  setQuarantineRowAction: (bucketId, action) =>
    set((s) => ({
      quarantineRows: {
        ...s.quarantineRows,
        [bucketId]: { ...(s.quarantineRows[bucketId] ?? { stems: '0' }), action },
      },
    })),
  setQuarantineRowStems: (bucketId, stems) =>
    set((s) => ({
      quarantineRows: {
        ...s.quarantineRows,
        [bucketId]: { ...(s.quarantineRows[bucketId] ?? { action: 'accept' }), stems },
      },
    })),

  setFieldVariety: (v) => set({ fieldVariety: v }),
  setFieldStems: (v) => set({ fieldStems: v }),
  setFieldRejectionReason: (v) => set({ fieldRejectionReason: v }),

  submitInspection: async () => {
    const s = get();
    const batch = s.batch;
    if (!batch) {
      const out: SubmitOutcome = { kind: 'error', message: 'No batch loaded.' };
      set({ lastSubmitMessage: out.message, lastSubmitKind: 'error' });
      return out;
    }

    // Per-variety stems sampled, parsed once.
    const stemsByVariety: Record<string, number> = {};
    for (const [variety, raw] of Object.entries(s.stemsCheckedByVariety)) {
      const n = Number.parseInt(raw, 10);
      if (Number.isFinite(n) && n > 0) stemsByVariety[variety] = n;
    }
    const totalSampled = Object.values(stemsByVariety).reduce((a, b) => a + b, 0);

    // Each concern must have a variety AND that variety must have a positive
    // sample size — otherwise the per-variety tolerance % is meaningless.
    for (const c of s.concerns) {
      const display =
        s.parameters.find((p) => snakeCase(p.parameter) === c.paramKey)?.parameter ?? c.paramKey;
      if (!c.variety) {
        const out: SubmitOutcome = {
          kind: 'error',
          message: `Select a variety for "${display}" before submitting.`,
        };
        set({ lastSubmitMessage: out.message, lastSubmitKind: 'error' });
        return out;
      }
      if (!stemsByVariety[c.variety]) {
        const out: SubmitOutcome = {
          kind: 'error',
          message: `Enter stems sampled for ${c.variety} before submitting "${display}".`,
        };
        set({ lastSubmitMessage: out.message, lastSubmitKind: 'error' });
        return out;
      }
      if (c.count > stemsByVariety[c.variety]) {
        const out: SubmitOutcome = {
          kind: 'error',
          message: `"${display}" count (${c.count}) exceeds stems sampled for ${c.variety} (${stemsByVariety[c.variety]}).`,
        };
        set({ lastSubmitMessage: out.message, lastSubmitKind: 'error' });
        return out;
      }
    }

    const perBucketScope = s.batchAction === 'quarantine' && s.quarantineScope === 'buckets';

    const addressable: Record<string, number> = {};
    for (const b of batch.buckets) {
      const id = b.bucketId.toUpperCase();
      const included = perBucketScope ? !!s.selectedBucketsForQuarantine[id] : true;
      if (included) addressable[b.itemCode] = (addressable[b.itemCode] ?? 0) + b.stems;
    }
    for (const c of s.concerns) {
      const bound = addressable[c.variety!] ?? 0;
      if (c.count > bound) {
        const display =
          s.parameters.find((p) => snakeCase(p.parameter) === c.paramKey)?.parameter ?? c.paramKey;
        const poolLabel = perBucketScope
          ? `selected ${c.variety} buckets`
          : `${c.variety} total stems`;
        const out: SubmitOutcome = {
          kind: 'error',
          message: `"${display}" count (${c.count}) exceeds ${poolLabel} (${bound}).`,
        };
        set({ lastSubmitMessage: out.message, lastSubmitKind: 'error' });
        return out;
      }
    }

    type ConcernsPayload = Record<string, Record<string, { count: number }>>;
    const concernsPayload: ConcernsPayload = {};
    for (const c of s.concerns) {
      const v = c.variety!;
      if (!concernsPayload[v]) concernsPayload[v] = {};
      const existing = concernsPayload[v][c.paramKey];
      concernsPayload[v][c.paramKey] = { count: (existing?.count ?? 0) + c.count };
    }

    const payload: Record<string, unknown> = {
      batch_no: batch.batchNo,
      farm: batch.farm,
      company: batch.company,
      control_point: s.controlPoint,
      // New per-variety map is the source of truth on the backend; the legacy
      // scalar is kept as the sum so an older Server Script (or any other
      // consumer) keeps working through the deploy.
      stems_checked_by_variety: stemsByVariety,
      checked_stems_sampled: totalSampled,
      solution_level_liters: Number.parseInt(s.solutionLevel, 10) || 0,
      solution_hygiene: s.solutionHygiene ?? '',
      chlorine_ppm: Math.round(s.chlorinePpm),
      solution_ph: s.solutionPh.toFixed(1),
      batch_decision: s.batchAction.toUpperCase(),
      quarantine_scope:
        s.batchAction === 'quarantine' ? (s.quarantineScope === 'buckets' ? 'buckets' : 'batch') : '',
      quality_concerns: concernsPayload,
      buckets: batch.buckets.map((b) => ({
        bucket_id: b.bucketId,
        stems: b.stems,
        status: b.status,
        selected:
          s.quarantineScope === 'buckets'
            ? !!s.selectedBucketsForQuarantine[b.bucketId.toUpperCase()]
            : true,
      })),
    };

    set({ submitting: true });
    try {
      const outcome = await karenQcRepository.submitBatchQuality(payload);
      set({
        submitting: false,
        lastSubmitMessage: outcome.message,
        lastSubmitKind: outcome.kind,
      });
      return outcome;
    } catch (err) {
      const message = mapAxiosError(err).message;
      set({ submitting: false, lastSubmitMessage: message, lastSubmitKind: 'error' });
      return { kind: 'error', message };
    }
  },

  submitQuarantine: async () => {
    const s = get();
    const batch = s.batch;
    if (!batch) {
      const out: SubmitOutcome = { kind: 'error', message: 'No batch loaded.' };
      set({ lastSubmitMessage: out.message, lastSubmitKind: 'error' });
      return out;
    }
    const quarantined = batch.buckets.filter((b) => b.isInQuarantine);
    const actions: { bucketId: string; batchNo: string; action: QuarantineAction; stems: number }[] = [];
    for (const b of quarantined) {
      const row = s.quarantineRows[b.bucketId];
      if (!row) continue;
      const stems = Number.parseInt(row.stems, 10);
      actions.push({
        bucketId: b.bucketId,
        batchNo: batch.batchNo,
        action: row.action,
        stems: Number.isFinite(stems) ? stems : b.stems,
      });
    }
    set({ submitting: true });
    try {
      const outcome = await karenQcRepository.submitQuarantineActions(actions);
      set({
        submitting: false,
        lastSubmitMessage: outcome.message,
        lastSubmitKind: outcome.kind,
      });
      return outcome;
    } catch (err) {
      const message = mapAxiosError(err).message;
      set({ submitting: false, lastSubmitMessage: message, lastSubmitKind: 'error' });
      return { kind: 'error', message };
    }
  },

  submitFieldReject: async (farm, greenhouse) => {
    const s = get();
    if (!s.fieldVariety.trim()) {
      const out: SubmitOutcome = { kind: 'error', message: 'Variety is required.' };
      set({ lastSubmitMessage: out.message, lastSubmitKind: 'error' });
      return out;
    }
    const stems = Number.parseInt(s.fieldStems, 10) || 0;
    if (stems <= 0) {
      const out: SubmitOutcome = { kind: 'error', message: 'Number of stems must be greater than 0.' };
      set({ lastSubmitMessage: out.message, lastSubmitKind: 'error' });
      return out;
    }
    if (!s.fieldRejectionReason) {
      const out: SubmitOutcome = { kind: 'error', message: 'Rejection reason is required.' };
      set({ lastSubmitMessage: out.message, lastSubmitKind: 'error' });
      return out;
    }
    const payload: Record<string, unknown> = {
      control_point: 'Field',
      variety: s.fieldVariety.trim(),
      no_of_stems: stems,
      rejection_reason: s.fieldRejectionReason,
      farm,
      greenhouse,
    };
    set({ submitting: true });
    try {
      const outcome = await karenQcRepository.submitFieldReject(payload);
      set({
        submitting: false,
        lastSubmitMessage: outcome.message,
        lastSubmitKind: outcome.kind,
      });
      if (outcome.kind === 'ok') set({ ...fieldInitial });
      return outcome;
    } catch (err) {
      const message = mapAxiosError(err).message;
      set({ submitting: false, lastSubmitMessage: message, lastSubmitKind: 'error' });
      return { kind: 'error', message };
    }
  },

  resetAll: () => {
    set({
      controlPoint: 'Intake',
      isFieldMode: false,
      batch: null,
      batchLoading: false,
      scannedRaw: '',
      isQuarantineMode: false,
      quarantineRows: {},
      ...inspectionInitial,
      ...fieldInitial,
      submitting: false,
      lastSubmitMessage: null,
      lastSubmitKind: null,
    });
  },
}));

function extractFromJson(text: string): string | null {
  try {
    const parsed = JSON.parse(text.trim());
    if (parsed && typeof parsed === 'object') {
      const e = Object.entries(parsed as Record<string, unknown>).find(([, v]) => v === 'bucket');
      if (e) return e[0];
    }
  } catch {
    // fall through
  }
  return null;
}

function syncBatchAction(
  set: (partial: Partial<State> | ((s: State) => Partial<State>)) => void,
  get: () => State,
) {
  const s = get();
  if (s.isQuarantineMode || s.isFieldMode) return;
  const next = defaultBatchAction(s.concerns, s.parameters, s.stemsCheckedByVariety);
  if (next !== s.batchAction) set({ batchAction: next });
}

export function snakeCaseParam(parameter: string): string {
  return snakeCase(parameter);
}

export function uniqueVarieties(buckets: QualityBucket[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const b of buckets) {
    if (b.itemCode && !seen.has(b.itemCode)) {
      seen.add(b.itemCode);
      out.push(b.itemCode);
    }
  }
  return out;
}
