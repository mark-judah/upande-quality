import { create } from 'zustand';
import { mapAxiosError } from '@/src/core/api/client';
import {
  karenFlowerAuditRepository,
  type GreenhouseOption,
  type SubmitOutcome,
  type VarietyOption,
} from '../repository/karen-flower-audit-repository';
import type { SamplePayload } from '../api/karen-flower-audit-api';
import {
  INITIAL_SAMPLE_ROWS,
  type AuditDef,
  type SampleField,
} from '../features/flower-audit/constants';

let rowSeed = 1;

export type SampleRow = {
  /** Stable local key for React lists. */
  id: number;
  /** Raw text per measured column — kept as typed so a half-entered "1." holds. */
  values: Partial<Record<SampleField, string>>;
};

function blankRows(count: number): SampleRow[] {
  return Array.from({ length: count }, () => ({ id: rowSeed++, values: {} }));
}

type State = {
  // ── Pickers (loaded once, shared by all four audits) ──────────────────
  farms: string[];
  greenhouses: GreenhouseOption[];
  varieties: VarietyOption[];
  loading: boolean;
  error: string | null;

  // ── Form ──────────────────────────────────────────────────────────────
  farm: string;
  greenhouse: string;
  variety: string;
  remarks: string;
  rows: SampleRow[];
  submitting: boolean;

  load: () => Promise<void>;
  setFarm: (farm: string) => void;
  setGreenhouse: (greenhouse: string) => void;
  setVariety: (variety: string) => void;
  setRemarks: (remarks: string) => void;
  setCell: (id: number, field: SampleField, text: string) => void;
  addRow: () => void;
  removeRow: (id: number) => void;
  /** Clears the form back to empty sample rows, keeping the loaded pickers. */
  resetForm: () => void;
  submit: (audit: AuditDef) => Promise<SubmitOutcome>;
};

export const useKarenFlowerAuditStore = create<State>((set, get) => ({
  farms: [],
  greenhouses: [],
  varieties: [],
  loading: false,
  error: null,

  farm: '',
  greenhouse: '',
  variety: '',
  remarks: '',
  rows: blankRows(INITIAL_SAMPLE_ROWS),
  submitting: false,

  load: async () => {
    set({ loading: true, error: null });
    try {
      const data = await karenFlowerAuditRepository.fetchFormData();
      set({
        farms: data.farms,
        greenhouses: data.greenhouses,
        varieties: data.varieties,
        loading: false,
      });
    } catch (err) {
      set({ loading: false, error: mapAxiosError(err).message });
    }
  },

  // Greenhouses belong to a farm, so switching farm clears the stale pick.
  setFarm: (farm) => set({ farm, greenhouse: '' }),
  setGreenhouse: (greenhouse) => set({ greenhouse }),
  setVariety: (variety) => set({ variety }),
  setRemarks: (remarks) => set({ remarks }),

  setCell: (id, field, text) =>
    set((s) => ({
      rows: s.rows.map((r) =>
        r.id === id ? { ...r, values: { ...r.values, [field]: text } } : r,
      ),
    })),

  addRow: () => set((s) => ({ rows: [...s.rows, { id: rowSeed++, values: {} }] })),
  removeRow: (id) => set((s) => ({ rows: s.rows.filter((r) => r.id !== id) })),

  resetForm: () => set({ remarks: '', rows: blankRows(INITIAL_SAMPLE_ROWS) }),

  submit: async (audit) => {
    const s = get();
    const fail = (message: string): SubmitOutcome => {
      return { kind: 'error', message };
    };
    if (!s.farm) return fail('Pick a farm.');
    if (audit.needsGreenhouse && !s.greenhouse) return fail('Pick a greenhouse.');
    if (!s.variety) return fail('Pick a variety.');

    // A row counts only once every column of this audit carries a number —
    // a half-filled Head Size row would otherwise save a 0 height.
    const filled: SamplePayload[] = [];
    for (let i = 0; i < s.rows.length; i++) {
      const row = s.rows[i];
      const nums = audit.columns.map((c) => Number.parseFloat(row.values[c.field] ?? ''));
      if (nums.every((n) => !Number.isFinite(n))) continue; // untouched row
      if (nums.some((n) => !Number.isFinite(n))) {
        return fail(`Sample ${i + 1} is missing a reading.`);
      }
      const payload: SamplePayload = { sample_number: filled.length + 1 };
      audit.columns.forEach((c, i) => {
        payload[c.field] = nums[i];
      });
      filled.push(payload);
    }
    if (filled.length === 0) return fail('Enter at least one sample.');

    set({ submitting: true });
    try {
      const outcome = await karenFlowerAuditRepository.submit({
        audit_type: audit.type,
        farm: s.farm,
        greenhouse: audit.needsGreenhouse ? s.greenhouse : undefined,
        variety: s.variety,
        remarks: s.remarks || undefined,
        samples: filled,
      });
      set({ submitting: false });
      return outcome;
    } catch (err) {
      set({ submitting: false });
      return fail(mapAxiosError(err).message);
    }
  },
}));
