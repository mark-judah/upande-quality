import { api } from '@/src/core/api/client';

export type RawSubmitResponse = {
  message?: { status?: 'success' | 'error' | string; name?: string; message?: string };
};

/** One component's condition on an inspection / glass checklist. */
export type CheckItem = { component: string; condition: string };

export type InspectionPayload = {
  date: string;
  area: string;
  inspected_by?: string;
  remarks?: string;
  checks: CheckItem[];
};

export type GlassPayload = InspectionPayload;

export type CleaningPayload = {
  date: string;
  area: string;
  mode_of_cleaning?: string;
  detergent_used?: string;
  detergent_rate?: number;
  detergent_rate_unit?: string;
  detergent_volume_l?: number;
  disinfectant_used?: string;
  disinfectant_rate?: number;
  disinfectant_rate_unit?: string;
  disinfectant_volume_l?: number;
  disinfection_equipment?: string;
  inspected_by?: string;
  remarks?: string;
};

export const karenPackhouseCleaningApi = {
  submitInspection(data: InspectionPayload): Promise<RawSubmitResponse> {
    return api({
      method: 'POST',
      url: '/api/method/submitPackhouseInspection',
      data: { data },
      validateStatus: () => true,
    });
  },

  submitGlass(data: GlassPayload): Promise<RawSubmitResponse> {
    return api({
      method: 'POST',
      url: '/api/method/submitPackhouseGlass',
      data: { data },
      validateStatus: () => true,
    });
  },

  submitCleaning(data: CleaningPayload): Promise<RawSubmitResponse> {
    return api({
      method: 'POST',
      url: '/api/method/submitPackhouseCleaning',
      data: { data },
      validateStatus: () => true,
    });
  },
};
