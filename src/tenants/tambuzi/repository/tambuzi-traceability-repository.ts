import type {
  JourneyStage,
  TraceabilityQuery,
  TraceabilityRepository,
  TraceabilitySnapshot,
} from '@/src/core/features/traceability/types';
import { tambuziTraceabilityApi, type RawTraceabilityRow } from '../api/tambuzi-traceability-api';

function fromRow(row: RawTraceabilityRow, bucketId: string): TraceabilitySnapshot {
  const stems = row.number_of_stems != null ? Number(row.number_of_stems) : null;
  const harvestStage: JourneyStage = {
    stage: 'Harvest',
    doc: String(row.stock_entry ?? ''),
    date: String(row.posting_date ?? ''),
    datetime: String(row.posting_date ?? ''),
    variety: String(row.variety ?? ''),
    stemLength: String(row.custom_stem_length ?? ''),
    qty: isNaN(stems as number) ? null : stems,
    who: '',
    whoKind: '',
    user: '',
    detail: String(row.custom_greenhouse ?? ''),
  };
  return {
    kind: 'bucket',
    roseType: 'Standards',
    bucketId,
    bunchId: '',
    status: 'Harvested',
    variety: String(row.variety ?? '—'),
    farm: String(row.custom_farm ?? '—'),
    greenhouse: String(row.custom_greenhouse ?? '—'),
    stemLength: String(row.custom_stem_length ?? '—'),
    numberOfStems: isNaN(stems as number) ? null : stems,
    date: row.posting_date ?? null,
    batchNo: '',
    sessionSize: 0,
    bunchInfo: null,
    bunches: [],
    stages: [harvestStage],
    warnings: [],
    allocation: null,
  };
}

export const tambuziTraceabilityRepository: TraceabilityRepository = {
  async lookup(query: TraceabilityQuery): Promise<TraceabilitySnapshot> {
    if (query.kind === 'bunch') {
      throw new Error('Bunch traceability is not yet available for this tenant.');
    }
    const res = await tambuziTraceabilityApi.getStatus(query.id);
    const rows: RawTraceabilityRow[] = Array.isArray(res.data)
      ? res.data
      : Array.isArray(res.message)
        ? res.message
        : res.message
          ? [res.message as RawTraceabilityRow]
          : [];
    if (rows.length === 0) throw new Error('No records found for this bucket.');
    return fromRow(rows[rows.length - 1], query.id);
  },
};
