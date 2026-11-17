import { create } from 'zustand';
import { useAuthStore } from '@/src/core/auth/store';
import {
  AreaKey,
  AreaStatus,
  VehicleOption,
  karenVehicleInspectionRepository,
} from '../repository/karen-vehicle-inspection-repository';

type State = {
  vehicles: VehicleOption[];
  loading: boolean;
  error: string | null;

  vehicle: string | null;
  driverName: string;
  areas: Partial<Record<AreaKey, AreaStatus>>;
  defectNotes: string;

  submitting: boolean;

  load: () => Promise<void>;
  setVehicle: (v: string | null) => void;
  setDriverName: (v: string) => void;
  setArea: (key: AreaKey, status: AreaStatus) => void;
  setDefectNotes: (v: string) => void;
  reset: () => void;
  submit: () => Promise<{ ok: true; name: string } | { ok: false; error: string }>;
};

export const useKarenVehicleInspectionStore = create<State>((set, get) => ({
  vehicles: [],
  loading: false,
  error: null,

  vehicle: null,
  driverName: '',
  areas: {},
  defectNotes: '',

  submitting: false,

  async load() {
    set({ loading: true, error: null });
    try {
      const vehicles = await karenVehicleInspectionRepository.loadVehicles();
      set({ vehicles, loading: false });
    } catch (e) {
      set({ loading: false, error: e instanceof Error ? e.message : 'Could not load vehicles.' });
    }
  },

  setVehicle: (vehicle) => set({ vehicle }),
  setDriverName: (driverName) => set({ driverName }),
  // tap the active status again to clear it
  setArea: (key, status) =>
    set((s) => ({ areas: { ...s.areas, [key]: s.areas[key] === status ? undefined : status } })),
  setDefectNotes: (defectNotes) => set({ defectNotes }),

  reset: () => set({ vehicle: null, driverName: '', areas: {}, defectNotes: '' }),

  async submit() {
    const { vehicle, driverName, areas, defectNotes } = get();
    if (!vehicle) return { ok: false as const, error: 'Pick a vehicle first.' };
    set({ submitting: true });
    try {
      const name = await karenVehicleInspectionRepository.submit({
        vehicle,
        driverName,
        inspectedBy: useAuthStore.getState().email,
        areas,
        defectNotes,
      });
      set({ submitting: false });
      get().reset();
      return { ok: true as const, name };
    } catch (e) {
      set({ submitting: false });
      return { ok: false as const, error: e instanceof Error ? e.message : 'Could not save the inspection.' };
    }
  },
}));
