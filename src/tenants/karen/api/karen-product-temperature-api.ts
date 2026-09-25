import { api } from '@/src/core/api/client';

// ── fetchProductTemperatureFormData ──────────────────────────────────────────
export type RawCustomer = { name?: string; customer_name?: string };

export type RawProductTemperatureFormData = {
  success?: boolean;
  error?: string;
  /** Loading / Precooling / Staging, filtered to those that exist as records. */
  control_points?: string[];
  customers?: RawCustomer[];
  boxes?: number;
};

// ── submitProductTemperatureLog ──────────────────────────────────────────────
export type RawSubmitResponse = {
  message?: { status?: 'success' | 'error' | string; name?: string; message?: string };
};

/** One box on a control point — a temperature and the photo backing it. */
export type BoxPayload = { temp: number; photo: string };

export type ReadingPayload = {
  control_point: string;
  /** Position in this list is the box number (1-5). */
  boxes: (BoxPayload | null)[];
};

export type ProductTemperaturePayload = {
  date: string;
  customer?: string;
  readings: ReadingPayload[];
};

export const karenProductTemperatureApi = {
  fetchFormData(): Promise<{ message?: RawProductTemperatureFormData }> {
    return api<{ message?: RawProductTemperatureFormData }>({
      method: 'GET',
      url: '/api/method/upande_quality.mobile.api.fetchProductTemperatureFormData',
      validateStatus: () => true,
    });
  },

  submit(data: ProductTemperaturePayload): Promise<RawSubmitResponse> {
    return api<RawSubmitResponse>({
      method: 'POST',
      url: '/api/method/upande_quality.mobile.api.submitProductTemperatureLog',
      data: { data },
      validateStatus: () => true,
      // Several photos already uploaded; the insert itself can still be slow.
      timeout: 120000,
    });
  },
};
