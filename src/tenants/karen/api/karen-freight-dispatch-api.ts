import { api } from '@/src/core/api/client';

export type TripStatus = 'Draft' | 'In Transit' | 'At Agent' | 'Completed';

export type RawOffload = {
  /** Which drop-off point this offload happened at. */
  delivery_point?: string;
  customer?: string;
  start_offloading?: string;
  boxes_delivered?: number;
  max_temperature?: number;
};

/** The whole trip as the server sees it — every action returns a fresh copy. */
export type RawTrip = {
  name?: string;
  status?: TripStatus | string;
  vehicle?: string;
  truck_temperature?: number;
  /** Kept as the first drop-off point, for reports and the dwell-time logic. */
  freight_agent?: string;
  /** Every point this trip is serving. */
  drop_off_points?: string[];
  docket_photo?: string;
  farm_departure_date?: string;
  farm_departure_time?: string;
  freight_arrival_date?: string;
  freight_arrival_time?: string;
  departure_time?: string;
  freight_dwell_time?: string;
  time_taken_from_farm?: string;
  offloads?: RawOffload[];
};

export type RawVehicle = { name?: string; license_plate?: string; description?: string };
export type RawCustomer = { name?: string; customer_name?: string };

export type RawFreightFormData = {
  success?: boolean;
  error?: string;
  vehicles?: RawVehicle[];
  delivery_points?: string[];
  customers?: RawCustomer[];
  /** The driver's own trip in progress, or null when they have none. */
  trip?: RawTrip | null;
};

export type RawActionResponse = {
  message?: {
    status?: 'success' | 'error' | string;
    name?: string;
    message?: string;
    trip?: RawTrip | null;
  };
};

export type StartPayload = {
  vehicle: string;
  /** One or more — the truck may serve several points on one run. */
  drop_off_points: string[];
  truck_temperature: number;
  docket_photo: string;
};

export type OffloadPayload = {
  trip: string;
  delivery_point: string;
  customer: string;
  boxes_delivered: number;
  max_temperature: number;
};

const action = <T extends object>(method: string, data: T): Promise<RawActionResponse> =>
  api<RawActionResponse>({
    method: 'POST',
    url: `/api/method/upande_quality.mobile.api.${method}`,
    data: { data },
    validateStatus: () => true,
  });

export const karenFreightDispatchApi = {
  fetchFormData(): Promise<{ message?: RawFreightFormData }> {
    return api<{ message?: RawFreightFormData }>({
      method: 'GET',
      url: '/api/method/upande_quality.mobile.api.fetchFreightDispatchFormData',
      validateStatus: () => true,
    });
  },

  start: (data: StartPayload) => action('startFreightDispatch', data),
  arrive: (trip: string) => action('arriveAtFreightAgent', { trip }),
  offload: (data: OffloadPayload) => action('recordFreightOffload', data),
  departAgent: (trip: string) => action('departFreightAgent', { trip }),
};
