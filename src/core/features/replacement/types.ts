/**
 * Replacement and pending-reshelving types.
 *
 * The "replacement" feature lets a user with the Harvest Details Updater role
 * either swap a whole bucket (allocated/issued elsewhere) for a shelved one with
 * matching variety+length+farm, OR move a single bunch out of its current bucket
 * after correcting its claimed variety/stem length. If no destination bucket
 * exists yet, the bunch is flagged "pending reshelving" — see the page of the
 * same name.
 */

export type ReplacementCandidate = {
  bucketId: string;
  shelf: string;
  greenhouse: string;
  warehouse: string;
  variety: string;
  stemLength: string;
  dateAdded: string;
  ageDays: number | null;
  /** Total stems physically on the shelf. */
  stemQty: number | null;
  /** Stems already allocated to OPLs (from Bucket Allocation Status). */
  allocatedQty: number;
  /** Stems still spendable. Never negative. */
  availableQty: number;
};

export type ReplacementCandidatesResult = {
  criteria: { variety: string; stemLength: string; farm: string };
  candidates: ReplacementCandidate[];
};

export type BucketReplaceOutcome =
  | { ok: true; message: string; oldBucket: string; newBucket: string; opl: string }
  | { ok: false; error: string };

/** One OPL allocation slot a bucket is currently assigned to. */
export type BucketOplAllocation = {
  pickListItem: string;
  oplName: string;
  orderName: string;
  customer: string;
  team: string;
  dateCreated: string;
  totalStems: number;
  oplStatus: string;
  salesOrder: string;
  saleOrderItem: string;
  itemCode: string;
  stemLength: string;
  stemsFromThisBucket: number;
  bunchesFromThisBucket: number;
  issued: boolean;
};

export type BunchMovePayload = {
  bunchId: string;
  sourceBucketId: string;
  /** New variety, if correcting */
  variety?: string;
  /** New stem length, if correcting */
  stemLength?: string;
  /** Destination bucket on a shelf. Omit to flag pending reshelving. */
  destBucketId?: string;
};

export type StemReplaceOutcome =
  | {
      ok: true;
      message: string;
      donorBucket: string;
      donorShelf: string;
      stems: number;
      donorRemainingStems: number;
      destinationBucket: string;
      opl: string;
    }
  | { ok: false; error: string };

export type DetailsCorrectionPayload = {
  kind: 'bunch' | 'bucket';
  id: string;
  /** Required when kind=bunch. */
  bucketId?: string;
  variety?: string;
  stemLength?: string;
};

export type DetailsCorrectionOutcome =
  | { ok: true; message: string; kind: 'bunch' | 'bucket'; id: string; updates: string[] }
  | { ok: false; error: string };

export type BunchMoveOutcome =
  | {
      ok: true;
      status: 'moved' | 'pending';
      message: string;
      bunchId: string;
      sourceBucket: string;
      destBucket?: string;
      destShelf?: string;
      stemsMoved?: number;
      correctedVariety?: string;
      correctedStemLength?: string;
    }
  | { ok: false; error: string };

export type PendingBunch = {
  gradingSe: string;
  bunchId: string;
  sourceBucket: string;
  pendingSince: string;
  variety: string;
  stemLength: string;
  bunchSize: string;
  farm: string;
  flaggedBy: string;
};

export interface ReplacementRepository {
  /** Whole-bucket replacement. */
  listBucketCandidates(bucketId: string): Promise<ReplacementCandidatesResult>;
  /** OPLs that this bucket is currently allocated to. One entry per Pick List Item. */
  listBucketOpls(bucketId: string): Promise<BucketOplAllocation[]>;
  /** Swap this bucket for `newBucketId`, scoped to a specific Pick List Item. */
  replaceBucket(
    bucketId: string,
    newBucketId: string,
    pickListItem: string,
  ): Promise<BucketReplaceOutcome>;

  /** Stem-level replacement — decrement a donor's shelf stock, log the swap. */
  replaceStems(payload: {
    pickListItem: string;
    donorBucketId: string;
    stems: number;
    reason?: string;
  }): Promise<StemReplaceOutcome>;

  /**
   * After moveBunch has removed a defective/mis-detailed bunch from an OPL,
   * allocate a replacement bunch from a donor — restores the PLI and decrements
   * the donor's shelf stock. Defaults to one bunch (PLI conversion_factor).
   */
  replaceBunchInOpl(payload: {
    pickListItem: string;
    donorBucketId: string;
    stems?: number;
    reason?: string;
  }): Promise<StemReplaceOutcome>;

  /** Correct bunch OR bucket variety / stem length (no movement). */
  correctDetails(payload: DetailsCorrectionPayload): Promise<DetailsCorrectionOutcome>;

  /** Bunch-level move (with optional corrections + optional destination). */
  listBunchDestinations(
    variety: string,
    stemLength: string,
    farm: string,
    excludeBucket?: string,
  ): Promise<ReplacementCandidatesResult>;
  moveBunch(payload: BunchMovePayload): Promise<BunchMoveOutcome>;

  /** Pending reshelving inbox. */
  listPendingReshelving(): Promise<PendingBunch[]>;

  /** Pickers for the correction form. */
  listVarieties?(): Promise<string[]>;
  listStemLengths?(): Promise<string[]>;
}
