import { api } from '@/src/core/api/client';

export type RawTank = {
  name?: string;
  farm?: string;
  tank_name?: string;
  capacity_l?: number;
  location?: string;
};

export type RawTankResponse = {
  message?: { status?: string; data?: RawTank[]; message?: string };
};

export type RawChemicalItem = {
  name?: string;
  item_name?: string;
  stock_uom?: string;
};

export type RawSubmitMixResponse = {
  message?: {
    status?: 'success' | 'error' | string;
    name?: string;
    message?: string;
  };
};

export type SubmitMixPayload = {
  farm: string;
  tank: string;
  mixing_date: string;
  mixing_time: string;
  ph: number;
  ppm: number;
  notes?: string;
  chemicals: {
    chemical: string;
    amount: number;
    unit: 'g' | 'ml';
    photo?: string;
    notes?: string;
  }[];
};

export const karenSolutionMixingApi = {
  /** Every Karen Roses farm — not filtered to the operator's configured farm.
   *  Some operators (notably Post Harvest staff) mix for multiple farms. */
  fetchFarms(): Promise<{ message?: { name: string; farm: string }[] }> {
    return api<{ message?: { name: string; farm: string }[] }>({
      method: 'GET',
      url: '/api/method/frappe.client.get_list',
      params: {
        doctype: 'Farm',
        filters: JSON.stringify([['company', '=', 'Karen Roses']]),
        fields: JSON.stringify(['name', 'farm']),
        order_by: 'farm asc',
        limit_page_length: 100,
      },
      validateStatus: () => true,
    });
  },

  fetchTanks(farm: string): Promise<RawTankResponse> {
    return api<RawTankResponse>({
      method: 'GET',
      url: '/api/method/fetchMixingTanks',
      params: { farm },
      validateStatus: () => true,
    });
  },

  /** Pulls the curated post-harvest chemical list from the
   *  "Cold Post Harvest Chemicals" doctype (managed by QC), not the full Item
   *  master. Returns {name, item_name, stock_uom} so the picker contract is
   *  unchanged. The stored mix chemical is now free text (the chemical name). */
  fetchChemicals(): Promise<{ message?: RawChemicalItem[] }> {
    return api<{ message?: RawChemicalItem[] }>({
      method: 'GET',
      url: '/api/method/fetchColdPostHarvestChemicals',
      validateStatus: () => true,
    });
  },

  submit(data: SubmitMixPayload): Promise<RawSubmitMixResponse> {
    return api<RawSubmitMixResponse>({
      method: 'POST',
      url: '/api/method/submitSolutionMix',
      data: { data },
      validateStatus: () => true,
    });
  },
};
