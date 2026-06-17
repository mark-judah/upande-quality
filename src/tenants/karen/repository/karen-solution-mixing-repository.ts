import {
  karenSolutionMixingApi,
  type SubmitMixPayload,
} from '../api/karen-solution-mixing-api';

export type Tank = {
  name: string;
  farm: string;
  tankName: string;
  capacityL: number;
  location: string;
};

export type ChemicalOption = {
  /** Item code (used for the Link field). */
  value: string;
  /** Human-friendly label shown in the picker. */
  label: string;
  uom: string;
};

export type SubmitOutcome =
  | { kind: 'ok'; name: string; message: string }
  | { kind: 'error'; message: string };

export const karenSolutionMixingRepository = {
  async fetchFarms(): Promise<string[]> {
    const res = await karenSolutionMixingApi.fetchFarms();
    return (res.message ?? [])
      .map((r) => r.name || r.farm)
      .filter((n): n is string => !!n);
  },

  async fetchTanks(farm: string): Promise<Tank[]> {
    const res = await karenSolutionMixingApi.fetchTanks(farm);
    const m = res.message ?? {};
    if (m.status !== 'success') return [];
    return (m.data ?? []).map((t) => ({
      name: t.name ?? '',
      farm: t.farm ?? '',
      tankName: t.tank_name ?? '',
      capacityL: typeof t.capacity_l === 'number' ? t.capacity_l : 0,
      location: t.location ?? '',
    }));
  },

  async fetchChemicals(): Promise<ChemicalOption[]> {
    const res = await karenSolutionMixingApi.fetchChemicals();
    const rows = res.message ?? [];
    return rows
      .filter((r) => !!r.name)
      .map((r) => ({
        value: r.name as string,
        label: r.item_name || (r.name as string),
        uom: r.stock_uom ?? '',
      }));
  },

  async submit(payload: SubmitMixPayload): Promise<SubmitOutcome> {
    const res = await karenSolutionMixingApi.submit(payload);
    const m = res.message ?? {};
    if (m.status === 'success') {
      return {
        kind: 'ok',
        name: m.name ?? '',
        message: m.message ?? 'Saved.',
      };
    }
    return { kind: 'error', message: m.message ?? 'Save failed.' };
  },
};
