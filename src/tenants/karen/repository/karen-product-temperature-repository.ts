import {
  karenProductTemperatureApi,
  type ProductTemperaturePayload,
} from '../api/karen-product-temperature-api';

export type CustomerOption = { value: string; label: string };

export type FormData = {
  controlPoints: string[];
  customers: CustomerOption[];
  boxes: number;
};

export type SubmitOutcome =
  | { kind: 'ok'; name: string; message: string }
  | { kind: 'error'; message: string };

/** Falls back to the doctype's five box columns if the server omits the count. */
const DEFAULT_BOXES = 5;

export const karenProductTemperatureRepository = {
  async fetchFormData(): Promise<FormData> {
    const res = await karenProductTemperatureApi.fetchFormData();
    const m = res.message ?? {};
    if (m.success === false) throw new Error(m.error || 'Could not load form data.');
    return {
      controlPoints: (m.control_points ?? []).filter((c): c is string => !!c),
      customers: (m.customers ?? [])
        .filter((c) => !!c.name)
        .map((c) => ({ value: c.name as string, label: c.customer_name || (c.name as string) })),
      boxes: typeof m.boxes === 'number' && m.boxes > 0 ? m.boxes : DEFAULT_BOXES,
    };
  },

  async submit(payload: ProductTemperaturePayload): Promise<SubmitOutcome> {
    const res = await karenProductTemperatureApi.submit(payload);
    const m = res.message ?? {};
    if (m.status === 'success') {
      return { kind: 'ok', name: m.name ?? '', message: m.message ?? 'Saved.' };
    }
    return { kind: 'error', message: m.message ?? 'Save failed.' };
  },
};
