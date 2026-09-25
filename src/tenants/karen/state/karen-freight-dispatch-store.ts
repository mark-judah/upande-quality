import { create } from 'zustand';
import { mapAxiosError } from '@/src/core/api/client';
import { uploadImage } from '@/src/core/api/upload';
import {
  karenFreightDispatchRepository,
  type ActionOutcome,
  type CustomerOption,
  type VehicleOption,
} from '../repository/karen-freight-dispatch-repository';
import type { RawTrip } from '../api/karen-freight-dispatch-api';

type State = {
  // ── Pickers ───────────────────────────────────────────────────────────
  vehicles: VehicleOption[];
  deliveryPoints: string[];
  customers: CustomerOption[];
  loading: boolean;
  error: string | null;

  /** The trip in progress, or null when the driver is between trips. */
  trip: RawTrip | null;
  busy: boolean;

  // ── Depart form ───────────────────────────────────────────────────────
  vehicle: string;
  /** Every point this run will serve — the first becomes the freight agent. */
  dropOffPoints: string[];
  truckTemp: string;
  docketUri: string | null;
  docketUrl: string | null;
  docketUploading: boolean;
  docketError: string | null;

  // ── Offload form ──────────────────────────────────────────────────────
  /** Which of the trip's drop-off points this offload is at. */
  offloadPoint: string;
  customer: string;
  boxes: string;
  maxTemp: string;

  load: () => Promise<void>;
  setVehicle: (v: string) => void;
  addDropOffPoint: (v: string) => void;
  removeDropOffPoint: (v: string) => void;
  setTruckTemp: (v: string) => void;
  uploadDocket: (localUri: string) => Promise<void>;
  setOffloadPoint: (v: string) => void;
  setCustomer: (v: string) => void;
  setBoxes: (v: string) => void;
  setMaxTemp: (v: string) => void;

  depart: () => Promise<ActionOutcome>;
  arrive: () => Promise<ActionOutcome>;
  offload: () => Promise<ActionOutcome>;
  departAgent: () => Promise<ActionOutcome>;
};

const emptyDepartForm = {
  vehicle: '',
  dropOffPoints: [] as string[],
  truckTemp: '',
  docketUri: null as string | null,
  docketUrl: null as string | null,
  docketUploading: false,
  docketError: null as string | null,
};

const emptyOffloadForm = { offloadPoint: '', customer: '', boxes: '', maxTemp: '' };

function num(v: string): number | undefined {
  const n = Number.parseFloat(v);
  return Number.isFinite(n) ? n : undefined;
}

export const useKarenFreightDispatchStore = create<State>((set, get) => ({
  vehicles: [],
  deliveryPoints: [],
  customers: [],
  loading: false,
  error: null,

  trip: null,
  busy: false,

  ...emptyDepartForm,
  ...emptyOffloadForm,

  load: async () => {
    set({ loading: true, error: null });
    try {
      const data = await karenFreightDispatchRepository.fetchFormData();
      set({
        vehicles: data.vehicles,
        deliveryPoints: data.deliveryPoints,
        customers: data.customers,
        trip: data.trip,
        loading: false,
      });
    } catch (err) {
      set({ loading: false, error: mapAxiosError(err).message });
    }
  },

  setVehicle: (vehicle) => set({ vehicle }),
  // Picked from the dropdown one at a time; the order picked is the order
  // sent, and the first becomes the trip's freight agent.
  addDropOffPoint: (point) =>
    set((s) =>
      s.dropOffPoints.includes(point)
        ? s
        : { dropOffPoints: [...s.dropOffPoints, point] },
    ),
  removeDropOffPoint: (point) =>
    set((s) => ({ dropOffPoints: s.dropOffPoints.filter((p) => p !== point) })),
  setTruckTemp: (truckTemp) => set({ truckTemp }),
  setOffloadPoint: (offloadPoint) => set({ offloadPoint }),
  setCustomer: (customer) => set({ customer }),
  setBoxes: (boxes) => set({ boxes }),
  setMaxTemp: (maxTemp) => set({ maxTemp }),

  uploadDocket: async (localUri) => {
    set({ docketUri: localUri, docketUploading: true, docketError: null });
    try {
      const uploaded = await uploadImage(localUri, 'docket.jpg');
      set({ docketUrl: uploaded.file_url, docketUploading: false, docketError: null });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Upload failed.';
      set({ docketUploading: false, docketError: message });
    }
  },

  depart: async () => {
    const s = get();
    const fail = (message: string): ActionOutcome => ({ kind: 'error', message });
    if (!s.vehicle) return fail('Pick a vehicle.');
    if (s.dropOffPoints.length === 0) return fail('Pick at least one drop off point.');
    const temp = num(s.truckTemp);
    if (temp === undefined) return fail('Enter the truck temperature.');
    if (s.docketUploading) return fail('The docket photo is still uploading.');
    // The docket is the proof the load left with — no trip starts without it.
    if (!s.docketUrl) {
      return fail(s.docketError ? 'Docket photo failed to upload — retake it.' : 'Capture the docket photo.');
    }

    set({ busy: true });
    try {
      const outcome = await karenFreightDispatchRepository.start({
        vehicle: s.vehicle,
        drop_off_points: s.dropOffPoints,
        truck_temperature: temp,
        docket_photo: s.docketUrl,
      });
      set(
        outcome.kind === 'ok'
          ? { busy: false, trip: outcome.trip, ...emptyDepartForm }
          : { busy: false },
      );
      return outcome;
    } catch (err) {
      set({ busy: false });
      return fail(mapAxiosError(err).message);
    }
  },

  arrive: async () => {
    const trip = get().trip?.name;
    if (!trip) return { kind: 'error', message: 'No trip in progress.' };
    set({ busy: true });
    try {
      const outcome = await karenFreightDispatchRepository.arrive(trip);
      set(outcome.kind === 'ok' ? { busy: false, trip: outcome.trip } : { busy: false });
      return outcome;
    } catch (err) {
      set({ busy: false });
      return { kind: 'error', message: mapAxiosError(err).message };
    }
  },

  offload: async () => {
    const s = get();
    const fail = (message: string): ActionOutcome => ({ kind: 'error', message });
    const trip = s.trip?.name;
    if (!trip) return fail('No trip in progress.');
    if (!s.offloadPoint) return fail('Pick the drop off point.');
    if (!s.customer) return fail('Pick a customer.');
    const boxes = num(s.boxes);
    if (boxes === undefined || boxes <= 0) return fail('Enter the boxes delivered.');
    const maxTemp = num(s.maxTemp);
    if (maxTemp === undefined) return fail('Enter the max temperature.');

    set({ busy: true });
    try {
      const outcome = await karenFreightDispatchRepository.offload({
        trip,
        delivery_point: s.offloadPoint,
        customer: s.customer,
        boxes_delivered: Math.round(boxes),
        max_temperature: maxTemp,
      });
      // Clear the offload form on success so the next customer starts fresh.
      set(
        outcome.kind === 'ok'
          ? { busy: false, trip: outcome.trip, ...emptyOffloadForm }
          : { busy: false },
      );
      return outcome;
    } catch (err) {
      set({ busy: false });
      return fail(mapAxiosError(err).message);
    }
  },

  departAgent: async () => {
    const trip = get().trip?.name;
    if (!trip) return { kind: 'error', message: 'No trip in progress.' };
    set({ busy: true });
    try {
      const outcome = await karenFreightDispatchRepository.departAgent(trip);
      set(outcome.kind === 'ok' ? { busy: false, trip: null } : { busy: false });
      return outcome;
    } catch (err) {
      set({ busy: false });
      return { kind: 'error', message: mapAxiosError(err).message };
    }
  },
}));
