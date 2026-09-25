import {
  karenFlowerAuditApi,
  type FlowerAuditPayload,
} from '../api/karen-flower-audit-api';

export type VarietyOption = {
  /** Item code — what the Link field stores. */
  value: string;
  label: string;
};

export type GreenhouseOption = {
  value: string;
  label: string;
  /** Which farm it belongs to, so the picker can narrow to the chosen farm. */
  farm: string;
};

export type FormData = {
  farms: string[];
  greenhouses: GreenhouseOption[];
  varieties: VarietyOption[];
};

export type SubmitOutcome =
  | { kind: 'ok'; name: string; message: string }
  | { kind: 'error'; message: string };

export const karenFlowerAuditRepository = {
  async fetchFormData(): Promise<FormData> {
    const res = await karenFlowerAuditApi.fetchFormData();
    const m = res.message ?? {};
    if (m.success === false) throw new Error(m.error || 'Could not load form data.');
    return {
      farms: (m.farms ?? []).filter((f): f is string => !!f),
      greenhouses: (m.greenhouses ?? [])
        .filter((g) => !!g.name)
        .map((g) => ({ value: g.name as string, label: g.name as string, farm: g.farm ?? '' })),
      varieties: (m.varieties ?? [])
        .filter((v) => !!v.name)
        .map((v) => ({ value: v.name as string, label: v.variety || (v.name as string) })),
    };
  },

  async submit(payload: FlowerAuditPayload): Promise<SubmitOutcome> {
    const res = await karenFlowerAuditApi.submit(payload);
    const m = res.message ?? {};
    if (m.status === 'success') {
      return { kind: 'ok', name: m.name ?? '', message: m.message ?? 'Saved.' };
    }
    return { kind: 'error', message: m.message ?? 'Save failed.' };
  },
};
