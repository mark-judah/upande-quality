import { create } from 'zustand';
import { mapAxiosError } from '@/src/core/api/client';
import {
  karenVehicleHygieneRepository,
  type ChemicalOption,
  type SubmitOutcome,
  type VehicleOption,
} from '../repository/karen-vehicle-hygiene-repository';

/** The three surfaces inspected — each maps to a Data field on the doctype. */
export type Surface = 'floors' | 'roof' | 'walls';

export const SURFACES: { key: Surface; label: string }[] = [
  { key: 'floors', label: 'Floors' },
  { key: 'roof', label: 'Roof' },
  { key: 'walls', label: 'Walls' },
];

type State = {
  // ── Pickers ───────────────────────────────────────────────────────────
  vehicles: VehicleOption[];
  conditions: string[];
  detergents: ChemicalOption[];
  disinfectants: ChemicalOption[];
  loading: boolean;
  error: string | null;

  // ── Form ──────────────────────────────────────────────────────────────
  vehicle: string;
  /** Conditions flagged per surface — several may apply to one surface. */
  picked: Record<Surface, string[]>;
  detergent: string;
  disinfectant: string;
  remarks: string;
  submitting: boolean;

  load: () => Promise<void>;
  setVehicle: (vehicle: string) => void;
  toggleCondition: (surface: Surface, condition: string) => void;
  setDetergent: (detergent: string) => void;
  setDisinfectant: (disinfectant: string) => void;
  setRemarks: (remarks: string) => void;
  /** Clears the findings, keeping the loaded pickers. */
  resetForm: () => void;
  submit: () => Promise<SubmitOutcome>;
};

const emptyPicked = (): Record<Surface, string[]> => ({ floors: [], roof: [], walls: [] });

export const useKarenVehicleHygieneStore = create<State>((set, get) => ({
  vehicles: [],
  conditions: [],
  detergents: [],
  disinfectants: [],
  loading: false,
  error: null,

  vehicle: '',
  picked: emptyPicked(),
  detergent: '',
  disinfectant: '',
  remarks: '',
  submitting: false,

  load: async () => {
    set({ loading: true, error: null });
    try {
      const data = await karenVehicleHygieneRepository.fetchFormData();
      set({
        vehicles: data.vehicles,
        conditions: data.conditions,
        detergents: data.detergents,
        disinfectants: data.disinfectants,
        loading: false,
      });
    } catch (err) {
      set({ loading: false, error: mapAxiosError(err).message });
    }
  },

  setVehicle: (vehicle) => set({ vehicle }),

  // Tap to flag, tap again to clear — same idiom as the packhouse checklists.
  toggleCondition: (surface, condition) =>
    set((s) => {
      const current = s.picked[surface];
      const next = current.includes(condition)
        ? current.filter((c) => c !== condition)
        : [...current, condition];
      return { picked: { ...s.picked, [surface]: next } };
    }),

  setDetergent: (detergent) => set({ detergent }),
  setDisinfectant: (disinfectant) => set({ disinfectant }),
  setRemarks: (remarks) => set({ remarks }),

  resetForm: () => set({ picked: emptyPicked(), remarks: '' }),

  submit: async () => {
    const s = get();
    if (!s.vehicle) return { kind: 'error', message: 'Pick a vehicle.' };
    const anyPicked = SURFACES.some((x) => s.picked[x.key].length > 0);
    if (!anyPicked) return { kind: 'error', message: 'Record a condition for at least one surface.' };

    set({ submitting: true });
    try {
      const outcome = await karenVehicleHygieneRepository.submit({
        vehicle: s.vehicle,
        floors: s.picked.floors,
        roof: s.picked.roof,
        walls: s.picked.walls,
        detergent_used: s.detergent || undefined,
        disinfectant_used: s.disinfectant || undefined,
        remarks: s.remarks || undefined,
      });
      set({ submitting: false });
      return outcome;
    } catch (err) {
      set({ submitting: false });
      return { kind: 'error', message: mapAxiosError(err).message };
    }
  },
}));
