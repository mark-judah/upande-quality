import {
  karenQcApi,
  type RawBatchByBucketResponse,
  type RawBucket,
  type RawSubmitResponse,
} from '../api/karen-qc-api';

// ── Domain types ────────────────────────────────────────────────────────────

export type QualityBucket = {
  bucketId: string;
  stems: number;
  itemCode: string;
  itemName: string;
  warehouse: string;
  quarantineWarehouse: string | null;
  basicRate: number;
  costCenter: string;
  farm: string;
  greenhouse: string;
  stockEntry: string;
  status: string;
  selected: boolean;
  quarantineStems: number;
  isInQuarantine: boolean;
};

export type BatchInfo = {
  status: string;
  message: string;
  batchNo: string;
  farm: string;
  company: string;
  totalBuckets: number;
  totalStems: number;
  scannedBucket: string;
  hasActiveQuarantine: boolean;
  buckets: QualityBucket[];
};

export type QualityParameter = {
  name: string;
  parameter: string;
  toleranceThresholds: number;
};

export type Variety = { variety: string; area: number };

export type GreenhouseData = {
  varieties: Variety[];
  employees: { employeeName: string }[];
};

// ── Outcomes ────────────────────────────────────────────────────────────────

export type LoadBatchOutcome =
  | { kind: 'ok'; batch: BatchInfo }
  | { kind: 'error'; message: string };

export type SubmitOutcome =
  | { kind: 'ok'; message: string }
  | { kind: 'error'; message: string };

// ── Mappers ─────────────────────────────────────────────────────────────────

function toBucket(raw: RawBucket): QualityBucket {
  return {
    bucketId: raw.bucket_id ?? '',
    stems: raw.stems ?? 0,
    itemCode: raw.item_code ?? '',
    itemName: raw.item_name ?? '',
    warehouse: raw.warehouse ?? '',
    quarantineWarehouse: raw.quarantine_warehouse ?? null,
    basicRate: raw.basic_rate ?? 0,
    costCenter: raw.cost_center ?? '',
    farm: raw.farm ?? '',
    greenhouse: raw.greenhouse ?? '',
    stockEntry: raw.stock_entry ?? '',
    status: raw.status ?? '',
    selected: raw.selected ?? false,
    quarantineStems: raw.quarantine_stems ?? 0,
    isInQuarantine: raw.is_in_quarantine ?? false,
  };
}

function toBatch(raw: RawBatchByBucketResponse): BatchInfo {
  return {
    status: raw.status ?? '',
    message: raw.message ?? '',
    batchNo: raw.batch_no ?? '',
    farm: raw.farm ?? '',
    company: raw.company ?? '',
    totalBuckets: raw.total_buckets ?? 0,
    totalStems: raw.total_stems ?? 0,
    scannedBucket: raw.scanned_bucket ?? '',
    hasActiveQuarantine: raw.has_active_quarantine ?? false,
    buckets: (raw.buckets ?? []).map(toBucket),
  };
}

function pickMessage(raw: RawSubmitResponse, fallback: string): string {
  return raw.message?.trim() || raw.error?.trim() || fallback;
}

export function extractBucketIdFromQrJson(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return null;
  try {
    const parsed = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== 'object') return null;
    const entry = Object.entries(parsed as Record<string, unknown>).find(
      ([, v]) => v === 'bucket',
    );
    return entry ? entry[0] : null;
  } catch {
    return null;
  }
}

// ── Repository ──────────────────────────────────────────────────────────────

export const karenQcRepository = {
  async fetchParameters(): Promise<QualityParameter[]> {
    const raw = await karenQcApi.fetchParameters();
    const list = raw.message ?? raw.data ?? [];
    return list.map((p) => ({
      name: p.name ?? '',
      parameter: p.parameter ?? '',
      toleranceThresholds: p.tolerance_thresholds ?? 0,
    }));
  },

  async fetchGreenhouseData(greenhouse: string): Promise<GreenhouseData> {
    const raw = await karenQcApi.getGreenhouseData(greenhouse);
    const m = raw.message ?? raw.data ?? {};
    return {
      varieties: (m.varieties ?? []).map((v) => ({
        variety: v.variety,
        area: v.area ?? 0,
      })),
      employees: (m.employees ?? []).map((e) => ({ employeeName: e.employee_name })),
    };
  },

  async loadBatchFromBucket(bucketId: string): Promise<LoadBatchOutcome> {
    const raw = await karenQcApi.getBatchByBucket(bucketId);
    if (raw.status === 'success' || (raw.buckets && raw.buckets.length > 0)) {
      return { kind: 'ok', batch: toBatch(raw) };
    }
    const message =
      raw.message?.trim() ||
      `No batch found for bucket ${bucketId}.`;
    return { kind: 'error', message };
  },

  async submitBatchQuality(payload: Record<string, unknown>): Promise<SubmitOutcome> {
    const raw = await karenQcApi.submitBatchQuality(payload);
    if ((raw.http_status_code ?? 200) < 400 && raw.status !== 'error') {
      return { kind: 'ok', message: pickMessage(raw, 'Quality entry submitted.') };
    }
    return { kind: 'error', message: pickMessage(raw, 'Failed to submit quality entry.') };
  },

  async submitQuarantineActions(
    actions: { bucketId: string; batchNo: string; action: 'accept' | 'reject'; stems: number }[],
  ): Promise<SubmitOutcome> {
    if (actions.length === 0) {
      return { kind: 'error', message: 'No quarantine actions to submit.' };
    }
    let lastMessage = 'Quarantine actions applied.';
    for (const a of actions) {
      const raw = await karenQcApi.releaseFromQuarantine({
        bucketId: a.bucketId,
        action: a.action,
        batchNo: a.batchNo,
        stemsToRelease: a.stems,
      });
      const ok = (raw.http_status_code ?? 200) < 400 && raw.status !== 'error';
      if (!ok) {
        return {
          kind: 'error',
          message: pickMessage(raw, `Failed to release ${a.bucketId}.`),
        };
      }
      lastMessage = pickMessage(raw, lastMessage);
    }
    return { kind: 'ok', message: lastMessage };
  },

  async submitFieldReject(payload: Record<string, unknown>): Promise<SubmitOutcome> {
    const raw = await karenQcApi.submitFieldReject(payload);
    if ((raw.http_status_code ?? 200) < 400 && raw.status !== 'error') {
      return { kind: 'ok', message: pickMessage(raw, 'Field rejection recorded.') };
    }
    return { kind: 'error', message: pickMessage(raw, 'Failed to record field rejection.') };
  },
};
