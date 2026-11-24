import { create } from 'zustand';
import {
  karenGreenhouseIntegrityRepository,
  type Greenhouse,
  type InspectionItem,
  type YesNo,
} from '../repository/karen-greenhouse-integrity-repository';

function todayISO(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

type State = {
  farms: string[];
  greenhouses: Greenhouse[];
  items: InspectionItem[];
  loading: boolean;
  error: string | null;

  date: string; // YYYY-MM-DD
  farm: string;
  gh: string;
  checks: Record<string, YesNo>;
  /** Set on a failed Save so the form can highlight the missing fields. */
  showErrors: boolean;

  submitting: boolean;

  load: () => Promise<void>;
  setDate: (v: string) => void;
  setFarm: (v: string) => void;
  setGh: (v: string) => void;
  setCheck: (item: string, v: YesNo) => void;
  reset: () => void;
  /** Required field keys still empty — empty array means the form is valid. */
  missing: () => string[];
  submit: () => Promise<{ ok: true; name: string } | { ok: false; error: string }>;
};

const BLANK = { farm: '', gh: '', checks: {}, showErrors: false };

export const useKarenGreenhouseIntegrityStore = create<State>((set, get) => ({
  farms: [],
  greenhouses: [],
  items: [],
  loading: false,
  error: null,

  date: todayISO(),
  ...BLANK,

  submitting: false,

  async load() {
    set({ loading: true, error: null });
    try {
      const data = await karenGreenhouseIntegrityRepository.fetchFormData();
      set({ farms: data.farms, greenhouses: data.greenhouses, items: data.items, loading: false });
    } catch (e) {
      set({ loading: false, error: e instanceof Error ? e.message : 'Could not load form data.' });
    }
  },

  setDate: (date) => set({ date }),
  // Greenhouses belong to a farm, so switching farm clears the stale pick.
  setFarm: (farm) => set({ farm, gh: '' }),
  setGh: (gh) => set({ gh }),
  setCheck: (item, v) => set((s) => ({ checks: { ...s.checks, [item]: v } })),

  reset: () => set({ date: todayISO(), ...BLANK }),

  // Only Date and Farm are required; the Greenhouse is required once a farm is
  // chosen (that's when its picker is shown). The checks are optional (unanswered = OK),
  // but there must be at least one: the server requires the checklist.
  missing() {
    const s = get();
    const m: string[] = [];
    if (!s.date) m.push('date');
    if (!s.farm) m.push('farm');
    if (s.farm && !s.gh) m.push('gh');
    if (s.items.length === 0) m.push('items');
    return m;
  },

  async submit() {
    const s = get();
    if (s.missing().length > 0) {
      set({ showErrors: true });
      return {
        ok: false as const,
        error: s.items.length === 0
          ? 'No checklist items are set up yet (Greenhouse Inspection Item Master).'
          : 'Fill in every required field.',
      };
    }
    set({ submitting: true });
    try {
      const name = await karenGreenhouseIntegrityRepository.submit({
        date: s.date,
        farm: s.farm,
        gh: s.gh,
        items: s.items,
        checks: s.checks,
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
