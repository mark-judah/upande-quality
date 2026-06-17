import type {
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
  type RawBunchInfo,
  type RawJourneyStage,
  type RawSessionBunch,
  type RawTraceabilitySnapshot,
} from '../api/karen-traceability-api';

const VALID_STATUSES: TraceabilityStatus[] = [
  'Harvested', 'Graded', 'Received', 'On Shelf', 'Pending Issue', 'Issued',
];
const VALID_STAGES: StageName[] = [
  'Harvest', 'Grading', 'Receiving', 'Shelving', 'Allocation', 'Issued',
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

export const karenTraceabilityRepository: TraceabilityRepository = {
  async lookup(query: TraceabilityQuery): Promise<TraceabilitySnapshot> {
    const payload = query.kind === 'bucket' ? { bucket_id: query.id } : { bunch_id: query.id };
    const res = await karenTraceabilityApi.lookup(payload);
    const raw = res.data ?? res.message ?? {};
    return toSnapshot(raw, query);
  },
};
