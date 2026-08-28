import { api } from '@/src/core/api/client';

/** One row from /fetchAllocatedBuckets — a single bucket awaiting transfer
 *  out of a remote farm into the central facility. */
export type RawAllocationItem = {
  // OPL info
  opl_name?: string;
  customer?: string;
  order_name?: string;
  consignee?: string;
  sales_order?: string;
  opl_status?: string;
  // Pick list item
  pick_list_item_id?: string;
  item_code?: string;
  item_name?: string;
  qty?: number;
  uom?: string;
  stem_length?: string;
  // Location
  shelf_location?: string;
  warehouse?: string;
  // Bucket
  bucket_id?: string;
  harvest_date?: string;
  harvest_time?: string;
  /** Date the OPL was created = when the buckets were allocated. */
  allocated_date?: string;
};

export type RawAllocationResponse = {
  message?: string;
  data?: RawAllocationItem[];
  vehicles?: string[];
  http_status_code?: number;
  error?: string;
};

/** Item that appears inside a saved trolley row. The schema is slightly
 *  flatter than RawAllocationItem because the server normalises it before
 *  emitting (no OPL metadata, no harvest date — those live on the OPL). */
export type RawSavedTrolleyBucket = {
  opl_name?: string;
  bucket_id?: string;
  item_code?: string;
  item_name?: string;
  shelf_location?: string;
  stem_length?: string;
  qty?: number;
  uom?: string;
  truck?: string;
  warehouse?: string;
};

export type RawSavedTrolley = {
  trolley_id?: string;
  truck_id?: string;
  buckets?: RawSavedTrolleyBucket[];
};

/** The server wraps these endpoints' payloads inside `{ message: { status, ...} }`
 *  because they return via `frappe.response["message"] = {...}`. */
export type RawSavedTrolleysResponse = {
  message?: { status?: string; data?: RawSavedTrolley[]; message?: string };
};

export type RawTrolleyActionResponse = {
  message?: {
    status?: 'success' | 'error' | string;
    message?: string;
    updated_count?: number;
    shelf_removed_count?: number;
    cleared_count?: number;
    skipped_loaded?: string[];
    updated?: number;
    missing?: number;
    errors?: { bucket_id?: string; error?: string }[];
  };
};

/** One order-portion from THIS farm sitting on a planned trip. */
export type RawPlannedTripOrder = {
  opl?: string;
  order_name?: string;
  customer?: string;
  farm?: string;
  varieties?: string;
  buckets?: number;
  stems?: number;
};

/** One stop (farm) on a trip's collection route, with its live loading status. */
export type RawPlannedTripStop = {
  farm?: string;
  stop?: number;
  is_you?: number;
  planned?: number;
  total?: number;
  awaiting?: number;
  loaded?: number;
  transit?: number;
  shelved?: number;
  done_count?: number;
  /** waiting | loading | ready | transit | done */
  status?: string;
  /** 1 = first stop still holding up the run (bottleneck). */
  delaying?: number;
};

/** One upcoming planned trip (Bucket Request Trip) that collects from this farm. */
export type RawPlannedTrip = {
  trip?: string;
  vehicle?: string;
  trip_date?: string;
  status?: string;
  capacity?: number;
  trip_buckets?: number;
  /** 1 = some buckets on this trip are already on the truck / delivered. */
  in_transit?: number;
  /** Buckets bound for this trip that come from THIS farm. */
  farm_buckets?: number;
  /** This farm's position in the collection route (1-based; 0 = unsequenced). */
  your_stop?: number;
  total_stops?: number;
  /** Every stop on the route, in collection order, with live status. */
  stops?: RawPlannedTripStop[];
  /** THIS farm's order lines on the trip (used to tag the Requests tab). */
  orders?: RawPlannedTripOrder[];
};

export type RawPlannedTripsResponse = {
  message?: { status?: string; data?: RawPlannedTrip[]; farm?: string; message?: string };
};

/** One truck from /getDispatchTrucks (Vehicle where custom_dispatch_truck = 0). */
export type RawDispatchTruck = { name?: string; license_plate?: string };

export type RawDispatchTrucksResponse = {
  message?: { status?: string; trucks?: RawDispatchTruck[]; message?: string };
};

export const karenBucketRequestsApi = {
  /** Pull every bucket currently awaiting transfer for `farm`, plus the
   *  vehicle list the operator can later load each trolley into. */
  fetchAllocatedBuckets(farm: string): Promise<RawAllocationResponse> {
    return api<RawAllocationResponse>({
      method: 'POST',
      url: '/api/method/upande_quality.mobile.api.fetchAllocatedBuckets',
      data: { farm },
      validateStatus: () => true,
    });
  },

  /** Upcoming planned trips (Bucket Request Trip) that will collect buckets from
   *  `farm`, so the cold-store attendant can pre-stage trolleys. Standalone
   *  endpoint — separate from the production allocation/trolley scripts. */
  getFarmPlannedTrips(farm: string): Promise<RawPlannedTripsResponse> {
    return api<RawPlannedTripsResponse>({
      method: 'POST',
      url: '/api/method/upande_quality.mobile.api.getFarmPlannedTrips',
      data: { farm },
      validateStatus: () => true,
    });
  },

  /** The dispatch/collection trucks the operator can load a completed order
   *  onto — Vehicles with "Dispatch Truck?" unchecked. Cached offline. */
  getDispatchTrucks(): Promise<RawDispatchTrucksResponse> {
    return api<RawDispatchTrucksResponse>({
      method: 'GET',
      url: '/api/method/upande_quality.mobile.api.getDispatchTrucks',
      validateStatus: () => true,
    });
  },

  /** Persist a trolley's bucket assignments and clear the buckets from their
   *  shelves. */
  saveTrolleyData(payload: {
    trolley_id: string;
    buckets: { opl_name: string; bucket_id: string }[];
  }): Promise<RawTrolleyActionResponse> {
    return api<RawTrolleyActionResponse>({
      method: 'POST',
      url: '/api/method/upande_quality.mobile.api.saveTrolleyData',
      data: { data: payload },
      validateStatus: () => true,
    });
  },

  /** List saved (already-persisted) trolleys for a farm. */
  getSavedTrolleys(farm: string): Promise<RawSavedTrolleysResponse> {
    return api<RawSavedTrolleysResponse>({
      method: 'GET',
      url: '/api/method/upande_quality.mobile.api.getSavedTrolleys',
      params: { farm },
      validateStatus: () => true,
    });
  },

  /** Mark every bucket in a trolley as in_transit on the given truck. */
  loadTrolleyInTruck(payload: {
    trolley_id: string;
    truck_id: string;
  }): Promise<RawTrolleyActionResponse> {
    return api<RawTrolleyActionResponse>({
      method: 'POST',
      url: '/api/method/upande_quality.mobile.api.loadTrolleyInTruck',
      data: { data: payload },
      validateStatus: () => true,
    });
  },

  /** Undo saved trolleys on the server (clears the grouping; does NOT re-shelve).
   *  `trolley_ids` is a "|~|"-joined string (the Server Script is safe_exec and
   *  cannot parse JSON). */
  deleteSavedTrolleys(payload: {
    trolley_ids: string;
    farm: string;
  }): Promise<RawTrolleyActionResponse> {
    return api<RawTrolleyActionResponse>({
      method: 'POST',
      url: '/api/method/upande_quality.mobile.api.deleteSavedTrolleys',
      data: payload,
      validateStatus: () => true,
    });
  },

  /** Offline app sync: additively mark Pick List Item rows loaded-in-trolley
   *  or in-transit on the server (never submits the OPL). */
  setOfflineTrolleyFlags(payload: {
    pli_ids: string[];
    flag: 'loaded' | 'transit';
    /** Vehicle name to stamp onto each row's custom_transit_truck (loaded only). */
    truck?: string;
  }): Promise<RawTrolleyActionResponse> {
    return api<RawTrolleyActionResponse>({
      method: 'POST',
      url: '/api/method/upande_quality.mobile.api.setOfflineTrolleyFlags',
      data: { data: payload },
      validateStatus: () => true,
    });
  },
};
