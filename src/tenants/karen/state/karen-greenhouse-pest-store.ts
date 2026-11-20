import { create } from 'zustand';
import {
  karenGreenhousePestRepository,
  type Greenhouse,
} from '../repository/karen-greenhouse-pest-repository';

function todayISO(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function nowHMS(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

type State = {
  farms: string[];
  greenhouses: Greenhouse[];
  supervisors: string[];
  loading: boolean;
  error: string | null;

  date: string; // YYYY-MM-DD
  time: string; // HH:mm:ss
  supervisor: string;
  farm: string;
  greenhouse: string;
  pest: string;
  count: number;
  showErrors: boolean;

  submitting: boolean;

  load: () => Promise<void>;
  setDate: (v: string) => void;
  setTime: (v: string) => void;
  setSupervisor: (v: string) => void;
  setFarm: (v: string) => void;
  setGreenhouse: (v: string) => void;
  setPest: (v: string) => void;
  setCount: (v: number) => void;
  reset: () => void;
  missing: () => string[];
  submit: () => Promise<{ ok: true; name: string } | { ok: false; error: string }>;
};

const blank = () => ({
  date: todayISO(),
  time: nowHMS(),
  supervisor: '',
  farm: '',
  greenhouse: '',
  pest: '',
  count: 1,
  showErrors: false,
});

export const useKarenGreenhousePestStore = create<State>((set, get) => ({
  farms: [],
  greenhouses: [],
  supervisors: [],
  loading: false,
  error: null,

  ...blank(),

  submitting: false,

  async load() {
    set({ loading: true, error: null });
    try {
      const data = await karenGreenhousePestRepository.fetchFormData();
      set({
        farms: data.farms,
        greenhouses: data.greenhouses,
        supervisors: data.supervisors,
        loading: false,
      });
    } catch (e) {
      set({ loading: false, error: e instanceof Error ? e.message : 'Could not load form data.' });
    }
  },

  setDate: (date) => set({ date }),
  setTime: (time) => set({ time }),
  setSupervisor: (supervisor) => set({ supervisor }),
  // Greenhouses belong to a farm, so switching farm clears the stale pick.
  setFarm: (farm) => set({ farm, greenhouse: '' }),
  setGreenhouse: (greenhouse) => set({ greenhouse }),
  setPest: (pest) => set({ pest }),
  setCount: (count) => set({ count }),

  reset: () => set(blank()),

  missing() {
    const s = get();
    const m: string[] = [];
    if (!s.date) m.push('date');
    if (!s.time) m.push('time');
    if (!s.supervisor) m.push('supervisor');
    if (!s.farm) m.push('farm');
    if (!s.greenhouse) m.push('greenhouse');
    if (!s.pest) m.push('pest');
    if (!Number.isInteger(s.count) || s.count < 1) m.push('count');
    return m;
  },

  async submit() {
    const s = get();
    if (s.missing().length > 0) {
      set({ showErrors: true });
      return { ok: false as const, error: 'Fill in every required field.' };
    }
    set({ submitting: true });
    try {
      const name = await karenGreenhousePestRepository.submit({
        date: s.date,
        time: s.time,
        supervisor: s.supervisor,
        farm: s.farm,
        greenhouse: s.greenhouse,
        pest: s.pest,
        count: s.count,
      });
      set({ submitting: false });
      get().reset();
      return { ok: true as const, name };
    } catch (e) {
      set({ submitting: false });
      return { ok: false as const, error: e instanceof Error ? e.message : 'Could not save the scouting record.' };
    }
  },
}));
