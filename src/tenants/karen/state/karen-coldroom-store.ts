import { mapAxiosError } from '@/src/core/api/client';
import { create } from 'zustand';
import {
  karenColdroomApi,
  type CleaningPayload,
  type InspectionPayload,
  type TemperaturePayload,
} from '../api/karen-coldroom-api';

export type SubmitOutcome =
  | { kind: 'ok'; name: string; message: string }
  | { kind: 'error'; message: string };

type State = {
  // Pickers shared across all three forms
  farms: string[];
  farmsLoading: boolean;
  coldStores: string[];
  coldStoresLoading: boolean;

  // Submit state
  submitting: boolean;

  // Loaders
  loadFarms: () => Promise<void>;
  loadColdStores: (farm?: string) => Promise<void>;

  // Submitters — async one-shots; UI owns its own field state.
  submitTemperature: (payload: TemperaturePayload) => Promise<SubmitOutcome>;
  submitCleaning: (payload: CleaningPayload) => Promise<SubmitOutcome>;
  submitInspection: (payload: InspectionPayload) => Promise<SubmitOutcome>;
};

async function fetchAllKarenFarms(): Promise<string[]> {
  // Re-use the same farms-of-Karen-Roses query the Solution Mixing screen
  // uses. Inlined here to avoid a cross-feature dependency.
  const res = await import('@/src/core/api/client').then((m) =>
    m.api<{ message?: { name: string }[] }>({
      method: 'GET',
      url: '/api/method/frappe.client.get_list',
      params: {
        doctype: 'Farm',
        filters: JSON.stringify([['company', '=', 'Karen Roses']]),
        fields: JSON.stringify(['name']),
        // order_by: 'farm asc',
        order_by: 'name asc',
        limit_page_length: 100,
      },
      validateStatus: () => true,
    }),
  );
  return (res.message ?? []).map((r) => r.name).filter(Boolean);
}

function toResult(res: { message?: { status?: string; name?: string; message?: string } }): SubmitOutcome {
  const m = res.message ?? {};
  if (m.status === 'success') return { kind: 'ok', name: m.name ?? '', message: m.message ?? 'Saved.' };
  return { kind: 'error', message: m.message ?? 'Save failed.' };
}

export const useKarenColdroomStore = create<State>((set) => ({
  farms: [],
  farmsLoading: false,
  coldStores: [],
  coldStoresLoading: false,
  submitting: false,

  loadFarms: async () => {
    set({ farmsLoading: true });
    try {
      const farms = await fetchAllKarenFarms();
      set({ farms, farmsLoading: false });
    } catch {
      set({ farmsLoading: false });
    }
  },

  loadColdStores: async (farm) => {
    set({ coldStoresLoading: true });
    try {
      const res = await karenColdroomApi.fetchColdStores(farm);
      set({
        coldStores: (res.message ?? []).map((c) => c.name).filter(Boolean),
        coldStoresLoading: false,
      });
    } catch {
      set({ coldStoresLoading: false });
    }
  },

  submitTemperature: async (payload) => {
    set({ submitting: true });
    try {
      const res = await karenColdroomApi.submitTemperature(payload);
      set({ submitting: false });
      return toResult(res);
    } catch (err) {
      set({ submitting: false });
      return { kind: 'error', message: mapAxiosError(err).message };
    }
  },

  submitCleaning: async (payload) => {
    set({ submitting: true });
    try {
      const res = await karenColdroomApi.submitCleaning(payload);
      set({ submitting: false });
      return toResult(res);
    } catch (err) {
      set({ submitting: false });
      return { kind: 'error', message: mapAxiosError(err).message };
    }
  },

  submitInspection: async (payload) => {
    set({ submitting: true });
    try {
      const res = await karenColdroomApi.submitInspection(payload);
      set({ submitting: false });
      return toResult(res);
    } catch (err) {
      set({ submitting: false });
      return { kind: 'error', message: mapAxiosError(err).message };
    }
  },
}));
