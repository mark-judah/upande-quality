import {
  karenFreightDispatchApi,
  type OffloadPayload,
  type RawActionResponse,
  type RawTrip,
  type StartPayload,
} from '../api/karen-freight-dispatch-api';

export type VehicleOption = { value: string; label: string; sublabel?: string };
export type CustomerOption = { value: string; label: string };

export type FormData = {
  vehicles: VehicleOption[];
  deliveryPoints: string[];
  customers: CustomerOption[];
  trip: RawTrip | null;
};

/** Every action returns the trip so the screen can re-render from one source. */
export type ActionOutcome =
  | { kind: 'ok'; message: string; trip: RawTrip | null }
  | { kind: 'error'; message: string };

function toOutcome(res: RawActionResponse): ActionOutcome {
  const m = res.message ?? {};
  if (m.status === 'success') {
    return { kind: 'ok', message: m.message ?? 'Saved.', trip: m.trip ?? null };
  }
  return { kind: 'error', message: m.message ?? 'Action failed.' };
}

export const karenFreightDispatchRepository = {
  async fetchFormData(): Promise<FormData> {
    const res = await karenFreightDispatchApi.fetchFormData();
    const m = res.message ?? {};
    if (m.success === false) throw new Error(m.error || 'Could not load form data.');
    return {
      vehicles: (m.vehicles ?? [])
        .filter((v) => !!v.name)
        .map((v) => ({
          value: v.name as string,
          label: v.license_plate || (v.name as string),
          sublabel: v.description || undefined,
        })),
      deliveryPoints: (m.delivery_points ?? []).filter((p): p is string => !!p),
      customers: (m.customers ?? [])
        .filter((c) => !!c.name)
        .map((c) => ({ value: c.name as string, label: c.customer_name || (c.name as string) })),
      trip: m.trip ?? null,
    };
  },

  async start(payload: StartPayload): Promise<ActionOutcome> {
    return toOutcome(await karenFreightDispatchApi.start(payload));
  },
  async arrive(trip: string): Promise<ActionOutcome> {
    return toOutcome(await karenFreightDispatchApi.arrive(trip));
  },
  async offload(payload: OffloadPayload): Promise<ActionOutcome> {
    return toOutcome(await karenFreightDispatchApi.offload(payload));
  },
  async departAgent(trip: string): Promise<ActionOutcome> {
    return toOutcome(await karenFreightDispatchApi.departAgent(trip));
  },
};
