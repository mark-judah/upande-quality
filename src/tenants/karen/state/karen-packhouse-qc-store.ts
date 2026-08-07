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

export type QcType = 'Online QC' | 'Final QC' | 'Airport Returns';
export type OnlineMode = 'Reject Recorder' | 'Grading QC';
export type IssueAction = 'Quarantine' | 'Reject' | 'Reuse';

/** Airport Returns — a scan-based Final QC on boxes/stems that came back from
 *  the airport. Scanning the box fetches the order context; the operator picks
 *  a reason, records how many stems were inspected, and splits the affected
 *  stems between Reuse (shelved back to the Kapkolia cold room, keeping their
 *  age/farm/greenhouse) and Reject (moved to rejects). Fetched fields stay
 *  editable because a few (invoice, packhouse) aren't on the box label. */
export type AirportReturnState = {
  invoiceNumber: string;
  daysInStock: string;
  packhouse: string;
  greenhouse: string;
  farm: string;
  stemsReturned: string;
  reason: string;
  inspectedStems: string;
  reuseStems: string;
  rejectStems: string;
};

function emptyAirportReturn(): AirportReturnState {
  return {
    invoiceNumber: '',
    daysInStock: '',
    packhouse: '',
    greenhouse: '',
    farm: '',
    stemsReturned: '',
    reason: '',
    inspectedStems: '',
    reuseStems: '',
    rejectStems: '',
  };
}
/** Final QC's order-level call. It's AUTO-SUGGESTED from the tolerance checks
 *  (any issue over its parameter's threshold → Quarantine, else Accept), but
 *  the operator can override it. Accept keeps in-tolerance issues as partial
 *  bunch-rejects; Quarantine/Reject apply to the WHOLE order. */
export type FinalDecision = 'Accept' | 'Quarantine' | 'Reject';

/** The three physical checks the operator verifies against the box while
 *  reading the Order Specification card — tap Accepted when it matches, or
 *  note what was actually found when it doesn't. */
export type SpecCheckKey = 'cutStage' | 'defoliationLength' | 'rubberBand';
export type SpecCheckState = { accepted: boolean; actualValue: string; bunchesAffected: string };
export type SpecChecks = Record<SpecCheckKey, SpecCheckState>;

/** Human-readable parameter name each spec check contributes to the issues
 *  list under when the operator records affected bunches against it. */
const SPEC_CHECK_LABELS: Record<SpecCheckKey, string> = {
  cutStage: 'Cut Stage',
  defoliationLength: 'Defoliation Length',
  rubberBand: 'Rubber Band',
};

function emptySpecCheckState(): SpecCheckState {
  return { accepted: false, actualValue: '', bunchesAffected: '' };
}

function emptySpecChecks(): SpecChecks {
  return {
    cutStage: emptySpecCheckState(),
    defoliationLength: emptySpecCheckState(),
    rubberBand: emptySpecCheckState(),
  };
}

/** Which auto-generated issue (if any) each spec check currently owns, so an
 *  edited affected-bunch count updates that same issue instead of piling up
 *  duplicates. */
function emptySpecCheckIssueIds(): Record<SpecCheckKey, number | null> {
  return { cutStage: null, defoliationLength: null, rubberBand: null };
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

/** Grading QC sampling — the operator records the total bunches they accepted
 *  and adds a row per rejection reason (with its affected bunch count), then
 *  finishes. Reject Recorder and Grading QC never quarantine — only Final QC
 *  does. */
type BunchSamplingState = {
  started: boolean;
  finished: boolean;
  /** Bunches the operator passed, entered as a whole number. */
  acceptedBunches: string;
};

function emptyBunchSampling(): BunchSamplingState {
  return { started: false, finished: false, acceptedBunches: '' };
}

/** One rejection reason recorded during Grading QC sampling, with the number
 *  of bunches it affected. Each mirrors an issue row (id-matched) so the QC
 *  tally, tolerance badges and submit payload all see it. */
export type BunchRejection = { id: number; reason: string; bunches: string };

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
  /** Count of active orders (today + yesterday) keyed by Specification
   *  name — used to show a green tick against specs that have orders to QC
   *  in the spec picker, before one is chosen. */
  specOrderCounts: Record<string, number>;
  /** The operator picks a customer first, then a spec — narrows the
   *  (potentially long) spec list down to just that customer's. */
  selectedCustomer: string | null;
  selectedSpecificationFilter: SpecificationListItem | null;
  /** Alternative to the customer→spec path: pick a team to reach orders that
   *  have no specification linked (they never show under any spec). Mutually
   *  exclusive with selectedSpecificationFilter. */
  selectedTeamFilter: string | null;
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
  /** The issue-list row each failed spec check owns, so its affected-bunch
   *  count stays in sync instead of adding duplicates. */
  specCheckIssueIds: Record<SpecCheckKey, number | null>;
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
  /** Grading QC only — one row per rejection reason with its affected bunch
   *  count; kept id-matched to the corresponding issue rows. */
  bunchRejections: BunchRejection[];
  /** Airport Returns only — the scanned box's return context plus the
   *  operator's reason / inspected / reuse / reject entry. */
  airportReturn: AirportReturnState;

  /** Final QC only — how many boxes the operator actually sampled. Every
   *  bunch in these boxes is inspected; issues are counted in bunches. */
  boxesChecked: string;
  /** Final QC's manual override of the auto-suggested decision — null means
   *  "follow the suggestion", which tracks the tolerance checks live. */
  finalDecisionOverride: FinalDecision | null;

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
  /** Loads the spec-less orders for a team (Team A/B, Jamafa, Eldama, Bravo). */
  selectTeamFilter: (team: string) => Promise<void>;
  /** Clears both the spec and team filters and the loaded order list — used
   *  when the operator switches between the two filter paths. */
  resetOrderFilters: () => void;
  selectOrderPickList: (opl: OrderPickListOption) => Promise<void>;
  /** Scans a box to resolve its order directly — an alternative to searching
   *  the Order Pick List picker. */
  scanBoxLabel: (raw: string) => Promise<{ ok: boolean; message?: string }>;
  /** Airport Returns — scans a returned box and fetches its return context. */
  scanAirportReturn: (raw: string) => Promise<{ ok: boolean; message?: string }>;
  /** Updates one field of the airport-return form (fetched values are editable). */
  setAirportReturnField: (field: keyof AirportReturnState, value: string) => void;

  startBunchSampling: () => void;
  /** Sets the whole-number count of bunches the operator accepted. */
  setBunchesAccepted: (value: string) => void;
  /** Adds a rejection reason row (default 1 bunch) and its mirrored issue. */
  addBunchRejection: (reasonParamName: string) => void;
  /** Updates a rejection row's affected bunch count and its mirrored issue. */
  setBunchRejectionBunches: (id: number, value: string) => void;
  /** Removes a rejection row and its mirrored issue. */
  removeBunchRejection: (id: number) => void;
  finishBunchSampling: () => void;

  setBoxesChecked: (v: string) => void;
  /** Override the auto-suggested Final QC decision (or pass the suggestion
   *  itself — it just pins the choice manually). */
  setFinalDecision: (d: FinalDecision) => void;
  /** The decision auto-suggested purely from the tolerance checks. */
  suggestedFinalDecision: () => FinalDecision;
  /** What will actually be submitted — the override if set, else the
   *  suggestion. */
  effectiveFinalDecision: () => FinalDecision;

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
  /** Toggles a spec check's Accepted state — accepting clears any noted
   *  actual value / affected count and removes the issue it had raised. */
  acceptSpecCheck: (key: SpecCheckKey) => void;
  /** Notes what was actually found for a spec check — implies it doesn't
   *  match, so this un-accepts it. */
  setSpecCheckActualValue: (key: SpecCheckKey, value: string) => void;
  /** Records how many bunches failed a spec check (cut stage, defoliation,
   *  rubber band). Any positive count auto-adds/updates a matching row in the
   *  issues list; clearing it back to zero removes that row again. */
  setSpecCheckBunchesAffected: (key: SpecCheckKey, value: string) => void;
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

/** The unit being counted differs by mode. Final QC now samples every bunch
 *  in the sampled boxes, so its issues are counted in bunches too. */
export function issueCountLabel(onlineMode: OnlineMode | null, qcType: QcType | null): string {
  if (onlineMode === 'Grading QC') return 'Bunches Affected';
  if (qcType === 'Final QC') return 'Bunches Affected';
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

/** Final QC samples EVERY bunch in the sampled boxes, so the inspected bunch
 *  count is boxes checked × the spec's bunches-per-box. Zero when either input
 *  is unknown — callers treat an unknown sample size conservatively. */
export function sampledBunches(boxesChecked: number, bunchesPerBox: number): number {
  if (boxesChecked <= 0 || bunchesPerBox <= 0) return 0;
  return boxesChecked * bunchesPerBox;
}

/** Affected bunches as a percentage of the bunches actually sampled — 0 when
 *  the sample size can't be derived. */
export function affectedPercent(affectedBunches: number, sampled: number): number {
  if (sampled <= 0) return 0;
  return (affectedBunches / sampled) * 100;
}

/** Whether an issue breaches its parameter's tolerance — which quarantines
 *  the WHOLE order. Zero-tolerance parameters (pests, disease) breach on any
 *  affected bunch; a percentage tolerance breaches once affected% exceeds it.
 *  When the sample size can't be derived we treat any affected bunch as a
 *  breach, since we can't prove it's within tolerance. */
export function isThresholdBreached(affectedBunches: number, sampled: number, thresholdPercent: number): boolean {
  if (affectedBunches <= 0) return false;
  if (thresholdPercent <= 0) return true;
  if (sampled <= 0) return true;
  return affectedPercent(affectedBunches, sampled) > thresholdPercent;
}

/** The Specification actually on screen for Final QC — a directly picked /
 *  overridden spec wins over the per-variety auto-match, same as the UI. */
function resolveFinalQcSpec(s: State): SpecificationMatch | null {
  return s.specificationDetail ?? (s.selectedVariety ? s.specifications[s.selectedVariety] ?? null : null);
}

/** Turn a spec check's affected count into the unit the current mode's issue
 *  tally expects, mirroring the submit-time conversion exactly. Final QC counts
 *  issues in bunches (converted to stems at submit). Reject Recorder deals only
 *  in stems, so the operator enters the affected count in stems directly — no
 *  conversion. Grading QC enters bunches, stored as stems (× stems-per-bunch),
 *  or the rejected stems would be under-counted by that factor. */
function specCheckIssueCount(s: State, affected: number): number {
  if (affected <= 0) return 0;
  if (s.qcType === 'Final QC') return affected;
  if (s.onlineMode === 'Reject Recorder') return affected;
  const spec = resolveFinalQcSpec(s);
  const perBunch = spec?.stemsPerBunch && spec.stemsPerBunch > 0 ? spec.stemsPerBunch : stemsPerBunch(s.itemLocations);
  return Math.max(1, Math.round(affected * perBunch));
}

/** Bunches inspected in Final QC = boxes sampled × the spec's bunches-per-box
 *  (falls back to the 30% suggestion when the operator hasn't typed a count). */
function finalQcSampled(s: State): number {
  const spec = resolveFinalQcSpec(s);
  const boxes = Number.parseInt(s.boxesChecked, 10) || suggestedBoxSampleSize(s.boxTotalCount);
  return sampledBunches(boxes, spec?.bunchesPerBox ?? 0);
}

/** Whether any recorded issue breaches its parameter's tolerance — the signal
 *  that auto-suggests quarantining the whole order. */
function finalQcAnyBreach(s: State): boolean {
  const sampled = finalQcSampled(s);
  return s.issues.some((i) => {
    const threshold = s.params.find((p) => p.name === i.paramName)?.toleranceThresholds ?? 0;
    return isThresholdBreached(i.count, sampled, threshold);
  });
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
    specCheckIssueIds: emptySpecCheckIssueIds(),
    selectedVariety: null as string | null,
    scannedBoxName: null as string | null,
    scannedBoxDetail: null as ScannedBoxDetail | null,
    pendingQuarantineStems: 0,
    bunchSampling: emptyBunchSampling(),
    bunchRejections: [] as BunchRejection[],
    airportReturn: emptyAirportReturn(),
    boxesChecked: '' as string,
    finalDecisionOverride: null as FinalDecision | null,
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
  specOrderCounts: {},
  selectedCustomer: null,
  selectedSpecificationFilter: null,
  selectedTeamFilter: null,
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
  specCheckIssueIds: emptySpecCheckIssueIds(),
  orderDetailLoading: false,
  pendingQuarantineStems: 0,

  selectedVariety: null,
  scannedBoxName: null,
  scannedBoxDetail: null,

  bunchSampling: emptyBunchSampling(),
  bunchRejections: [],
  airportReturn: emptyAirportReturn(),
  boxesChecked: '',
  finalDecisionOverride: null,

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
          specOrderCounts: outcome.specOrderCounts,
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
      selectedTeamFilter: null,
      orderPickLists: [],
      selectedOrderPickList: null,
      selectedControlPoint: null,
      ...freshOrderState(),
    }),

  selectSpecificationFilter: async (spec) => {
    set({
      selectedSpecificationFilter: spec,
      selectedTeamFilter: null,
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

  selectTeamFilter: async (team) => {
    set({
      selectedTeamFilter: team,
      selectedSpecificationFilter: null,
      orderPickListsLoading: true,
      orderPickLists: [],
      selectedOrderPickList: null,
      selectedControlPoint: null,
      ...freshOrderState(),
    });
    try {
      const outcome = await karenPackhouseQcRepository.fetchFormData({ team });
      if (outcome.kind === 'ok') {
        set({
          orderPickListsLoading: false,
          orderPickLists: outcome.orderPickLists,
          // Team-filtered orders have no spec — clear any lingering detail.
          specificationDetail: null,
        });
      } else {
        set({ orderPickListsLoading: false });
      }
    } catch {
      set({ orderPickListsLoading: false });
    }
  },

  resetOrderFilters: () =>
    set({
      selectedSpecificationFilter: null,
      selectedTeamFilter: null,
      orderPickLists: [],
      orderPickListsLoading: false,
      selectedOrderPickList: null,
      selectedControlPoint: null,
      ...freshOrderState(),
    }),

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

  scanAirportReturn: async (raw) => {
    const boxName = extractBoxLabelFromScan(raw);
    if (!boxName) return { ok: false, message: 'Please scan a valid box code.' };

    set({ orderDetailLoading: true, selectedOrderPickList: null, selectedControlPoint: null, ...freshOrderState() });
    try {
      const outcome = await karenPackhouseQcRepository.fetchFormData({ boxLabel: boxName, airportReturn: true });
      if (outcome.kind !== 'ok' || !outcome.resolvedOrderPickList) {
        set({ orderDetailLoading: false });
        return { ok: false, message: 'Box not found, or not linked to an order.' };
      }
      const opl = outcome.resolvedOrderPickList;
      const resolvedVariety = outcome.scannedBoxVariety || outcome.varieties[0] || null;
      const ar = outcome.airportReturnDetail;
      set({
        orderDetailLoading: false,
        selectedOrderPickList: opl,
        itemLocations: outcome.itemLocations,
        varieties: outcome.varieties,
        selectedVariety: resolvedVariety,
        specifications: outcome.specifications,
        scannedBoxName: boxName,
        scannedBoxDetail: outcome.scannedBoxDetail,
        airportReturn: {
          ...emptyAirportReturn(),
          invoiceNumber: ar?.invoiceNumber ?? '',
          daysInStock: ar?.daysInStock != null ? String(ar.daysInStock) : '',
          packhouse: ar?.packhouse ?? '',
          greenhouse: ar?.greenhouse ?? '',
          farm: ar?.farm ?? opl.farm ?? '',
          stemsReturned: ar?.stemsReturned != null ? String(ar.stemsReturned) : '',
        },
      });
      return { ok: true };
    } catch (err) {
      set({ orderDetailLoading: false });
      return { ok: false, message: mapAxiosError(err).message };
    }
  },

  setAirportReturnField: (field, value) =>
    set((s) => ({ airportReturn: { ...s.airportReturn, [field]: value } })),

  startBunchSampling: () => set((s) => ({ bunchSampling: { ...s.bunchSampling, started: true } })),

  setBunchesAccepted: (value) =>
    set((s) => ({ bunchSampling: { ...s.bunchSampling, acceptedBunches: value } })),

  addBunchRejection: (reasonParamName) => {
    const id = issueSeed++;
    // Grading QC issues are tallied in stems (the server sums issue counts as
    // stems and compares to the order's full stem total), so mirror each
    // rejection's bunches into stems on the linked issue while keeping the
    // operator-entered bunch count on the row itself. Default to 1 bunch.
    const perBunch = stemsPerBunch(get().itemLocations);
    set((s) => ({
      bunchRejections: [...s.bunchRejections, { id, reason: reasonParamName, bunches: '1' }],
      issues: [...s.issues, { id, paramName: reasonParamName, count: perBunch, action: 'Reject' as const }],
    }));
  },

  setBunchRejectionBunches: (id, value) =>
    set((s) => {
      const bunches = Math.max(0, Number.parseInt(value, 10) || 0);
      const perBunch = stemsPerBunch(s.itemLocations);
      return {
        bunchRejections: s.bunchRejections.map((r) => (r.id === id ? { ...r, bunches: value } : r)),
        issues: s.issues.map((i) => (i.id === id ? { ...i, count: bunches * perBunch } : i)),
      };
    }),

  removeBunchRejection: (id) =>
    set((s) => ({
      bunchRejections: s.bunchRejections.filter((r) => r.id !== id),
      issues: s.issues.filter((i) => i.id !== id),
    })),

  finishBunchSampling: () => set((s) => ({ bunchSampling: { ...s.bunchSampling, finished: true } })),

  setBoxesChecked: (v) => set({ boxesChecked: v }),
  setFinalDecision: (d) => set({ finalDecisionOverride: d }),
  suggestedFinalDecision: () => (finalQcAnyBreach(get()) ? 'Quarantine' : 'Accept'),
  effectiveFinalDecision: () => {
    const s = get();
    return s.finalDecisionOverride ?? (finalQcAnyBreach(s) ? 'Quarantine' : 'Accept');
  },

  addIssueForParam: (paramName) => {
    const id = issueSeed++;
    // Reject Recorder only ever rejects; Final QC's action is derived from
    // the parameter's tolerance at submit (breach → Quarantine, else Reject),
    // so the stored action here is just a harmless default.
    set((s) => ({ issues: [...s.issues, { id, paramName, count: 1, action: 'Reject' as const }] }));
  },
  updateIssueCount: (id, count) =>
    set((s) => ({
      issues: s.issues.map((i) => (i.id === id ? { ...i, count: Math.max(0, count) } : i)),
    })),
  removeIssue: (id) =>
    set((s) => {
      // If this row was raised by a spec check, release the link and clear
      // that check's affected-bunch field so the two stay consistent.
      const specKey = (Object.keys(s.specCheckIssueIds) as SpecCheckKey[]).find(
        (k) => s.specCheckIssueIds[k] === id,
      );
      return {
        issues: s.issues.filter((i) => i.id !== id),
        // Keep the Grading QC rejection list in step if this row came from it.
        bunchRejections: s.bunchRejections.some((r) => r.id === id)
          ? s.bunchRejections.filter((r) => r.id !== id)
          : s.bunchRejections,
        specCheckIssueIds: specKey ? { ...s.specCheckIssueIds, [specKey]: null } : s.specCheckIssueIds,
        specChecks: specKey
          ? { ...s.specChecks, [specKey]: { ...s.specChecks[specKey], bunchesAffected: '' } }
          : s.specChecks,
      };
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
    set((s) => {
      // Toggle: tapping an already-accepted check re-opens it for editing.
      if (s.specChecks[key].accepted) {
        return {
          specChecks: { ...s.specChecks, [key]: { ...s.specChecks[key], accepted: false } },
        };
      }
      // Accepting clears any noted value / affected count and drops the issue
      // this check had raised.
      const issueId = s.specCheckIssueIds[key];
      return {
        specChecks: { ...s.specChecks, [key]: { accepted: true, actualValue: '', bunchesAffected: '' } },
        issues: issueId != null ? s.issues.filter((i) => i.id !== issueId) : s.issues,
        specCheckIssueIds: { ...s.specCheckIssueIds, [key]: null },
      };
    }),
  setSpecCheckActualValue: (key, value) =>
    set((s) => ({
      specChecks: { ...s.specChecks, [key]: { ...s.specChecks[key], accepted: false, actualValue: value } },
    })),
  setSpecCheckBunchesAffected: (key, value) =>
    set((s) => {
      const bunches = Math.max(0, Number.parseInt(value, 10) || 0);
      const count = specCheckIssueCount(s, bunches);
      const existingId = s.specCheckIssueIds[key];
      // Recording an affected count always means the check didn't pass.
      const specChecks = {
        ...s.specChecks,
        [key]: { ...s.specChecks[key], accepted: false, bunchesAffected: value },
      };
      if (count > 0) {
        if (existingId != null) {
          return {
            specChecks,
            issues: s.issues.map((i) => (i.id === existingId ? { ...i, count } : i)),
          };
        }
        const id = issueSeed++;
        return {
          specChecks,
          issues: [...s.issues, { id, paramName: SPEC_CHECK_LABELS[key], count, action: 'Reject' as const }],
          specCheckIssueIds: { ...s.specCheckIssueIds, [key]: id },
        };
      }
      // Cleared back to zero → drop the linked issue.
      return {
        specChecks,
        issues: existingId != null ? s.issues.filter((i) => i.id !== existingId) : s.issues,
        specCheckIssueIds: existingId != null ? { ...s.specCheckIssueIds, [key]: null } : s.specCheckIssueIds,
      };
    }),
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
    // Airport Returns: needs a reason and at least one stem dispositioned
    // (reused and/or rejected).
    if (s.qcType === 'Airport Returns') {
      const ar = s.airportReturn;
      const reuse = Number.parseInt(ar.reuseStems, 10) || 0;
      const reject = Number.parseInt(ar.rejectStems, 10) || 0;
      return Boolean(ar.reason) && reuse + reject > 0;
    }
    // Grading QC must go through Start → Finish sampling; Reject Recorder
    // can submit with zero issues (a clean check).
    if (s.isBunchSamplingMode()) return s.bunchSampling.started && s.bunchSampling.finished;
    // Final QC: a sample size must be resolvable (typed, or the 30% default
    // once boxes are known), and every recorded issue needs a bunch count.
    // Zero issues is a valid clean Accept; Quarantine/Reject need at least one
    // documented issue.
    if (s.isBoxSamplingMode()) {
      const boxes = Number.parseInt(s.boxesChecked, 10) || suggestedBoxSampleSize(s.boxTotalCount);
      if (boxes <= 0) return false;
      if (!s.issues.every((i) => i.count > 0)) return false;
      const decision = s.finalDecisionOverride ?? (finalQcAnyBreach(s) ? 'Quarantine' : 'Accept');
      if (decision !== 'Accept' && s.issues.length === 0) return false;
      return true;
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

    if (s.qcType === 'Airport Returns') {
      const ar = s.airportReturn;
      const reuse = Math.max(0, Number.parseInt(ar.reuseStems, 10) || 0);
      const reject = Math.max(0, Number.parseInt(ar.rejectStems, 10) || 0);
      const inspected = Number.parseInt(ar.inspectedStems, 10) || 0;
      if (!ar.reason) {
        const out: SubmitOutcome = { kind: 'error', message: 'Pick a reason for the return.' };
        set({ lastSubmitMessage: out.message, lastSubmitKind: 'error' });
        return out;
      }
      if (reuse + reject <= 0) {
        const out: SubmitOutcome = { kind: 'error', message: 'Record how many stems were reused and/or rejected.' };
        set({ lastSubmitMessage: out.message, lastSubmitKind: 'error' });
        return out;
      }
      // Each disposition becomes an issue row (reason = the parameter), split
      // between Reuse (shelved to Kapkolia) and Reject (moved to rejects).
      const airportIssues: { parameter: string; count: number; action: IssueAction }[] = [];
      if (reuse > 0) airportIssues.push({ parameter: ar.reason, count: reuse, action: 'Reuse' });
      if (reject > 0) airportIssues.push({ parameter: ar.reason, count: reject, action: 'Reject' });
      const spec =
        s.specificationDetail?.specName ??
        (s.selectedVariety ? s.specifications[s.selectedVariety]?.specName ?? '' : '');
      const payload: Record<string, unknown> = {
        inspection_type: 'Final QC',
        inspection_mode: '',
        control_area: 'Airport Returns',
        order_pick_list: s.selectedOrderPickList.name,
        box_label: s.scannedBoxName ?? '',
        variety: s.selectedVariety ?? '',
        qc_incharge: s.selectedQcIncharge,
        invoice_number: ar.invoiceNumber,
        reason: ar.reason,
        // Inspected stems is what was checked; affected = reused + rejected.
        stems_checked: inspected || reuse + reject,
        sampled_stems: inspected || reuse + reject,
        stems_affected: reuse + reject,
        packhouse: ar.packhouse,
        greenhouse: ar.greenhouse,
        farm: ar.farm,
        stock_age: Number.parseInt(ar.daysInStock, 10) || 0,
        length: s.scannedBoxDetail?.length ?? '',
        specification: spec,
        remarks: s.remarks,
        issues: airportIssues,
      };
      set({ submitting: true });
      try {
        const outcome = await karenPackhouseQcRepository.save(payload);
        if (outcome.kind === 'ok') {
          const message = `Airport return recorded — ${outcome.name}`;
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
    }

    if (s.isBoxSamplingMode()) {
      const boxes = Number.parseInt(s.boxesChecked, 10) || suggestedBoxSampleSize(s.boxTotalCount);
      if (boxes <= 0) {
        const out: SubmitOutcome = { kind: 'error', message: 'Enter how many boxes you sampled.' };
        set({ lastSubmitMessage: out.message, lastSubmitKind: 'error' });
        return out;
      }
      const decision = s.finalDecisionOverride ?? (finalQcAnyBreach(s) ? 'Quarantine' : 'Accept');
      if (decision !== 'Accept' && s.issues.length === 0) {
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
      // Total rejected bunches across every recorded rejection reason.
      const rejectedBunches = s.bunchRejections.reduce(
        (sum, r) => sum + (Number.parseInt(r.bunches, 10) || 0),
        0,
      );
      payload.bunches_affected = rejectedBunches;
      // FTR denominator for the CAR 6% rule: everything inspected (accepted +
      // rejected bunches), converted to stems to match the issue counts.
      const acceptedBunches = Number.parseInt(s.bunchSampling.acceptedBunches, 10) || 0;
      const gradingSpec = resolveFinalQcSpec(s);
      const gradingPerBunch =
        gradingSpec?.stemsPerBunch && gradingSpec.stemsPerBunch > 0
          ? gradingSpec.stemsPerBunch
          : stemsPerBunch(s.itemLocations);
      payload.sampled_stems = (acceptedBunches + rejectedBunches) * gradingPerBunch;
    } else if (s.isBoxSamplingMode()) {
      // The order-level decision is auto-suggested from the tolerance checks
      // (any issue over threshold → Quarantine, else Accept) but the operator
      // may have overridden it. Accept keeps issues as partial bunch-rejects;
      // Quarantine/Reject apply to the whole order (the server re-derives the
      // order's full stem total for those).
      const decision = s.finalDecisionOverride ?? (finalQcAnyBreach(s) ? 'Quarantine' : 'Accept');
      const spec = resolveFinalQcSpec(s);
      const boxesChecked = Number.parseInt(s.boxesChecked, 10) || suggestedBoxSampleSize(s.boxTotalCount);
      // Prefer the spec's stems-per-bunch; fall back to the order's own
      // bunches/stems ratio so a rejected bunch still converts to real stems.
      const perBunch = spec?.stemsPerBunch && spec.stemsPerBunch > 0 ? spec.stemsPerBunch : stemsPerBunch(s.itemLocations);
      const action: IssueAction = decision === 'Quarantine' ? 'Quarantine' : 'Reject';
      issuesPayload = s.issues.map((i) => ({
        parameter: i.paramName,
        // The server tallies in stems, so convert affected bunches to stems.
        // For a whole-order Quarantine/Reject the count is documentation only;
        // for Accept it drives the partial bunch-reject stock movement.
        count: Math.max(0, Math.round(i.count * perBunch)),
        action,
      }));
      payload.final_decision = decision;
      payload.boxes_checked = boxesChecked;
      // "Total boxes" for the order — distinct from boxes_checked, the sample.
      payload.boxes_staged = s.boxTotalCount;
      // FTR denominator for the CAR 6% rule: bunches actually sampled (boxes
      // checked × bunches/box), converted to stems to match the issue counts.
      payload.sampled_stems = sampledBunches(boxesChecked, spec?.bunchesPerBox ?? 0) * perBunch;
    } else {
      payload.stems_affected = totalChecked;
      // FTR denominator for the CAR 6% rule: the stems the operator inspected.
      payload.sampled_stems = totalChecked;
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
      selectedTeamFilter: null,
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
