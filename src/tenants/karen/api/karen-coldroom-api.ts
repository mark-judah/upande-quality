import { api } from '@/src/core/api/client';

export type RawColdStore = { name: string };

export type RawSubmitResponse = {
  message?: { status?: 'success' | 'error' | string; name?: string; message?: string };
};

export type TemperaturePayload = {
  farm: string;
  coldstore: string;
  log_date: string;
  temp_8am?: number;
  temp_10am?: number;
  temp_12pm?: number;
  temp_2pm?: number;
  temp_4pm?: number;
  temp_6pm?: number;
  temp_8pm?: number;
  notes?: string;
};

export type CleaningPayload = {
  farm: string;
  coldstore?: string;
  cleaning_date: string;
  mode_of_cleaning: 'Sweeping' | 'Washing';
  detergent_used?: string;
  detergent_rate?: number;
  detergent_rate_unit?: 'ml/L' | 'g/L';
  detergent_solution_volume_l?: number;
  disinfectant_used?: string;
  disinfectant_rate?: number;
  disinfectant_rate_unit?: 'ml/L' | 'g/L';
  disinfectant_solution_volume_l?: number;
  coldroom_volume_disinfected_m3?: number;
  stock_quantity_stems?: number;
  equipment_used?: string;
  disinfected_by?: string;
  supervised_by?: string;
  notes?: string;
};

export type InspectionPayload = {
  farm: string;
  coldstore?: string;
  inspection_date: string;
  floor_conditions?: string[];
  roof_conditions?: string[];
  walls_conditions?: string[];
  lights_conditions?: string[];
  doors_conditions?: string[];
  shelves_conditions?: string[];
  drainage_conditions?: string[];
  evaporators_conditions?: string[];
  inspected_by?: string;
  notes?: string;
};

export const karenColdroomApi = {
  /** Cold-store warehouses — filtered by name pattern. */
  fetchColdStores(farm?: string): Promise<{ message?: RawColdStore[] }> {
    const filters: unknown[] = [['name', 'like', '%Cold Store%']];
    if (farm) filters.push(['name', 'like', '%' + farm + '%']);
    return api({
      method: 'GET',
      url: '/api/method/frappe.client.get_list',
      params: {
        doctype: 'Warehouse',
        filters: JSON.stringify(filters),
        fields: JSON.stringify(['name']),
        order_by: 'name asc',
        limit_page_length: 100,
      },
      validateStatus: () => true,
    });
  },

  submitTemperature(data: TemperaturePayload): Promise<RawSubmitResponse> {
    return api({
      method: 'POST',
      url: '/api/method/submitColdStoreTemperatureLog',
      data: { data },
      validateStatus: () => true,
    });
  },

  submitCleaning(data: CleaningPayload): Promise<RawSubmitResponse> {
    return api({
      method: 'POST',
      url: '/api/method/submitColdroomCleaning',
      data: { data },
      validateStatus: () => true,
    });
  },

  submitInspection(data: InspectionPayload): Promise<RawSubmitResponse> {
    return api({
      method: 'POST',
      url: '/api/method/submitColdroomInspection',
      data: { data },
      validateStatus: () => true,
    });
  },
};
