import {
  karenVehicleHygieneApi,
  type VehicleHygienePayload,
} from '../api/karen-vehicle-hygiene-api';

export type VehicleOption = {
  /** Vehicle docname — what the Link field stores. */
  value: string;
  label: string;
  /** Make + model, shown under the plate in the picker. */
  sublabel?: string;
};

export type ChemicalOption = { value: string; label: string };

export type FormData = {
  vehicles: VehicleOption[];
  conditions: string[];
  detergents: ChemicalOption[];
  disinfectants: ChemicalOption[];
};

export type SubmitOutcome =
  | { kind: 'ok'; name: string; message: string }
  | { kind: 'error'; message: string };

const toChemicals = (rows: { name?: string; item_name?: string }[] = []): ChemicalOption[] =>
  rows
    .filter((r) => !!r.name)
    .map((r) => ({ value: r.name as string, label: r.item_name || (r.name as string) }));

export const karenVehicleHygieneRepository = {
  async fetchFormData(): Promise<FormData> {
    const res = await karenVehicleHygieneApi.fetchFormData();
    const m = res.message ?? {};
    if (m.success === false) throw new Error(m.error || 'Could not load form data.');
    return {
      vehicles: (m.vehicles ?? [])
        .filter((v) => !!v.name)
        .map((v) => ({
          value: v.name as string,
          label: v.license_plate || (v.name as string),
          sublabel: v.description || undefined,
        })),
      conditions: (m.conditions ?? []).filter((c): c is string => !!c),
      detergents: toChemicals(m.detergents),
      disinfectants: toChemicals(m.disinfectants),
    };
  },

  async submit(payload: VehicleHygienePayload): Promise<SubmitOutcome> {
    const res = await karenVehicleHygieneApi.submit(payload);
    const m = res.message ?? {};
    if (m.status === 'success') {
      return { kind: 'ok', name: m.name ?? '', message: m.message ?? 'Saved.' };
    }
    return { kind: 'error', message: m.message ?? 'Save failed.' };
  },
};
