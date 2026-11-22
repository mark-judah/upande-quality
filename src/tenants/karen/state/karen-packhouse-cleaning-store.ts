import { create } from 'zustand';
import {
  karenPackhouseCleaningApi,
  type CleaningPayload,
  type GlassPayload,
  type InspectionPayload,
} from '../api/karen-packhouse-cleaning-api';
import { mapAxiosError } from '@/src/core/api/client';
import type { ComponentSpec } from '../features/packhouse-cleaning/constants';

export type SubmitOutcome =
  | { kind: 'ok'; name: string; message: string }
  | { kind: 'error'; message: string };

type State = {
  submitting: boolean;
  inspectionAreas: string[];
  inspectionComponents: ComponentSpec[];
  setupLoading: boolean;
  setupError: string | null;
  /** Loads the Inspection Log's areas and items from the server (no hard-coded lists). */
  loadInspectionSetup: () => Promise<void>;
  submitInspection: (payload: InspectionPayload) => Promise<SubmitOutcome>;
  submitGlass: (payload: GlassPayload) => Promise<SubmitOutcome>;
  submitCleaning: (payload: CleaningPayload) => Promise<SubmitOutcome>;
};

function toResult(res: { message?: { status?: string; name?: string; message?: string } }): SubmitOutcome {
  const m = res.message ?? {};
  if (m.status === 'success') return { kind: 'ok', name: m.name ?? '', message: m.message ?? 'Saved.' };
  return { kind: 'error', message: m.message ?? 'Save failed.' };
}

export const useKarenPackhouseCleaningStore = create<State>((set) => ({
  submitting: false,
  inspectionAreas: [],
  inspectionComponents: [],
  setupLoading: false,
  setupError: null,

  loadInspectionSetup: async () => {
    set({ setupLoading: true, setupError: null });
    try {
      const m = (await karenPackhouseCleaningApi.getInspectionSetup()).message;
      if (!m) throw new Error('Could not load the inspection setup.');
      const components = (m.components ?? [])
        .filter((c) => c.label)
        .map((c) => ({ label: c.label as string, options: c.options ?? [] }));
      set({ inspectionAreas: m.areas ?? [], inspectionComponents: components, setupLoading: false });
    } catch (err) {
      set({ setupLoading: false, setupError: mapAxiosError(err).message });
    }
  },

  submitInspection: async (payload) => {
    set({ submitting: true });
    try {
      const res = await karenPackhouseCleaningApi.submitInspection(payload);
      set({ submitting: false });
      return toResult(res);
    } catch (err) {
      set({ submitting: false });
      return { kind: 'error', message: mapAxiosError(err).message };
    }
  },

  submitGlass: async (payload) => {
    set({ submitting: true });
    try {
      const res = await karenPackhouseCleaningApi.submitGlass(payload);
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
      const res = await karenPackhouseCleaningApi.submitCleaning(payload);
      set({ submitting: false });
      return toResult(res);
    } catch (err) {
      set({ submitting: false });
      return { kind: 'error', message: mapAxiosError(err).message };
    }
  },
}));
