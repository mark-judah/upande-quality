import { create } from 'zustand';
import {
  karenSolutionMixingRepository,
  type ChemicalOption,
  type SubmitOutcome,
  type Tank,
} from '../repository/karen-solution-mixing-repository';
import { uploadImage } from '@/src/core/api/upload';
import { mapAxiosError } from '@/src/core/api/client';

let chemicalRowSeed = 1;

export type ChemicalRow = {
  /** Stable local key for React lists. */
  id: number;
  /** Item code (Link to Item). Empty when the operator hasn't picked yet. */
  chemical: string;
  amount: string;
  unit: 'g' | 'ml';
  /** Local file URI captured from the camera (pre-upload). */
  photoUri: string | null;
  /** Frappe File URL once upload finishes. */
  photoUrl: string | null;
  uploading: boolean;
  uploadError: string | null;
};

type State = {
  // ── Pickers ───────────────────────────────────────────────────────────
  farms: string[];
  farmsLoading: boolean;
  farmsError: string | null;
  tanks: Tank[];
  tanksLoading: boolean;
  tanksError: string | null;
  chemicals: ChemicalOption[];
  chemicalsLoading: boolean;
  chemicalsError: string | null;

  // ── Form ──────────────────────────────────────────────────────────────
  /** Defaults to the user's configured farm; the operator can still switch. */
  farm: string;
  tank: string;
  tankCapacityL: number;
  mixingDate: string; // YYYY-MM-DD
  mixingTime: string; // HH:MM
  ph: number;
  ppm: number;
  notes: string;
  rows: ChemicalRow[];

  submitting: boolean;
  lastSubmitMessage: string | null;
  lastSubmitKind: 'ok' | 'error' | null;

  // ── Actions ───────────────────────────────────────────────────────────
  loadFarms: () => Promise<void>;
  loadTanks: (farm: string) => Promise<void>;
  loadChemicals: () => Promise<void>;

  setFarm: (farm: string) => void;
  setTank: (tank: string) => void;
  setMixingDate: (d: string) => void;
  setMixingTime: (t: string) => void;
  setPh: (n: number) => void;
  setPpm: (n: number) => void;
  setNotes: (s: string) => void;

  addRow: () => void;
  removeRow: (id: number) => void;
  updateRow: (id: number, patch: Partial<ChemicalRow>) => void;
  uploadPhotoForRow: (id: number, localUri: string) => Promise<void>;

  submit: () => Promise<SubmitOutcome>;
  reset: () => void;
};

function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}
function nowTime(): string {
  const d = new Date();
  return d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0');
}

const initial = {
  farms: [] as string[],
  farmsLoading: false,
  farmsError: null as string | null,
  tanks: [] as Tank[],
  tanksLoading: false,
  tanksError: null as string | null,
  chemicals: [] as ChemicalOption[],
  chemicalsLoading: false,
  chemicalsError: null as string | null,
  farm: '',
  tank: '',
  tankCapacityL: 0,
  mixingDate: todayDate(),
  mixingTime: nowTime(),
  ph: 4.5,
  ppm: 50,
  notes: '',
  rows: [] as ChemicalRow[],
  submitting: false,
  lastSubmitMessage: null as string | null,
  lastSubmitKind: null as 'ok' | 'error' | null,
};

export const useKarenSolutionMixingStore = create<State>((set, get) => ({
  ...initial,

  loadFarms: async () => {
    set({ farmsLoading: true, farmsError: null });
    try {
      const farms = await karenSolutionMixingRepository.fetchFarms();
      set({ farms, farmsLoading: false });
    } catch (err) {
      set({ farmsLoading: false, farmsError: mapAxiosError(err).message });
    }
  },

  loadTanks: async (farm) => {
    set({ tanksLoading: true, tanksError: null });
    try {
      const tanks = await karenSolutionMixingRepository.fetchTanks(farm);
      set({ tanks, tanksLoading: false });
    } catch (err) {
      set({ tanksLoading: false, tanksError: mapAxiosError(err).message });
    }
  },

  loadChemicals: async () => {
    set({ chemicalsLoading: true, chemicalsError: null });
    try {
      const chemicals = await karenSolutionMixingRepository.fetchChemicals();
      set({ chemicals, chemicalsLoading: false });
    } catch (err) {
      set({ chemicalsLoading: false, chemicalsError: mapAxiosError(err).message });
    }
  },

  setFarm: (farm) => set({ farm, tank: '', tankCapacityL: 0 }),
  setTank: (tank) => {
    const t = get().tanks.find((x) => x.name === tank);
    set({ tank, tankCapacityL: t?.capacityL ?? 0 });
  },
  setMixingDate: (mixingDate) => set({ mixingDate }),
  setMixingTime: (mixingTime) => set({ mixingTime }),
  setPh: (ph) => set({ ph }),
  setPpm: (ppm) => set({ ppm }),
  setNotes: (notes) => set({ notes }),

  addRow: () => {
    const id = chemicalRowSeed++;
    set((s) => ({
      rows: [
        ...s.rows,
        {
          id, chemical: '', amount: '', unit: 'g',
          photoUri: null, photoUrl: null, uploading: false, uploadError: null,
        },
      ],
    }));
  },
  removeRow: (id) => set((s) => ({ rows: s.rows.filter((r) => r.id !== id) })),
  updateRow: (id, patch) =>
    set((s) => ({ rows: s.rows.map((r) => (r.id === id ? { ...r, ...patch } : r)) })),

  uploadPhotoForRow: async (id, localUri) => {
    // Optimistically show the local URI; spinner overlay while uploading.
    set((s) => ({
      rows: s.rows.map((r) =>
        r.id === id ? { ...r, photoUri: localUri, uploading: true, uploadError: null } : r,
      ),
    }));
    try {
      const uploaded = await uploadImage(localUri, 'solution-mix.jpg');
      set((s) => ({
        rows: s.rows.map((r) =>
          r.id === id
            ? { ...r, photoUrl: uploaded.file_url, uploading: false, uploadError: null }
            : r,
        ),
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Upload failed.';
      set((s) => ({
        rows: s.rows.map((r) =>
          r.id === id ? { ...r, uploading: false, uploadError: message } : r,
        ),
      }));
    }
  },

  submit: async () => {
    const s = get();
    if (!s.farm) {
      const out: SubmitOutcome = { kind: 'error', message: 'Pick a farm first.' };
      set({ lastSubmitMessage: out.message, lastSubmitKind: 'error' });
      return out;
    }
    if (!s.tank) {
      const out: SubmitOutcome = { kind: 'error', message: 'Pick a tank.' };
      set({ lastSubmitMessage: out.message, lastSubmitKind: 'error' });
      return out;
    }
    const rows = s.rows.filter((r) => r.chemical && Number(r.amount) > 0);
    if (rows.length === 0) {
      const out: SubmitOutcome = {
        kind: 'error',
        message: 'Add at least one chemical with an amount.',
      };
      set({ lastSubmitMessage: out.message, lastSubmitKind: 'error' });
      return out;
    }
    // Block on any in-flight uploads — better than silently dropping photos.
    if (rows.some((r) => r.uploading)) {
      const out: SubmitOutcome = {
        kind: 'error',
        message: 'A photo is still uploading. Try again in a moment.',
      };
      set({ lastSubmitMessage: out.message, lastSubmitKind: 'error' });
      return out;
    }
    set({ submitting: true });
    try {
      const outcome = await karenSolutionMixingRepository.submit({
        farm: s.farm,
        tank: s.tank,
        mixing_date: s.mixingDate,
        mixing_time: s.mixingTime.length === 5 ? s.mixingTime + ':00' : s.mixingTime,
        ph: s.ph,
        ppm: s.ppm,
        notes: s.notes,
        chemicals: rows.map((r) => ({
          chemical: r.chemical,
          amount: Number(r.amount) || 0,
          unit: r.unit,
          photo: r.photoUrl ?? '',
        })),
      });
      set({
        submitting: false,
        lastSubmitMessage: outcome.kind === 'ok' ? outcome.message : outcome.message,
        lastSubmitKind: outcome.kind === 'ok' ? 'ok' : 'error',
      });
      return outcome;
    } catch (err) {
      const message = mapAxiosError(err).message;
      set({ submitting: false, lastSubmitMessage: message, lastSubmitKind: 'error' });
      return { kind: 'error', message };
    }
  },

  reset: () => set({ ...initial, rows: [] }),
}));
