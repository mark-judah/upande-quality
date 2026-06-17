import type {
  BucketOplAllocation,
  BucketReplaceOutcome,
  BunchMoveOutcome,
  BunchMovePayload,
  DetailsCorrectionOutcome,
  DetailsCorrectionPayload,
  PendingBunch,
  ReplacementCandidate,
  ReplacementCandidatesResult,
  ReplacementRepository,
  StemReplaceOutcome,
} from '@/src/core/features/replacement/types';
import {
  karenReplacementApi,
  type RawBucketOpl,
  type RawCandidate,
  type RawCandidatesResponse,
  type RawPendingBunch,
} from '../api/karen-replacement-api';

function toCandidate(raw: RawCandidate): ReplacementCandidate {
  const stemQty = raw.stem_qty ?? null;
  const allocated = Number(raw.allocated_qty ?? 0);
  // Fall back to stemQty when the server didn't compute available (no BAS row).
  const available =
    raw.available_qty != null ? Number(raw.available_qty) : Math.max(0, (stemQty ?? 0) - allocated);
  return {
    bucketId: String(raw.bucket_id ?? ''),
    shelf: String(raw.shelf ?? ''),
    greenhouse: String(raw.greenhouse ?? ''),
    warehouse: String(raw.warehouse ?? ''),
    variety: String(raw.variety ?? ''),
    stemLength: String(raw.stem_length ?? ''),
    dateAdded: String(raw.date_added ?? ''),
    ageDays: raw.age_days ?? null,
    stemQty,
    allocatedQty: allocated,
    availableQty: available,
  };
}

function toCandidatesResult(
  res: RawCandidatesResponse,
  fallbackCriteria?: { variety: string; stemLength: string; farm: string },
): ReplacementCandidatesResult {
  const body = res.data ?? {};
  if (body.error) throw new Error(body.error);
  const criteria = body.criteria ?? {};
  const list = body.candidates ?? body.destinations ?? [];
  return {
    criteria: {
      variety: String(criteria.variety ?? fallbackCriteria?.variety ?? ''),
      stemLength: String(criteria.stem_length ?? fallbackCriteria?.stemLength ?? ''),
      farm: String(criteria.farm ?? fallbackCriteria?.farm ?? ''),
    },
    candidates: list.map(toCandidate),
  };
}

function toBucketOpl(raw: RawBucketOpl): BucketOplAllocation {
  return {
    pickListItem: String(raw.pick_list_item ?? ''),
    oplName: String(raw.opl_name ?? ''),
    orderName: String(raw.order_name ?? ''),
    customer: String(raw.customer ?? ''),
    team: String(raw.team ?? ''),
    dateCreated: String(raw.date_created ?? ''),
    totalStems: Number(raw.total_stems ?? 0),
    oplStatus: String(raw.opl_status ?? ''),
    salesOrder: String(raw.sales_order ?? ''),
    saleOrderItem: String(raw.sale_order_item ?? ''),
    itemCode: String(raw.item_code ?? ''),
    stemLength: String(raw.stem_length ?? ''),
    stemsFromThisBucket: Number(raw.stems_from_this_bucket ?? 0),
    bunchesFromThisBucket: Number(raw.bunches_from_this_bucket ?? 0),
    issued: raw.issued === true,
  };
}

function toPending(raw: RawPendingBunch): PendingBunch {
  return {
    gradingSe: String(raw.grading_se ?? ''),
    bunchId: String(raw.bunch_id ?? ''),
    sourceBucket: String(raw.source_bucket ?? ''),
    pendingSince: String(raw.pending_since ?? ''),
    variety: String(raw.variety ?? ''),
    stemLength: String(raw.stem_length ?? ''),
    bunchSize: String(raw.bunch_size ?? ''),
    farm: String(raw.farm ?? ''),
    flaggedBy: String(raw.flagged_by ?? ''),
  };
}

export const karenReplacementRepository: ReplacementRepository = {
  async listBucketCandidates(bucketId: string): Promise<ReplacementCandidatesResult> {
    const res = await karenReplacementApi.listReplacementCandidates({ bucket_id: bucketId });
    return toCandidatesResult(res);
  },

  async replaceBucket(
    bucketId: string,
    newBucketId: string,
    pickListItem: string,
  ): Promise<BucketReplaceOutcome> {
    const res = await karenReplacementApi.replaceBucket({
      bucket_id: bucketId,
      new_bucket_id: newBucketId,
      pick_list_item: pickListItem,
    });
    const body = res.data ?? {};
    if (body.error) return { ok: false, error: body.error };
    if (body.status === 'success') {
      return {
        ok: true,
        message: body.message ?? 'Replacement complete.',
        oldBucket: body.old_bucket ?? bucketId,
        newBucket: body.new_bucket ?? newBucketId,
        opl: body.opl ?? '',
      };
    }
    const fallback = res.message ?? {};
    if (fallback.error) return { ok: false, error: fallback.error };
    return { ok: false, error: 'Unknown response from server.' };
  },

  async listBucketOpls(bucketId: string): Promise<BucketOplAllocation[]> {
    const res = await karenReplacementApi.listBucketOpls({ bucket_id: bucketId });
    const body = res.data ?? {};
    if (body.error) throw new Error(body.error);
    return (body.opls ?? []).map(toBucketOpl);
  },

  async replaceStems(payload): Promise<StemReplaceOutcome> {
    const res = await karenReplacementApi.replaceStems({
      pick_list_item: payload.pickListItem,
      donor_bucket_id: payload.donorBucketId,
      stems: payload.stems,
      reason: payload.reason,
    });
    const body = res.data ?? {};
    if (body.error) return { ok: false, error: body.error };
    if (body.status === 'success') {
      return {
        ok: true,
        message: body.message ?? '',
        donorBucket: body.donor_bucket ?? payload.donorBucketId,
        donorShelf: body.donor_shelf ?? '',
        stems: body.stems ?? payload.stems,
        donorRemainingStems: body.donor_remaining_stems ?? 0,
        destinationBucket: body.destination_bucket ?? '',
        opl: body.opl ?? '',
      };
    }
    return { ok: false, error: 'Unknown response from server.' };
  },

  async replaceBunchInOpl(payload): Promise<StemReplaceOutcome> {
    const res = await karenReplacementApi.replaceBunchInOpl({
      pick_list_item: payload.pickListItem,
      donor_bucket_id: payload.donorBucketId,
      stems: payload.stems,
      reason: payload.reason,
    });
    const body = res.data ?? {};
    if (body.error) return { ok: false, error: body.error };
    if (body.status === 'replaced') {
      return {
        ok: true,
        message: body.message ?? '',
        donorBucket: body.donor_bucket ?? payload.donorBucketId,
        donorShelf: body.donor_shelf ?? '',
        stems: body.stems ?? payload.stems ?? 10,
        donorRemainingStems: 0,
        destinationBucket: body.destination_bucket ?? '',
        opl: body.opl ?? '',
      };
    }
    return { ok: false, error: 'Unknown response from server.' };
  },

  async correctDetails(payload: DetailsCorrectionPayload): Promise<DetailsCorrectionOutcome> {
    const res = await karenReplacementApi.correctDetails({
      kind: payload.kind,
      id: payload.id,
      bucket_id: payload.bucketId,
      variety: payload.variety,
      stem_length: payload.stemLength,
    });
    const body = res.data ?? {};
    if (body.error) return { ok: false, error: body.error };
    if (body.status === 'success') {
      const kind: 'bunch' | 'bucket' = body.kind === 'bucket' ? 'bucket' : 'bunch';
      return {
        ok: true,
        message: body.message ?? 'Corrections applied.',
        kind,
        id: body.id ?? payload.id,
        updates: body.updates ?? [],
      };
    }
    return { ok: false, error: 'Unknown response from server.' };
  },

  async listBunchDestinations(
    variety: string,
    stemLength: string,
    farm: string,
    excludeBucket?: string,
  ): Promise<ReplacementCandidatesResult> {
    const res = await karenReplacementApi.listBunchDestinations({
      variety,
      stem_length: stemLength,
      farm,
      exclude_bucket: excludeBucket,
    });
    return toCandidatesResult(res, { variety, stemLength, farm });
  },

  async moveBunch(payload: BunchMovePayload): Promise<BunchMoveOutcome> {
    const res = await karenReplacementApi.moveBunch({
      bunch_id: payload.bunchId,
      source_bucket_id: payload.sourceBucketId,
      variety: payload.variety,
      stem_length: payload.stemLength,
      dest_bucket_id: payload.destBucketId,
    });
    const body = res.data ?? {};
    if (body.error) return { ok: false, error: body.error };

    const status = body.status;
    if (status === 'moved' || status === 'pending') {
      return {
        ok: true,
        status,
        message: body.message ?? '',
        bunchId: body.bunch_id ?? payload.bunchId,
        sourceBucket: body.source_bucket ?? payload.sourceBucketId,
        destBucket: body.dest_bucket,
        destShelf: body.dest_shelf,
        stemsMoved: body.stems_moved,
        correctedVariety: body.corrected_variety,
        correctedStemLength: body.corrected_stem_length,
      };
    }
    const fallback = res.message ?? {};
    if (fallback.error) return { ok: false, error: fallback.error };
    return { ok: false, error: 'Unknown response from server.' };
  },

  async listPendingReshelving(): Promise<PendingBunch[]> {
    const res = await karenReplacementApi.listPendingReshelving();
    const body = res.data ?? {};
    if (body.error) throw new Error(body.error);
    return (body.pending ?? []).map(toPending);
  },

  listVarieties() {
    return karenReplacementApi.listVarieties();
  },

  listStemLengths() {
    return karenReplacementApi.listStemLengths();
  },
};
