import { create } from 'zustand';
import { mapAxiosError } from '@/src/core/api/client';
import { uploadImage } from '@/src/core/api/upload';
import {
  karenProductTemperatureRepository,
  type CustomerOption,
  type SubmitOutcome,
} from '../repository/karen-product-temperature-repository';
import type { BoxPayload } from '../api/karen-product-temperature-api';

/** One box on one control point: the reading and the photo backing it. */
export type BoxState = {
  temp: string;
  /** Local camera URI, shown immediately while the upload runs. */
  photoUri: string | null;
  /** Frappe file_url once the upload finishes — this is what gets saved. */
  photoUrl: string | null;
  uploading: boolean;
  uploadError: string | null;
};

const blankBox = (): BoxState => ({
  temp: '',
  photoUri: null,
  photoUrl: null,
  uploading: false,
  uploadError: null,
});

function blankReadings(controlPoints: string[], boxes: number): Record<string, BoxState[]> {
  return Object.fromEntries(
    controlPoints.map((cp) => [cp, Array.from({ length: boxes }, blankBox)]),
  );
}

function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

type State = {
  // ── Pickers ───────────────────────────────────────────────────────────
  controlPoints: string[];
  customers: CustomerOption[];
  boxes: number;
  loading: boolean;
  error: string | null;

  // ── Form ──────────────────────────────────────────────────────────────
  date: string;
  customer: string;
  /** The control point being filled in right now — one log is saved per one. */
  controlPoint: string;
  /** control point -> one entry per box, indexed 0-based. Readings are kept
   *  per control point so switching tabs never discards unsaved work. */
  readings: Record<string, BoxState[]>;
  submitting: boolean;

  load: () => Promise<void>;
  setDate: (date: string) => void;
  setCustomer: (customer: string) => void;
  setControlPoint: (controlPoint: string) => void;
  setTemp: (controlPoint: string, box: number, text: string) => void;
  uploadPhoto: (controlPoint: string, box: number, localUri: string) => Promise<void>;
  /** How many boxes carry a reading — drives the unsaved marker per tab. */
  filledCount: (controlPoint: string) => number;
  /** Saves the selected control point only, as its own Temperature Log Entry. */
  submit: () => Promise<SubmitOutcome>;
};

export const useKarenProductTemperatureStore = create<State>((set, get) => ({
  controlPoints: [],
  customers: [],
  boxes: 5,
  loading: false,
  error: null,

  date: todayDate(),
  customer: '',
  controlPoint: '',
  readings: {},
  submitting: false,

  load: async () => {
    set({ loading: true, error: null });
    try {
      const data = await karenProductTemperatureRepository.fetchFormData();
      set((s) => ({
        controlPoints: data.controlPoints,
        customers: data.customers,
        boxes: data.boxes,
        readings: blankReadings(data.controlPoints, data.boxes),
        // Keep the operator's pick across a retry; otherwise start at the first.
        controlPoint: data.controlPoints.includes(s.controlPoint)
          ? s.controlPoint
          : (data.controlPoints[0] ?? ''),
        loading: false,
      }));
    } catch (err) {
      set({ loading: false, error: mapAxiosError(err).message });
    }
  },

  setDate: (date) => set({ date }),
  setCustomer: (customer) => set({ customer }),
  setControlPoint: (controlPoint) => set({ controlPoint }),

  setTemp: (controlPoint, box, text) =>
    set((s) => {
      const current = s.readings[controlPoint];
      if (!current) return s;
      const next = current.map((b, i) => (i === box ? { ...b, temp: text } : b));
      return { readings: { ...s.readings, [controlPoint]: next } };
    }),

  uploadPhoto: async (controlPoint, box, localUri) => {
    const patch = (p: Partial<BoxState>) =>
      set((s) => {
        const current = s.readings[controlPoint];
        if (!current) return s;
        const next = current.map((b, i) => (i === box ? { ...b, ...p } : b));
        return { readings: { ...s.readings, [controlPoint]: next } };
      });

    // Show the local shot straight away; spinner overlays it while it uploads.
    patch({ photoUri: localUri, uploading: true, uploadError: null });
    try {
      const uploaded = await uploadImage(localUri, 'product-temp.jpg');
      patch({ photoUrl: uploaded.file_url, uploading: false, uploadError: null });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Upload failed.';
      patch({ uploading: false, uploadError: message });
    }
  },

  filledCount: (controlPoint) =>
    (get().readings[controlPoint] ?? []).filter(
      (b) => b.temp.trim() !== '' || !!b.photoUri,
    ).length,

  submit: async () => {
    const s = get();
    const cp = s.controlPoint;
    const fail = (message: string): SubmitOutcome => ({ kind: 'error', message });

    if (!cp) return fail('Pick a control point.');
    if (!s.date) return fail('Pick a date.');

    const row = s.readings[cp] ?? [];
    const boxes: (BoxPayload | null)[] = [];
    let any = false;

    for (let i = 0; i < row.length; i++) {
      const b = row[i];
      const temp = Number.parseFloat(b.temp);
      const hasTemp = Number.isFinite(temp);
      if (!hasTemp && !b.photoUri) {
        boxes.push(null);
        continue;
      }
      if (b.uploading) return fail(`Box ${i + 1}: photo is still uploading.`);
      if (!hasTemp) return fail(`Box ${i + 1}: enter the temperature.`);
      // Photos are mandatory — a reading without one can't be verified later.
      if (!b.photoUrl) {
        return fail(
          b.uploadError
            ? `Box ${i + 1}: photo failed to upload — retake it.`
            : `Box ${i + 1}: capture a photo.`,
        );
      }
      boxes.push({ temp, photo: b.photoUrl });
      any = true;
    }

    if (!any) return fail(`Record at least one ${cp} box temperature.`);

    set({ submitting: true });
    try {
      const outcome = await karenProductTemperatureRepository.submit({
        date: s.date,
        customer: s.customer || undefined,
        readings: [{ control_point: cp, boxes }],
      });
      set((cur) => ({
        submitting: false,
        // Clear just this control point on success — date, customer and any
        // other control point's unsaved work carry over to the next log.
        readings:
          outcome.kind === 'ok'
            ? { ...cur.readings, [cp]: Array.from({ length: cur.boxes }, blankBox) }
            : cur.readings,
      }));
      return outcome;
    } catch (err) {
      set({ submitting: false });
      return fail(mapAxiosError(err).message);
    }
  },
}));
