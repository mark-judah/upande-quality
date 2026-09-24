export type TraceabilityStatus =
  | 'Harvested'
  | 'Graded'
  | 'Received'
  | 'On Shelf'
  | 'Pending Issue'
  | 'Issued';

export type RoseType = 'Standards' | 'Spray Roses';

export type StageName =
  | 'Harvest'
  | 'Grading'
  | 'Receiving'
  | 'Quarantine Rejects'
  | 'Shelving'
  | 'Allocation'
  | 'Issued';

export type WhoKind = 'payroll' | 'user' | '';

export type JourneyStage = {
  stage: StageName;
  doc: string;
  date: string;
  datetime: string;
  variety: string;
  stemLength: string;
  qty: number | null;
  who: string;          // payroll number, when available
  whoKind: WhoKind;
  user: string;         // frappe user account
  detail: string;
  /** Harvest-stage extras (from the Harvesting Stock Entry). Optional so other
   *  tenants' repositories need not populate them. */
  harvestTime?: string;   // posting_time of the harvest, HH:MM:SS
  cutStage?: string;      // custom_cut_stage
  receivingTime?: string; // posting_time of the receiving, HH:MM:SS
  shelvingTime?: string;  // time portion of the Shelf Item date_added, HH:MM:SS
};

export type BunchInfo = {
  bunchId: string;
  variety: string;
  stemLength: string;
  bunchSize: string;
  farm: string;
};

/** One bunch in a spray-roses grading session. */
export type SessionBunch = {
  bunchId: string;
  variety: string;
  stemLength: string;
  bunchSize: string;
  gradingSe: string;
  gradingStemLength: string;
  gradedBy: string;
  issuedOpl: string;
};

/** Allocation snapshot from Bucket Allocation Status — canonical for "how many stems
 *  are allocated vs available right now". */
export type BucketAllocationSnapshot = {
  exists: boolean;
  variety: string;
  stemLength: string;
  shelfLocation: string;
  shelfFarm: string;
  totalQuantity: number;
  allocatedQuantity: number;
  availableQuantity: number;
  isAllocated: boolean;
  fullyAllocated: boolean;
  harvestDate: string;
};

// ── Box traceability ────────────────────────────────────────────────────────
// A box holds several buckets, each with its own greenhouse→pick trail; they
// converge at packing and dispatch. Separate from the single-trail bucket/bunch
// journey model above.
export type BoxHarvest = {
  greenhouse: string;
  farm: string;
  harvester: string;
  cutStage: string;
  date: string;
  time: string;
};
export type BoxReceiving = { warehouse: string; date: string; time: string };
export type BoxGrading = { gradedBy: string; stemLength: string; bunchId: string; date: string };
export type BoxShelving = { shelf: string; greenhouse: string; date: string; shelvedBy: string };
export type BoxPicked = { forBox: string; date: string; pickedBy: string };

export type BoxBucketTrace = {
  bucket: string;
  variety: string;
  stemLength: string;
  harvest: BoxHarvest | null;
  receiving: BoxReceiving | null;
  grading: BoxGrading | null;
  shelving: BoxShelving | null;
  picked: BoxPicked | null;
};

export type BoxDispatch = {
  salesOrder: string;
  orderName: string;
  customer: string;
  consignee: string;
  deliveryPoint: string;
  freightAgent: string;
  truck: string;
  deliveryNote: string;
  delivered: boolean;
  date: string;
};

export type BoxTraceability = {
  boxLabel: string;
  boxNumber: string;
  boxTotalCount: string;
  orderPickList: string;
  orderName: string;
  customer: string;
  length: string;
  packRate: string;
  farm: string;
  packedOn: string;
  packedBy: string;
  exactBuckets: boolean;
  buckets: BoxBucketTrace[];
  dispatch: BoxDispatch;
};

export type TraceabilitySnapshot = {
  kind: 'bucket' | 'bunch' | 'box';
  roseType: RoseType;
  bucketId: string;
  bunchId: string;
  status: TraceabilityStatus;
  variety: string;
  farm: string;
  greenhouse: string;
  stemLength: string;
  numberOfStems: number | null;
  date: string | null;
  batchNo: string;
  sessionSize: number;
  bunchInfo: BunchInfo | null;
  bunches: SessionBunch[];
  stages: JourneyStage[];
  warnings: string[];
  allocation: BucketAllocationSnapshot | null;
  /** Populated only when kind === 'box'. */
  box?: BoxTraceability | null;
};

export type TraceabilityQuery =
  | { kind: 'bucket'; id: string }
  | { kind: 'bunch'; id: string }
  | { kind: 'box'; id: string };

/** Traceability is read-only by design — actions live in the Replacement feature. */
export interface TraceabilityRepository {
  lookup(query: TraceabilityQuery): Promise<TraceabilitySnapshot>;
}
