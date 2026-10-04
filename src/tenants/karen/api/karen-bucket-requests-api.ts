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
  /** Remote farm the bucket is transferred from. */
  farm?: string;
  // Bucket
  bucket_id?: string;
  harvest_date?: string;
  harvest_time?: string;
  /** Date the OPL was created = when the buckets were allocated. */
  allocated_date?: string;
  /** Sales Order delivery date (YYYY-MM-DD). */
  delivery_date?: string;
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
  delivery_date?: string;
  opl?: string;
  order_name?: string;
  customer?: string;
  farm?: string;
  varieties?: string;
  buckets?: number;
  stems?: number;
  /** This order's own progress at the farm (transfer buckets / on trolley / in transit / shelved). */
  total?: number;
  loaded?: number;
  transit?: number;
  shelved?: number;
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
  /** Which run of the truck's route this trip drives (packhouse → farms → packhouse);
   *  0 = a trip from before runs existed. */
  run?: number;
  runs?: number;
  /** "Kapkolia → Chepsito → Kapkolia". */
  run_chain?: string;
  /** Route time window, "06:00–18:00". */
  window?: string;
  /** current = the run the truck is loading now; later = waits for an earlier run. */
  run_state?: string;
  /** The run it waits for (run_state later). */
  after_run?: number;
  /** 1 = this farm's stop is closed (the truck left it). */
  your_stop_closed?: number;
  loaded_buckets?: number;
  departed_stops?: string[];
  heading_to?: string;
};

export type RawPlannedTripsResponse = {
  message?: {
    status?: string;
    data?: RawPlannedTrip[];
    farm?: string;
    message?: string;
    /** OPL -> its Packhouse Schedule slot, for orders scheduled but not yet on a trip. */
    schedules?: Record<string, { team?: string; schedule?: number; scheduled?: number }>;
    /** Live state of this farm's buckets per OPL the app sent in `opls`. */
    opl_states?: Record<string, 'waiting' | 'loaded' | 'transit' | 'arrived' | string>;
  };
};

/** One truck from /getDispatchTrucks (Vehicle where custom_dispatch_truck = 0). */
/** /findRequestedBucketReplacement + /replaceRequestedBucket reply. */
export type RawBucketReplacementResponse = {
  message?: {
    status?: string;
    message?: string;
    found?: boolean;
    old_bucket?: string;
    new_bucket?: string;
    shelf?: string;
    /** The replacement's own (graded) length — may be longer than the original. */
    stem_length?: string;
    available_qty?: number;
    needed_qty?: number;
    harvest_date?: string;
    variety?: string;
    /** Every matching bucket, best first (newer servers only). */
    candidates?: RawReplacementCandidate[];
  };
};

export type RawReplacementCandidate = {
  new_bucket?: string;
  shelf?: string;
  variety?: string;
  stem_length?: string;
  available_qty?: number;
  harvest_date?: string | null;
};

export type RawDispatchTruck = { name?: string; license_plate?: string };

export type RawDispatchTrucksResponse = {
  message?: { status?: string; trucks?: RawDispatchTruck[]; message?: string };
};

export type RawCompletedTrip = {
  trip?: string;
  vehicle?: string;
  trip_date?: string;
  status?: string;
  run?: number;
  runs?: number;
  run_chain?: string;
  left_at?: string;
  dispatched_at?: string;
  planned?: number;
  loaded?: number;
  left_behind?: number;
  carried_to?: string[];
  stop_reopenable?: boolean;
  orders?: { opl?: string; delivery_date?: string; order_name?: string; customer?: string; varieties?: string; buckets?: number; loaded?: number }[];
};
export type RawCompletedTripsMessage = { status?: string; message?: string; trips?: RawCompletedTrip[] };
export type RawReopenMessage = {
  status?: string;
  message?: string;
  mode?: 'stop' | 'next_trip';
  left_behind?: number;
  trips?: string[];
};

export type RawShelvedTrip = {
  trip?: string;
  vehicle?: string;
  status?: string;
  trip_date?: string;
  dispatched_at?: string;
  arrived_at?: string;
  received_at?: string;
  total?: number;
  shelved?: number;
  buckets?: {
    bucket?: string;
    opl?: string;
    order_name?: string;
    customer?: string;
    shelved?: boolean;
    shelf?: string;
    shelved_at?: string;
  }[];
};

export type RawTripArrival = {
  status?: string;
  message?: string;
  reason?: string;
  unshelved?: string[];
  name?: string;
  hub?: string;
  trip_status?: string;
  arrived_at?: string;
  received_at?: string;
  total?: number;
  shelved?: number;
  waiting?: string[];
  farm_total?: number;
  farm_shelved?: number;
  /** Every bucket on the trip with its order's delivery date. */
  buckets?: { bucket?: string; opl?: string; farm?: string; shelved?: boolean; off_truck?: boolean; delivery_date?: string }[];
};

export const karenBucketRequestsApi = {
  /** Pull every bucket currently awaiting transfer for `farm`, plus the
   *  vehicle list the operator can later load each trolley into. */
  /** `fromDate`/`toDate` (YYYY-MM-DD) pick the delivery window; the server defaults to
   *  today .. day after tomorrow. */
  fetchAllocatedBuckets(farm: string, fromDate?: string, toDate?: string): Promise<RawAllocationResponse> {
    return api<RawAllocationResponse>({
      method: 'POST',
      url: '/api/method/upande_quality.mobile.api.fetchAllocatedBuckets',
      data: fromDate ? { farm, from_date: fromDate, to_date: toDate || fromDate } : { farm },
      validateStatus: () => true,
    });
  },

  /** Upcoming planned trips (Bucket Request Trip) that will collect buckets from
   *  `farm`, so the cold-store attendant can pre-stage trolleys. Standalone
   *  endpoint — separate from the production allocation/trolley scripts. */
  getFarmPlannedTrips(farm: string, opls: string[] = []): Promise<RawPlannedTripsResponse> {
    return api<RawPlannedTripsResponse>({
      method: 'POST',
      url: '/api/method/upande_quality.mobile.api.getFarmPlannedTrips',
      data: { farm, opls },
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

  /** The requested bucket isn't in the cold room and nothing can replace it: leave it
   *  out of the transfer so the order can load with the buckets that are there. */
  markRequestedBucketNotFound(payload: { pick_list_item: string; notes?: string }): Promise<RawTrolleyActionResponse> {
    return api<RawTrolleyActionResponse>({
      method: 'POST',
      url: '/api/method/upande_packhouse.api.transfer_control.markRequestedBucketNotFound',
      data: payload,
      validateStatus: () => true,
    });
  },

  /** "Issued offline": which line (team) a requested bucket was issued to. */
  requestedBucketIssueInfo(pickListItem: string): Promise<{
    message?: {
      status?: string;
      message?: string;
      bucket?: string;
      line?: string;
      this_issued?: boolean;
      same_line?: boolean;
      issued_to?: { opl: string; order_name?: string; team?: string; same_line?: boolean }[];
    };
  }> {
    return api({
      method: 'POST',
      url: '/api/method/upande_quality.mobile.api.requestedBucketIssueInfo',
      data: { data: { pick_list_item: pickListItem } },
      validateStatus: () => true,
    });
  },

  /** Issued offline to this order's own line: mark it issued (no replacement). */
  markRequestedBucketIssued(pickListItem: string): Promise<{ message?: { status?: string; message?: string } }> {
    return api({
      method: 'POST',
      url: '/api/method/upande_quality.mobile.api.markRequestedBucketIssued',
      data: { data: { pick_list_item: pickListItem } },
      // Issuing posts stock entries; allow it time.
      timeout: 120000,
      validateStatus: () => true,
    });
  },

  /** "Truck leaving": this farm is done loading the trip; the truck goes on to its next
   *  stop, or to the packhouse from the last one. */
  /** `reason`: why fewer buckets than planned go (stop not 100% loaded). */
  closeTripStop(payload: { name: string; farm: string; reason?: string }): Promise<RawTrolleyActionResponse> {
    return api<RawTrolleyActionResponse>({
      method: 'POST',
      url: '/api/method/upande_packhouse.api.transfer_control.closeTripStop',
      data: payload,
      validateStatus: () => true,
    });
  },

  /** This farm's finished trips (stop closed / dispatched / received), newest first. */
  getFarmCompletedTrips(farm: string): Promise<{ message?: RawCompletedTripsMessage }> {
    return api<{ message?: RawCompletedTripsMessage }>({
      method: 'POST',
      url: '/api/method/upande_packhouse.api.transfer_control.getFarmCompletedTrips',
      data: { farm },
      validateStatus: () => true,
    });
  },

  /** Reopen this farm's stop on a trip that left before every planned bucket loaded:
   *  the stop opens again (truck still on its run) or the rest moves to the next run. */
  reopenTripStop(payload: { name: string; farm: string }): Promise<{ message?: RawReopenMessage }> {
    return api<{ message?: RawReopenMessage }>({
      method: 'POST',
      url: '/api/method/upande_packhouse.api.transfer_control.reopenTripStop',
      data: payload,
      validateStatus: () => true,
    });
  },

  /** This farm's dispatched buckets for orders delivering on `deliveryDate` and whether
   *  each is shelved at the hub. */
  getFarmShelvedBuckets(farm: string, deliveryDate?: string): Promise<{ message?: { status?: string; message?: string; hub?: string; trips?: RawShelvedTrip[] } }> {
    return api({
      method: 'POST',
      url: '/api/method/upande_packhouse.api.transfer_control.getFarmShelvedBuckets',
      data: deliveryDate ? { farm, delivery_date: deliveryDate } : { farm },
      validateStatus: () => true,
    });
  },

  /** Truck at the transfer hub: `status`, confirm `arrive`, or `complete` the trip once
   *  every bucket it carried is shelved there. */
  tripArrival(payload: {
    name: string;
    farm: string;
    action: 'status' | 'arrive' | 'complete';
  }): Promise<{ message?: RawTripArrival }> {
    return api<{ message?: RawTripArrival }>({
      method: 'POST',
      url: '/api/method/upande_packhouse.api.transfer_control.tripArrival',
      data: payload,
      validateStatus: () => true,
    });
  },

  /** Put a planned trip on another truck before loading ("Change truck"). */
  changeTripVehicle(payload: { name: string; vehicle: string }): Promise<RawTrolleyActionResponse> {
    return api<RawTrolleyActionResponse>({
      method: 'POST',
      url: '/api/method/upande_packhouse.api.transfer_control.changeTripVehicle',
      data: payload,
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

  /** The matching shelved bucket that would replace a requested one. */
  findRequestedBucketReplacement(pickListItem: string): Promise<RawBucketReplacementResponse> {
    return api<RawBucketReplacementResponse>({
      method: 'POST',
      url: '/api/method/upande_quality.mobile.api.findRequestedBucketReplacement',
      data: { data: { pick_list_item: pickListItem } },
      validateStatus: () => true,
    });
  },

  /** Swap a requested bucket for `newBucketId` (OPL rows, allocation, stock entries). */
  replaceRequestedBucket(
    pickListItem: string,
    newBucketId: string,
    reason?: string,
    notes?: string,
  ): Promise<RawBucketReplacementResponse> {
    return api<RawBucketReplacementResponse>({
      method: 'POST',
      url: '/api/method/upande_quality.mobile.api.replaceRequestedBucket',
      data: { data: { pick_list_item: pickListItem, new_bucket_id: newBucketId, reason, notes } },
      // The swap posts several stock entries in one transaction; allow it time.
      timeout: 120000,
      validateStatus: () => true,
    });
  },
};
