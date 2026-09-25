import { api } from '@/src/core/api/client';

// ── fetchVehicleHygieneFormData ──────────────────────────────────────────────
export type RawVehicle = { name?: string; license_plate?: string; description?: string };
export type RawChemical = { name?: string; item_name?: string };

export type RawVehicleHygieneFormData = {
  success?: boolean;
  error?: string;
  vehicles?: RawVehicle[];
  /** Condition names from the QC-maintained "Packhouse Condition" doctype. */
  conditions?: string[];
  detergents?: RawChemical[];
  disinfectants?: RawChemical[];
};

// ── submitVehicleHygieneChecklist ────────────────────────────────────────────
export type RawSubmitResponse = {
  message?: { status?: 'success' | 'error' | string; name?: string; message?: string };
};

export type VehicleHygienePayload = {
  vehicle: string;
  /** Conditions per surface — the server joins each list into its Data field. */
  floors: string[];
  roof: string[];
  walls: string[];
  detergent_used?: string;
  disinfectant_used?: string;
  remarks?: string;
};

export const karenVehicleHygieneApi = {
  fetchFormData(): Promise<{ message?: RawVehicleHygieneFormData }> {
    return api<{ message?: RawVehicleHygieneFormData }>({
      method: 'GET',
      url: '/api/method/upande_quality.mobile.api.fetchVehicleHygieneFormData',
      validateStatus: () => true,
    });
  },

  submit(data: VehicleHygienePayload): Promise<RawSubmitResponse> {
    return api<RawSubmitResponse>({
      method: 'POST',
      url: '/api/method/upande_quality.mobile.api.submitVehicleHygieneChecklist',
      data: { data },
      validateStatus: () => true,
    });
  },
};
