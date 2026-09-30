import { api } from '@/src/core/api/client';
import type { AuditType, SampleField } from '../features/flower-audit/constants';

// ── fetchFlowerAuditFormData ─────────────────────────────────────────────────
export type RawFlowerAuditVariety = { name?: string; variety?: string };
export type RawFlowerAuditGreenhouse = { name?: string; farm?: string };

export type RawFlowerAuditFormData = {
  success?: boolean;
  error?: string;
  farms?: string[];
  greenhouses?: RawFlowerAuditGreenhouse[];
  varieties?: RawFlowerAuditVariety[];
};

// ── submitFlowerQualityAudit ─────────────────────────────────────────────────
export type RawSubmitResponse = {
  message?: { status?: 'success' | 'error' | string; name?: string; message?: string };
};

/** One row of the "Flower Audit Sample Item" child table. Only the fields the
 *  audit type measures are sent; the server leaves the rest empty. */
export type SamplePayload = { sample_number: number } & Partial<Record<SampleField, number>>;

export type FlowerAuditPayload = {
  audit_type: AuditType;
  farm: string;
  /** Only the greenhouse audits (Bud Count, Head Size) send this. */
  greenhouse?: string;
  variety: string;
  remarks?: string;
  samples: SamplePayload[];
};

export const karenFlowerAuditApi = {
  fetchFormData(): Promise<{ message?: RawFlowerAuditFormData }> {
    return api<{ message?: RawFlowerAuditFormData }>({
      method: 'GET',
      url: '/api/method/upande_quality.mobile.api.fetchFlowerAuditFormData',
      validateStatus: () => true,
    });
  },

  submit(data: FlowerAuditPayload): Promise<RawSubmitResponse> {
    return api<RawSubmitResponse>({
      method: 'POST',
      url: '/api/method/upande_quality.mobile.api.submitFlowerQualityAudit',
      data: { data },
      validateStatus: () => true,
    });
  },
};
