import { create } from 'zustand';
import {
  karenPackhouseCleaningApi,
  type CleaningPayload,
  type GlassPayload,
  type InspectionPayload,
} from '../api/karen-packhouse-cleaning-api';
import { mapAxiosError } from '@/src/core/api/client';

export type SubmitOutcome =
  | { kind: 'ok'; name: string; message: string }
  | { kind: 'error'; message: string };

type State = {
  submitting: boolean;
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
