import { create } from 'zustand';
import {
  karenPackhouseQcRepository,
  type BoxLabelOption,
  type ControlPointOption,
  type ItemLocation,
  type OrderPickListOption,
  type PackhouseOverallResult,
  type PackhouseQcParameter,
  type QcInchargeOption,
  type ReasonOption,
  type ScannedBoxDetail,
  type SpecificationListItem,
  type SpecificationMatch,
} from '../repository/karen-packhouse-qc-repository';
import { mapAxiosError } from '@/src/core/api/client';

export type QcType = 'Online QC' | 'Final QC';
export type OnlineMode = 'Reject Recorder' | 'Grading QC';
export type IssueAction = 'Quarantine' | 'Reject';
/** The operator's manual, order-level call for Final QC — authoritative
 *  over any per-issue tally, since Quarantine/Reject means the WHOLE
 *  order, not just the boxes actually sampled. */
export type FinalDecision = 'Accept' | 'Quarantine' | 'Reject';

/** The three physical checks the operator verifies against the box while
 *  reading the Order Specification card — tap Accepted when it matches, or
 *  note what was actually found when it doesn't. */
export type SpecCheckKey = 'cutStage' | 'defoliationLength' | 'rubberBand';
export type SpecCheckState = { accepted: boolean; actualValue: string };
export type SpecChecks = Record<SpecCheckKey, SpecCheckState>;

function emptySpecCheckState(): SpecCheckState {
  return { accepted: false, actualValue: '' };
}

function emptySpecChecks(): SpecChecks {
  return {
    cutStage: emptySpecCheckState(),
    defoliationLength: emptySpecCheckState(),
    rubberBand: emptySpecCheckState(),
  };
}

export type IssueRow = {
  id: number;
  paramName: string;
  count: number;
  action: IssueAction;
};

export type SubmitOutcome =
  | { kind: 'ok'; message: string }
  | { kind: 'error'; message: string };

/** Bunches inspected one at a time during Grading QC — Accept moves straight
 *  to the next bunch; Reject needs a reason before moving on. Reject Recorder
 *  and Grading QC never quarantine — only Final QC does. */
type BunchSamplingState = {
  started: boolean;
  finished: boolean;
  bunchIndex: number;
  accepted: number;
  rejected: number;
};

function emptyBunchSampling(): BunchSamplingState {
  return { started: false, finished: false, bunchIndex: 1, accepted: 0, rejected: 0 };
}

type State = {
  qcType: QcType | null;
  onlineMode: OnlineMode | null;

  controlPoints: ControlPointOption[];
  orderPickLists: OrderPickListOption[];
  params: PackhouseQcParameter[];
  reasons: ReasonOption[];
  qcIncharges: QcInchargeOption[];
  loadingInitial: boolean;

  /** All Active Specifications, for filtering the order list before it's
   *  browsed. Orders can only be picked from the list once a spec is
   *  chosen — scanning a box still bypasses this entirely. */
  specificationsList: SpecificationListItem[];
  /** The operator picks a customer first, then a spec — narrows the
   *  (potentially long) spec list down to just that customer's. */
  selectedCustomer: string | null;
  selectedSpecificationFilter: SpecificationListItem | null;
  orderPickListsLoading: boolean;

  /** Derived automatically from the selected order's team once it's picked —
   *  never chosen manually, to keep the flow to as few steps as possible. */
  selectedControlPoint: ControlPointOption | null;
  selectedOrderPickList: OrderPickListOption | null;
  itemLocations: ItemLocation[];
  varieties: string[];
  boxes: BoxLabelOption[];
  boxTotalCount: number;
  /** Full Specifications doc per variety, resolved via the real FK chain
   *  (OPL -> Sales Order Item -> Specifications) — lets QC compare the
   *  physical pack against exactly what was ordered. */
  specifications: Record<string, SpecificationMatch>;
  /** Full detail for a directly picked/overridden spec — takes priority
   *  over the per-variety `specifications` lookup, since it covers cases
   *  where the resolved order's own line has no Specification link at all
   *  (Final QC's scan-based flow, or Reject Recorder before an order's
   *  even been picked). */
  specificationDetail: SpecificationMatch | null;
  /** Cut stage / defoliation length / rubber band — ticked once the
   *  operator has physically confirmed each against the box. */
  specChecks: SpecChecks;
  orderDetailLoading: boolean;
  pendingQuarantineStems: number;

  selectedVariety: string | null;
  /** The box scanned to resolve the order, if scanning was used — sent as
   *  box_label on submit. Not required; the manual OPL picker works too. */
  scannedBoxName: string | null;
  /** What's actually recorded on that scanned box — the ground truth for
   *  this specific box, to compare against the Specification card. */
  scannedBoxDetail: ScannedBoxDetail | null;

  bunchSampling: BunchSamplingState;

  /** Final QC only — the operator's manual Accept/Quarantine/Reject call,
   *  and how many boxes they actually sampled (for the record; not part of
   *  the disposition math). */
  finalDecision: FinalDecision | null;
  boxesChecked: string;

  issues: IssueRow[];

  totalChecked: string;
  selectedQcIncharge: string | null;
  selectedReason: string | null;
  remarks: string;

  submitting: boolean;
  lastSubmitMessage: string | null;
  lastSubmitKind: 'ok' | 'error' | null;

  loadInitialData: () => Promise<void>;
  setQcType: (t: QcType) => void;
  setOnlineMode: (m: OnlineMode) => void;
  /** Narrows the Specification picker down to just this customer's specs —
   *  chosen before a spec, since the full spec list spans every customer. */
  selectCustomer: (customer: string) => void;
  /** Filters the Order Pick List picker down to orders actually filled
   *  against this spec — the operator must pick a spec before browsing
   *  orders (scanning a box still bypasses this). */
  selectSpecificationFilter: (spec: SpecificationListItem) => Promise<void>;
  selectOrderPickList: (opl: OrderPickListOption) => Promise<void>;
  /** Scans a box to resolve its order directly — an alternative to searching
   *  the Order Pick List picker. */
  scanBoxLabel: (raw: string) => Promise<{ ok: boolean; message?: string }>;

  startBunchSampling: () => void;
  recordBunchAccept: () => void;
  recordBunchReject: (reasonParamName: string) => void;
  finishBunchSampling: () => void;

  /** Final QC's overall order-level call — Accept, or Quarantine/Reject the
   *  WHOLE order for rework. */
  setFinalDecision: (d: FinalDecision) => void;
  setBoxesChecked: (v: string) => void;

  /** Selecting a parameter adds it straight to the issues list — no
   *  separate draft/count-then-confirm step. Starts at count 1; adjust it
   *  inline on the row afterward. */
  addIssueForParam: (paramName: string) => void;
  updateIssueCount: (id: number, count: number) => void;
  removeIssue: (id: number) => void;

  setTotalChecked: (v: string) => void;
  setQcIncharge: (v: string) => void;
  setReason: (v: string) => void;
  setRemarks: (v: string) => void;

  isBunchSamplingMode: () => boolean;
  isBoxSamplingMode: () => boolean;
  /** The spec matching the currently selected variety, if any. */
  currentSpecification: () => SpecificationMatch | null;
  /** Marks a spec check as matching — clears any noted actual value. */
  acceptSpecCheck: (key: SpecCheckKey) => void;
  /** Notes what was actually found for a spec check — implies it doesn't
   *  match, so this un-accepts it. */
  setSpecCheckActualValue: (key: SpecCheckKey, value: string) => void;
  /** Distinct customers across every loaded Specification, alphabetical. */
  customerOptions: () => string[];
  /** Specs belonging to the selected customer only; empty until one's picked. */
  specificationsForSelectedCustomer: () => SpecificationListItem[];
  canSubmit: () => boolean;

  submitPackhouseQc: () => Promise<SubmitOutcome>;
  resetAll: () => void;
};

let issueSeed = 1;

/** Mirrors the server's savePackhouseQC computation so the operator sees the
 *  outcome before submitting. Accepted unless EVERY checked stem was
 *  rejected/quarantined — a small reject count against the order's full
 *  stem total still reads as Accepted, since most of the order passed. */
export function computeOverallResult(issues: IssueRow[], totalStemsChecked: number): PackhouseOverallResult {
  const rejected = issues.filter((i) => i.action === 'Reject').reduce((sum, i) => sum + i.count, 0);
  const quarantined = issues.filter((i) => i.action === 'Quarantine').reduce((sum, i) => sum + i.count, 0);
  const accepted = Math.max(0, totalStemsChecked - rejected - quarantined);
  if (accepted > 0) return 'Accepted';
  if (rejected > 0) return 'Rejected';
  if (quarantined > 0) return 'Quarantined';
  return 'Accepted';
}

/** The unit being counted differs by mode. */
export function issueCountLabel(onlineMode: OnlineMode | null, qcType: QcType | null): string {
  if (onlineMode === 'Grading QC') return 'Bunches Affected';
  if (qcType === 'Final QC') return 'Boxes Affected';
  return 'Stems Affected';
}

export function totalBunches(itemLocations: ItemLocation[]): number {
  return itemLocations.reduce((sum, loc) => sum + loc.bunches, 0);
}

/** Stems per bunch, derived from the order's own item locations (bunches vs
 *  stems), so a rejected bunch is logged as its full stem count — not 1 —
 *  keeping the stems-based accepted/rejected math meaningful. */
export function stemsPerBunch(itemLocations: ItemLocation[]): number {
  const loc = itemLocations.find((l) => l.bunches > 0);
  if (!loc) return 1;
  return Math.round(loc.stems / loc.bunches) || 1;
}

/** Suggested sample size — 30% of the order's boxes, rounded up, minimum 1
 *  once there's at least one box. The operator can still sample more or
 *  fewer; this is guidance, not an enforced target. */
export function suggestedBoxSampleSize(boxTotalCount: number): number {
  if (boxTotalCount <= 0) return 0;
  return Math.max(1, Math.ceil(boxTotalCount * 0.3));
}

/** Stems per box — prefers the matched Specification's pack rate (what the
 *  order should actually have), falling back to the packed box's own rate. */
export function packRatePerBox(boxes: BoxLabelOption[], specification: SpecificationMatch | null): number {
  if (specification?.packRate) return specification.packRate;
  const box = boxes.find((b) => b.packRate > 0);
  return box?.packRate ?? 1;
}

function extractBoxLabelFromScan(raw: string): string {
  const text = raw.trim();
  if (text.startsWith('{') && text.endsWith('}')) {
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === 'object') {
        const entry = Object.entries(parsed as Record<string, unknown>).find(([, v]) => v === 'box');
        if (entry) return entry[0];
      }
    } catch {
      // fall through to raw text
    }
  }
  return text;
}

function normalizeTeam(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** QC Control Point names (e.g. "TEAM A") and Order Pick List teams (e.g.
 *  "Team A") refer to the same team, just formatted differently. */
export function oplMatchesControlPoint(opl: OrderPickListOption, cp: ControlPointOption): boolean {
  const team = normalizeTeam(opl.team);
  if (!team) return false;
  return team === normalizeTeam(cp.label) || team === normalizeTeam(cp.name);
}

/** Common reset shared by selecting a new order, scanning a new box, or
 *  starting over — every downstream piece of order-detail state. */
function freshOrderState() {
  return {
    itemLocations: [] as ItemLocation[],
    varieties: [] as string[],
    boxes: [] as BoxLabelOption[],
    boxTotalCount: 0,
    specifications: {} as Record<string, SpecificationMatch>,
    specificationDetail: null as SpecificationMatch | null,
    specChecks: emptySpecChecks(),
    selectedVariety: null as string | null,
    scannedBoxName: null as string | null,
    scannedBoxDetail: null as ScannedBoxDetail | null,
    pendingQuarantineStems: 0,
    bunchSampling: emptyBunchSampling(),
    // Accepted is the default until an issue says otherwise.
    finalDecision: 'Accept' as FinalDecision | null,
    boxesChecked: '' as string,
    issues: [] as IssueRow[],
  };
}

export const useKarenPackhouseQcStore = create<State>((set, get) => ({
  qcType: null,
  onlineMode: null,

  controlPoints: [],
  orderPickLists: [],
  params: [],
  reasons: [],
  qcIncharges: [],
  loadingInitial: false,

  specificationsList: [],
  selectedCustomer: null,
  selectedSpecificationFilter: null,
  orderPickListsLoading: false,

  selectedControlPoint: null,
  selectedOrderPickList: null,
  itemLocations: [],
  varieties: [],
  boxes: [],
  boxTotalCount: 0,
  specifications: {},
  specificationDetail: null,
  specChecks: emptySpecChecks(),
  orderDetailLoading: false,
  pendingQuarantineStems: 0,

  selectedVariety: null,
  scannedBoxName: null,
  scannedBoxDetail: null,

  bunchSampling: emptyBunchSampling(),
  finalDecision: 'Accept',
  boxesChecked: '',

  issues: [],

  totalChecked: '',
  selectedQcIncharge: null,
  selectedReason: null,
  remarks: '',

  submitting: false,
  lastSubmitMessage: null,
  lastSubmitKind: null,

  loadInitialData: async () => {
    set({ loadingInitial: true });
    try {
      const outcome = await karenPackhouseQcRepository.fetchFormData();
      if (outcome.kind === 'ok') {
        set({
          loadingInitial: false,
          controlPoints: outcome.controlPoints,
          // Unfiltered until a Specification is picked — the Order Pick
          // List card stays disabled until then.
          orderPickLists: [],
          specificationsList: outcome.specificationsList,
          params: outcome.params,
          reasons: outcome.reasons,
          qcIncharges: outcome.qcIncharges,
        });
      } else {
        set({ loadingInitial: false });
      }
    } catch {
      set({ loadingInitial: false });
    }
  },

  setQcType: (t) => set({ qcType: t, onlineMode: t === 'Final QC' ? null : get().onlineMode }),
  setOnlineMode: (m) => set({ onlineMode: m }),

  selectCustomer: (customer) =>
    set({
      selectedCustomer: customer,
      // A new customer invalidates whatever spec/order was picked under
      // the previous one.
      selectedSpecificationFilter: null,
      orderPickLists: [],
      selectedOrderPickList: null,
      selectedControlPoint: null,
      ...freshOrderState(),
    }),

  selectSpecificationFilter: async (spec) => {
    set({
      selectedSpecificationFilter: spec,
      orderPickListsLoading: true,
      orderPickLists: [],
      selectedOrderPickList: null,
      selectedControlPoint: null,
      ...freshOrderState(),
    });
    try {
      const outcome = await karenPackhouseQcRepository.fetchFormData({ specification: spec.name });
      if (outcome.kind === 'ok') {
        set({
          orderPickListsLoading: false,
          orderPickLists: outcome.orderPickLists,
          specificationDetail: outcome.specificationDetail,
        });
      } else {
        set({ orderPickListsLoading: false });
      }
    } catch {
      set({ orderPickListsLoading: false });
    }
  },

  selectOrderPickList: async (opl) => {
    const matchedControlPoint = get().controlPoints.find((cp) => oplMatchesControlPoint(opl, cp)) ?? null;
    set({
      selectedOrderPickList: opl,
      selectedControlPoint: matchedControlPoint,
      orderDetailLoading: true,
      ...freshOrderState(),
    });
    try {
      const outcome = await karenPackhouseQcRepository.fetchFormData({ orderPickList: opl.name });
      if (outcome.kind === 'ok') {
        set({
          orderDetailLoading: false,
          itemLocations: outcome.itemLocations,
          varieties: outcome.varieties,
          // The order already tells us its variety(ies) — default to the
          // first so the operator doesn't have to pick it manually.
          selectedVariety: outcome.varieties[0] ?? null,
          boxes: outcome.boxes,
          boxTotalCount: outcome.boxTotalCount,
          specifications: outcome.specifications,
          pendingQuarantineStems: outcome.pendingQuarantineStems,
        });
      } else {
        set({ orderDetailLoading: false });
      }
    } catch {
      set({ orderDetailLoading: false });
    }
  },

  scanBoxLabel: async (raw) => {
    const boxName = extractBoxLabelFromScan(raw);
    if (!boxName) return { ok: false, message: 'Please scan a valid box code.' };

    set({ orderDetailLoading: true, selectedOrderPickList: null, selectedControlPoint: null, ...freshOrderState() });
    try {
      const outcome = await karenPackhouseQcRepository.fetchFormData({ boxLabel: boxName });
      if (outcome.kind !== 'ok' || !outcome.resolvedOrderPickList) {
        set({ orderDetailLoading: false });
        return { ok: false, message: 'Box not found, or not linked to an order.' };
      }
      const opl = outcome.resolvedOrderPickList;
      const matchedControlPoint = get().controlPoints.find((cp) => oplMatchesControlPoint(opl, cp)) ?? null;
      // The order can carry more than one variety, so default to whichever
      // one is actually recorded on THIS box (from its own box_item rows)
      // rather than just the order's first — falls back to that only when
      // the box carries no variety of its own. The server already tries a
      // customer+variety fallback match when the FK link is blank, so
      // there's nothing left for the operator to pick here — either it's
      // resolved, or there genuinely is no specification yet.
      const resolvedVariety = outcome.scannedBoxVariety || outcome.varieties[0] || null;
      set({
        orderDetailLoading: false,
        selectedOrderPickList: opl,
        selectedControlPoint: matchedControlPoint,
        itemLocations: outcome.itemLocations,
        varieties: outcome.varieties,
        selectedVariety: resolvedVariety,
        boxes: outcome.boxes,
        boxTotalCount: outcome.boxTotalCount,
        specifications: outcome.specifications,
        pendingQuarantineStems: outcome.pendingQuarantineStems,
        scannedBoxName: boxName,
        scannedBoxDetail: outcome.scannedBoxDetail,
      });
      return { ok: true };
    } catch (err) {
      set({ orderDetailLoading: false });
      return { ok: false, message: mapAxiosError(err).message };
    }
  },

  startBunchSampling: () => set((s) => ({ bunchSampling: { ...s.bunchSampling, started: true } })),

  recordBunchAccept: () =>
    set((s) => ({
      bunchSampling: {
        ...s.bunchSampling,
        accepted: s.bunchSampling.accepted + 1,
        bunchIndex: s.bunchSampling.bunchIndex + 1,
      },
    })),

  recordBunchReject: (reasonParamName) => {
    const id = issueSeed++;
    const size = stemsPerBunch(get().itemLocations);
    set((s) => ({
      issues: [...s.issues, { id, paramName: reasonParamName, count: size, action: 'Reject' }],
      bunchSampling: {
        ...s.bunchSampling,
        rejected: s.bunchSampling.rejected + 1,
        bunchIndex: s.bunchSampling.bunchIndex + 1,
      },
    }));
  },

  finishBunchSampling: () => set((s) => ({ bunchSampling: { ...s.bunchSampling, finished: true } })),

  setFinalDecision: (d) => set({ finalDecision: d }),
  setBoxesChecked: (v) => set({ boxesChecked: v }),

  addIssueForParam: (paramName) => {
    const id = issueSeed++;
    // Reject Recorder only ever rejects — there's no Quarantine option here;
    // Final QC's action gets overridden by the overall decision at submit.
    set((s) => {
      const issues = [...s.issues, { id, paramName, count: 1, action: 'Reject' as const }];
      // An order with an issue is never Accepted by default — Quarantine is
      // the safe assumption unless the operator has already decided this
      // is bad enough to Reject, which we shouldn't second-guess.
      const finalDecision =
        s.isBoxSamplingMode() && (s.finalDecision === 'Accept' || !s.finalDecision)
          ? 'Quarantine'
          : s.finalDecision;
      return { issues, finalDecision };
    });
  },
  updateIssueCount: (id, count) =>
    set((s) => ({
      issues: s.issues.map((i) => (i.id === id ? { ...i, count: Math.max(0, count) } : i)),
    })),
  removeIssue: (id) =>
    set((s) => {
      const issues = s.issues.filter((i) => i.id !== id);
      // Accept is the only valid decision once there's nothing left to
      // quarantine or reject.
      const finalDecision = s.isBoxSamplingMode() && issues.length === 0 ? 'Accept' : s.finalDecision;
      return { issues, finalDecision };
    }),

  setTotalChecked: (v) => set({ totalChecked: v }),
  setQcIncharge: (v) => set({ selectedQcIncharge: v }),
  setReason: (v) => set({ selectedReason: v }),
  setRemarks: (v) => set({ remarks: v }),

  isBunchSamplingMode: () => {
    const s = get();
    return s.qcType === 'Online QC' && s.onlineMode === 'Grading QC';
  },
  isBoxSamplingMode: () => get().qcType === 'Final QC',
  currentSpecification: () => {
    const s = get();
    if (!s.selectedVariety) return null;
    return s.specifications[s.selectedVariety] ?? null;
  },
  acceptSpecCheck: (key) =>
    set((s) => ({
      specChecks: { ...s.specChecks, [key]: { accepted: true, actualValue: '' } },
    })),
  setSpecCheckActualValue: (key, value) =>
    set((s) => ({
      specChecks: { ...s.specChecks, [key]: { accepted: false, actualValue: value } },
    })),
  customerOptions: () => {
    const seen = new Set<string>();
    for (const spec of get().specificationsList) {
      if (spec.customer) seen.add(spec.customer);
    }
    return Array.from(seen).sort();
  },
  specificationsForSelectedCustomer: () => {
    const s = get();
    if (!s.selectedCustomer) return [];
    return s.specificationsList.filter((spec) => spec.customer === s.selectedCustomer);
  },
  /** Everything the Submit button needs before it can be pressed — the
   *  whole flow is one scrolling page now, so this replaces what used to be
   *  gated step-by-step behind "Next". */
  canSubmit: () => {
    const s = get();
    if (!s.qcType) return false;
    if (s.qcType === 'Online QC' && !s.onlineMode) return false;
    if (!s.selectedOrderPickList) return false;
    if (!s.selectedQcIncharge) return false;
    // Grading QC must go through Start → Finish sampling; Reject Recorder
    // can submit with zero issues (a clean check).
    if (s.isBunchSamplingMode()) return s.bunchSampling.started && s.bunchSampling.finished;
    // Final QC needs an explicit decision, consistent with the issues list:
    // Accept requires a clean list, Quarantine/Reject require at least one
    // documented reason.
    if (s.isBoxSamplingMode()) {
      if (!s.finalDecision) return false;
      return s.finalDecision === 'Accept' ? s.issues.length === 0 : s.issues.length > 0;
    }
    return true;
  },

  submitPackhouseQc: async () => {
    const s = get();
    if (!s.qcType || !s.selectedOrderPickList) {
      const out: SubmitOutcome = { kind: 'error', message: 'Complete the earlier steps first.' };
      set({ lastSubmitMessage: out.message, lastSubmitKind: 'error' });
      return out;
    }
    if (!s.selectedQcIncharge) {
      const out: SubmitOutcome = { kind: 'error', message: 'Select a QC Incharge.' };
      set({ lastSubmitMessage: out.message, lastSubmitKind: 'error' });
      return out;
    }
    if (s.isBoxSamplingMode()) {
      if (!s.finalDecision) {
        const out: SubmitOutcome = { kind: 'error', message: 'Pick Accept, Quarantine, or Reject.' };
        set({ lastSubmitMessage: out.message, lastSubmitKind: 'error' });
        return out;
      }
      if (s.finalDecision !== 'Accept' && s.issues.length === 0) {
        const out: SubmitOutcome = {
          kind: 'error',
          message: 'Add at least one issue before quarantining or rejecting.',
        };
        set({ lastSubmitMessage: out.message, lastSubmitKind: 'error' });
        return out;
      }
    }

    const issuesTotal = s.issues.reduce((sum, i) => sum + i.count, 0);
    const totalChecked = Number.parseInt(s.totalChecked, 10) || issuesTotal;

    let issuesPayload = s.issues.map((i) => ({
      parameter: i.paramName,
      count: i.count,
      action: i.action,
    }));

    const payload: Record<string, unknown> = {
      inspection_type: s.qcType,
      inspection_mode: s.qcType === 'Online QC' ? s.onlineMode : '',
      control_point: s.selectedControlPoint?.name ?? '',
      order_pick_list: s.selectedOrderPickList.name,
      variety: s.selectedVariety ?? '',
      box_label: s.scannedBoxName ?? '',
      qc_incharge: s.selectedQcIncharge,
      reason: s.selectedReason ?? '',
      remarks: s.remarks,
      // The server only computes stems_accepted/overall_result from
      // stems_checked vs the issue tally — it never looks at boxes_checked or
      // *_affected for that math. So stems_checked must be the order's full
      // stem count, not a manually-typed sample size, or "accepted" reports
      // against the sample instead of the whole order.
      stems_checked: s.selectedOrderPickList.totalStems,
      // Whichever Specification is actually on screen — a manual/corrected
      // pick takes priority over the per-variety auto-match, same as the
      // Order Specification card itself shows.
      specification:
        s.specificationDetail?.specName ??
        (s.selectedVariety ? s.specifications[s.selectedVariety]?.specName ?? '' : ''),
    };

    if (s.isBunchSamplingMode()) {
      // "Affected" means had an issue — accepted bunches don't count here.
      payload.bunches_affected = s.bunchSampling.rejected;
    } else if (s.isBoxSamplingMode()) {
      // The operator's decision is authoritative and applies to the WHOLE
      // order, not just the boxes sampled — the server re-derives
      // stems_checked from the order's own total and overrides the tally
      // accordingly when final_decision is present, so the issues below are
      // just the documented reasons, not what drives the disposition math.
      const decision = s.finalDecision ?? 'Accept';
      payload.final_decision = decision;
      // Same pattern as stems_affected below: fall back to the suggested
      // sample size if the operator left the field blank, rather than
      // silently submitting 0 boxes checked.
      payload.boxes_checked =
        Number.parseInt(s.boxesChecked, 10) || suggestedBoxSampleSize(s.boxTotalCount);
      // "Total boxes" for the order — distinct from boxes_checked, which is
      // just the sample the operator actually inspected.
      payload.boxes_staged = s.boxTotalCount;
      issuesPayload =
        decision === 'Accept' ? [] : s.issues.map((i) => ({ parameter: i.paramName, count: i.count, action: decision }));
    } else {
      payload.stems_affected = totalChecked;
    }
    payload.issues = issuesPayload;

    set({ submitting: true });
    try {
      const outcome = await karenPackhouseQcRepository.save(payload);
      if (outcome.kind === 'ok') {
        const newCars = outcome.carsCreated.filter((c) => c.isNew);
        const carNote = newCars.length ? ` — ${newCars.length} Corrective Action Report(s) raised` : '';
        const message = `${outcome.overallResult} — ${outcome.name}${carNote}`;
        set({ submitting: false, lastSubmitMessage: message, lastSubmitKind: 'ok' });
        return { kind: 'ok', message };
      }
      set({ submitting: false, lastSubmitMessage: outcome.message, lastSubmitKind: 'error' });
      return { kind: 'error', message: outcome.message };
    } catch (err) {
      const message = mapAxiosError(err).message;
      set({ submitting: false, lastSubmitMessage: message, lastSubmitKind: 'error' });
      return { kind: 'error', message };
    }
  },

  resetAll: () => {
    set({
      qcType: null,
      onlineMode: null,
      selectedControlPoint: null,
      selectedOrderPickList: null,
      orderDetailLoading: false,
      selectedCustomer: null,
      selectedSpecificationFilter: null,
      orderPickLists: [],
      orderPickListsLoading: false,
      ...freshOrderState(),
      totalChecked: '',
      selectedQcIncharge: null,
      selectedReason: null,
      remarks: '',
      submitting: false,
      lastSubmitMessage: null,
      lastSubmitKind: null,
    });
  },
}));
