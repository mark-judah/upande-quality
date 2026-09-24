import type {
  BoxBucketTrace,
  BoxTraceability,
  BucketAllocationSnapshot,
  BunchInfo,
  JourneyStage,
  RoseType,
  SessionBunch,
  StageName,
  TraceabilityQuery,
  TraceabilityRepository,
  TraceabilitySnapshot,
  TraceabilityStatus,
  WhoKind,
} from '@/src/core/features/traceability/types';
import {
  karenTraceabilityApi,
  type RawAllocation,
  type RawBoxTraceability,
  type RawBunchInfo,
  type RawJourneyStage,
  type RawSessionBunch,
  type RawTraceabilitySnapshot,
} from '../api/karen-traceability-api';

const VALID_STATUSES: TraceabilityStatus[] = [
  'Harvested', 'Graded', 'Received', 'On Shelf', 'Pending Issue', 'Issued',
];
const VALID_STAGES: StageName[] = [
  'Harvest', 'Grading', 'Receiving', 'Quarantine Rejects', 'Shelving', 'Allocation', 'Issued',
];
const VALID_WHO_KIND: WhoKind[] = ['payroll', 'user', ''];

function toStatus(raw: string | undefined): TraceabilityStatus {
  return VALID_STATUSES.includes(raw as TraceabilityStatus)
    ? (raw as TraceabilityStatus)
    : 'Harvested';
}

function toStage(raw: RawJourneyStage): JourneyStage {
  const stage: StageName = VALID_STAGES.includes(raw.stage as StageName)
    ? (raw.stage as StageName)
    : 'Harvest';
  const whoKind: WhoKind = VALID_WHO_KIND.includes(raw.who_kind as WhoKind)
    ? (raw.who_kind as WhoKind)
    : '';
  return {
    stage,
    doc: String(raw.doc ?? ''),
    date: String(raw.date ?? ''),
    datetime: String(raw.datetime ?? ''),
    variety: String(raw.variety ?? ''),
    stemLength: String(raw.stem_length ?? ''),
    qty: raw.qty ?? null,
    who: String(raw.who ?? ''),
    whoKind,
    user: String(raw.user ?? ''),
    detail: String(raw.detail ?? ''),
    harvestTime: String(raw.harvest_time ?? ''),
    cutStage: String(raw.cut_stage ?? ''),
    receivingTime: String(raw.receiving_time ?? ''),
    shelvingTime: String(raw.shelving_time ?? ''),
  };
}

function toBunchInfo(raw: RawBunchInfo | null | undefined): BunchInfo | null {
  if (!raw) return null;
  return {
    bunchId: String(raw.bunch_id ?? ''),
    variety: String(raw.variety ?? ''),
    stemLength: String(raw.stem_length ?? ''),
    bunchSize: String(raw.bunch_size ?? ''),
    farm: String(raw.farm ?? ''),
  };
}

function toAllocation(raw: RawAllocation | null | undefined): BucketAllocationSnapshot | null {
  if (!raw) return null;
  return {
    exists: raw.exists === true,
    variety: String(raw.variety ?? ''),
    stemLength: String(raw.stem_length ?? ''),
    shelfLocation: String(raw.shelf_location ?? ''),
    shelfFarm: String(raw.shelf_farm ?? ''),
    totalQuantity: Number(raw.total_quantity ?? 0),
    allocatedQuantity: Number(raw.allocated_quantity ?? 0),
    availableQuantity: Number(raw.available_quantity ?? 0),
    isAllocated: raw.is_allocated === true,
    fullyAllocated: raw.fully_allocated === true,
    harvestDate: String(raw.harvest_date ?? ''),
  };
}

function toSessionBunch(raw: RawSessionBunch): SessionBunch {
  return {
    bunchId: String(raw.bunch_id ?? ''),
    variety: String(raw.variety ?? ''),
    stemLength: String(raw.stem_length ?? ''),
    bunchSize: String(raw.bunch_size ?? ''),
    gradingSe: String(raw.grading_se ?? ''),
    gradingStemLength: String(raw.grading_stem_length ?? ''),
    gradedBy: String(raw.graded_by ?? ''),
    issuedOpl: String(raw.issued_opl ?? ''),
  };
}

function toSnapshot(raw: RawTraceabilitySnapshot, query: TraceabilityQuery): TraceabilitySnapshot {
  if (raw.error) throw new Error(raw.error);
  const kind: 'bucket' | 'bunch' = raw.kind === 'bunch' ? 'bunch' : 'bucket';
  const roseType: RoseType = raw.rose_type === 'Spray Roses' ? 'Spray Roses' : 'Standards';
  return {
    kind,
    roseType,
    bucketId: String(raw.bucket_id ?? (query.kind === 'bucket' ? query.id : '')),
    bunchId: String(raw.bunch_id ?? (query.kind === 'bunch' ? query.id : '')),
    status: toStatus(raw.status),
    variety: raw.variety || '—',
    farm: raw.farm || '—',
    greenhouse: raw.greenhouse || '—',
    stemLength: raw.stem_length || '—',
    numberOfStems: raw.number_of_stems ?? null,
    date: raw.date || null,
    batchNo: raw.batch_no || '',
    sessionSize: raw.session_size ?? 0,
    bunchInfo: toBunchInfo(raw.bunch_info),
    bunches: (raw.bunches ?? []).map(toSessionBunch),
    stages: (raw.stages ?? []).map(toStage),
    warnings: raw.warnings ?? [],
    allocation: toAllocation(raw.allocation),
  };
}

function toBoxSnapshot(raw: RawBoxTraceability, query: TraceabilityQuery): TraceabilitySnapshot {
  if (raw.error) throw new Error(raw.error);
  const b = raw.box ?? {};
  const buckets: BoxBucketTrace[] = (raw.buckets ?? []).map((r) => ({
    bucket: String(r.bucket ?? ''),
    variety: String(r.variety ?? ''),
    stemLength: String(r.stem_length ?? ''),
    harvest: r.harvest
      ? {
          greenhouse: String(r.harvest.greenhouse ?? ''),
          farm: String(r.harvest.farm ?? ''),
          harvester: String(r.harvest.harvester ?? ''),
          cutStage: String(r.harvest.cut_stage ?? ''),
          date: String(r.harvest.date ?? ''),
          time: String(r.harvest.time ?? ''),
        }
      : null,
    receiving: r.receiving
      ? {
          warehouse: String(r.receiving.warehouse ?? ''),
          date: String(r.receiving.date ?? ''),
          time: String(r.receiving.time ?? ''),
        }
      : null,
    grading: r.grading
      ? {
          gradedBy: String(r.grading.graded_by ?? ''),
          stemLength: String(r.grading.stem_length ?? ''),
          bunchId: String(r.grading.bunch_id ?? ''),
          date: String(r.grading.date ?? ''),
        }
      : null,
    shelving: r.shelving
      ? {
          shelf: String(r.shelving.shelf ?? ''),
          greenhouse: String(r.shelving.greenhouse ?? ''),
          date: String(r.shelving.date ?? ''),
          shelvedBy: String(r.shelving.shelved_by ?? ''),
        }
      : null,
    picked: r.picked
      ? {
          forBox: String(r.picked.for_box ?? ''),
          date: String(r.picked.date ?? ''),
          pickedBy: String(r.picked.picked_by ?? ''),
        }
      : null,
  }));
  const dp = raw.dispatch ?? {};
  const box: BoxTraceability = {
    boxLabel: String(b.box_label ?? (query.kind === 'box' ? query.id : '')),
    boxNumber: String(b.box_number ?? ''),
    boxTotalCount: String(b.box_total_count ?? ''),
    orderPickList: String(b.order_pick_list ?? ''),
    orderName: String(b.order_name ?? ''),
    customer: String(b.customer ?? ''),
    length: String(b.length ?? ''),
    packRate: String(b.pack_rate ?? ''),
    farm: String(b.farm ?? ''),
    packedOn: String(b.packed_on ?? ''),
    packedBy: String(b.packed_by ?? ''),
    exactBuckets: Number(b.exact_buckets ?? 0) === 1,
    buckets,
    dispatch: {
      salesOrder: String(dp.sales_order ?? ''),
      orderName: String(dp.order_name ?? ''),
      customer: String(dp.customer ?? ''),
      consignee: String(dp.consignee ?? ''),
      deliveryPoint: String(dp.delivery_point ?? ''),
      freightAgent: String(dp.freight_agent ?? ''),
      truck: String(dp.truck ?? ''),
      deliveryNote: String(dp.delivery_note ?? ''),
      delivered: Number(dp.delivered ?? 0) === 1,
      date: String(dp.date ?? ''),
    },
  };
  return {
    kind: 'box',
    roseType: 'Standards',
    bucketId: '',
    bunchId: '',
    status: 'Harvested',
    variety: box.buckets[0]?.variety || '—',
    farm: box.farm || '—',
    greenhouse: '—',
    stemLength: box.length || '—',
    numberOfStems: null,
    date: null,
    batchNo: '',
    sessionSize: 0,
    bunchInfo: null,
    bunches: [],
    stages: [],
    warnings: [],
    allocation: null,
    box,
  };
}

export const karenTraceabilityRepository: TraceabilityRepository = {
  async lookup(query: TraceabilityQuery): Promise<TraceabilitySnapshot> {
    if (query.kind === 'box') {
      const res = await karenTraceabilityApi.lookupBox(query.id);
      const raw = res.message ?? res.data ?? {};
      return toBoxSnapshot(raw, query);
    }
    const payload = query.kind === 'bucket' ? { bucket_id: query.id } : { bunch_id: query.id };
    const res = await karenTraceabilityApi.lookup(payload);
    const raw = res.data ?? res.message ?? {};
    return toSnapshot(raw, query);
  },
};
