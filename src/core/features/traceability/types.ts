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

export type TraceabilitySnapshot = {
  kind: 'bucket' | 'bunch';
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
};

export type TraceabilityQuery =
  | { kind: 'bucket'; id: string }
  | { kind: 'bunch'; id: string };

/** Traceability is read-only by design — actions live in the Replacement feature. */
export interface TraceabilityRepository {
  lookup(query: TraceabilityQuery): Promise<TraceabilitySnapshot>;
}
