import { create } from 'zustand';
import { mapAxiosError } from '@/src/core/api/client';
import {
  karenBucketCleaningRepository,
  type ChemicalOption,
  type SubmitOutcome,
} from '../repository/karen-bucket-cleaning-repository';

type State = {
  // ── Pickers ───────────────────────────────────────────────────────────
  detergents: ChemicalOption[];
  disinfectants: ChemicalOption[];
  loading: boolean;
  error: string | null;

  // ── Form ──────────────────────────────────────────────────────────────
  // Numbers are held as typed text so a half-entered "1." survives a keystroke.
  buckets: string;
  detergent: string;
  detergentQty: string;
  detergentVolume: string;
  disinfectant: string;
  disinfectantQty: string;
  disinfectantVolume: string;
  remarks: string;
  submitting: boolean;

  load: () => Promise<void>;
  setField: (field: TextField, value: string) => void;
  resetForm: () => void;
  submit: () => Promise<SubmitOutcome>;
};

type TextField =
  | 'buckets'
  | 'detergent'
  | 'detergentQty'
  | 'detergentVolume'
  | 'disinfectant'
  | 'disinfectantQty'
  | 'disinfectantVolume'
  | 'remarks';

const emptyForm = {
  buckets: '',
  detergent: '',
  detergentQty: '',
  detergentVolume: '',
  disinfectant: '',
  disinfectantQty: '',
  disinfectantVolume: '',
  remarks: '',
};

/** Blank stays blank — the doctype's Floats default to 0 server-side. */
function num(v: string): number | undefined {
  const n = Number.parseFloat(v);
  return Number.isFinite(n) ? n : undefined;
}

export const useKarenBucketCleaningStore = create<State>((set, get) => ({
  detergents: [],
  disinfectants: [],
  loading: false,
  error: null,

  ...emptyForm,
  submitting: false,

  load: async () => {
    set({ loading: true, error: null });
    try {
      const data = await karenBucketCleaningRepository.fetchFormData();
      set({ detergents: data.detergents, disinfectants: data.disinfectants, loading: false });
    } catch (err) {
      set({ loading: false, error: mapAxiosError(err).message });
    }
  },

  setField: (field, value) => set({ [field]: value } as Pick<State, TextField>),

  resetForm: () => set({ ...emptyForm }),

  submit: async () => {
    const s = get();
    const buckets = num(s.buckets);
    if (!buckets || buckets <= 0) {
      return { kind: 'error', message: 'Enter how many buckets were cleaned.' };
    }

    set({ submitting: true });
    try {
      const outcome = await karenBucketCleaningRepository.submit({
        buckets_cleaned: Math.round(buckets),
        detergent_used: s.detergent || undefined,
        qty_of_detergent: num(s.detergentQty),
        volume_of_solution_detergent: num(s.detergentVolume),
        disinfectant_used: s.disinfectant || undefined,
        qty_of_disinfectant: num(s.disinfectantQty),
        volume_of_solution_disinfectant: num(s.disinfectantVolume),
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
