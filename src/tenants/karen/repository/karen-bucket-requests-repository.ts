import {
  karenBucketRequestsApi,
  type RawAllocationItem,
  type RawSavedTrolley,
  type RawSavedTrolleyBucket,
  type RawPlannedTrip,
  type RawPlannedTripOrder,
  type RawPlannedTripStop,
  type RawReplacementCandidate,
} from '../api/karen-bucket-requests-api';

/** Pick-list row as the UI consumes it (snake_case → camelCase, with a stable
 *  per-row key). */
export type AllocationItem = {
  bucketId: string;
  variety: string;
  varietyLabel: string;
  shelfLocation: string;
  /** Remote farm the bucket is transferred from. */
  farm: string;
  stemLength: string;
  qty: number;
  uom: string;
  oplName: string;
  customer: string;
  consignee: string;
  orderName: string;
  harvestDate: string;
  harvestTime: string;
  /** Date the buckets were allocated (OPL creation date). */
  allocatedDate: string;
  /** Sales Order delivery date (YYYY-MM-DD). */
  deliveryDate: string;
  salesOrder: string;
  pickListItemId: string;
};

export type SavedTrolleyBucket = {
  bucketId: string;
  variety: string;
  varietyLabel: string;
  shelfLocation: string;
  stemLength: string;
  qty: number;
  uom: string;
  oplName: string;
  truck: string;
};

export type SavedTrolley = {
  trolleyId: string;
  truckId: string;
  buckets: SavedTrolleyBucket[];
};

/** One order-portion from this farm on a planned trip (UI shape). */
export type PlannedTripOrder = {
  deliveryDate: string;
  opl: string;
  orderName: string;
  customer: string;
  farm: string;
  varieties: string;
  buckets: number;
  stems: number;
  /** This order's own progress at the farm. */
  total: number;
  loaded: number;
  transit: number;
  shelved: number;
};

export type StopStatus = 'waiting' | 'loading' | 'ready' | 'transit' | 'done';

/** One stop on a trip's route with its live loading status (UI shape). */
export type PlannedTripStop = {
  farm: string;
  stop: number;
  isYou: boolean;
  planned: number;
  total: number;
  awaiting: number;
  loaded: number;
  transit: number;
  shelved: number;
  doneCount: number;
  status: StopStatus;
  /** true = first stop still holding up the run. */
  delaying: boolean;
};

/** An upcoming planned trip coming to collect from this farm (UI shape). */
/** Why a requested bucket is being replaced (Bucket Replacement.reason). */
export type ReplaceReason = 'Missing' | 'Damaged' | 'Wrong variety' | 'Issued offline' | 'Other';
/** Where a requested bucket was issued ("Issued offline"): the lines (OPL teams) it
 *  went to, and whether one is this order's own line (then: mark issued, no replace). */
export type BucketIssueInfo = {
  kind: 'ok';
  line: string;
  thisIssued: boolean;
  sameLine: boolean;
  issuedTo: { opl: string; orderName: string; team: string; sameLine: boolean }[];
};

/** Reasons offered in the replace modal ('Other' stays a valid type for older records). */
export const REPLACE_REASONS: ReplaceReason[] = ['Missing', 'Damaged', 'Wrong variety', 'Issued offline'];

export type PlannedTrip = {
  tripId: string;
  vehicle: string;
  tripDate: string;
  status: string;
  /** true once confirmed (Scheduled) — the plan is locked and actionable. */
  confirmed: boolean;
  /** true = some of the trip's buckets are already on the truck / delivered. */
  inTransit: boolean;
  yourStop: number;
  totalStops: number;
  farmBuckets: number;
  tripBuckets: number;
  capacity: number;
  stops: PlannedTripStop[];
  orders: PlannedTripOrder[];
  /** Run of the truck's route (one trip per run: packhouse → farms → packhouse); 0 = none. */
  run: number;
  runs: number;
  runChain: string;
  window: string;
  /** The truck is loading this run now (else it waits for run `afterRun` to come back). */
  current: boolean;
  afterRun: number;
  /** This farm's stop is closed — the truck has left it. */
  yourStopClosed: boolean;
  loadedBuckets: number;
};

/** A trip the truck has left this farm on (stop closed, dispatched or received). */
export type CompletedTrip = {
  tripId: string;
  vehicle: string;
  tripDate: string;
  status: string;
  run: number;
  runs: number;
  runChain: string;
  leftAt: string;
  planned: number;
  loaded: number;
  leftBehind: number;
  /** Open trips that now carry what this one left behind. */
  carriedTo: string[];
  /** Still on its run: the stop itself can reopen (else the rest goes to the next run). */
  stopReopenable: boolean;
  /** At the hub: stamped arrived, or any bucket it carried shelved there. */
  arrived: boolean;
  orders: { opl: string; deliveryDate: string; orderName: string; customer: string; varieties: string; buckets: number; loaded: number }[];
};

/** A dispatched trip at the transfer hub: whether the truck is confirmed there and how
 *  many of the buckets it carried are shelved (whole trip, and this farm's). */
export type TripArrival = {
  tripId: string;
  hub: string;
  tripStatus: string;
  arrivedAt: string;
  receivedAt: string;
  total: number;
  shelved: number;
  /** Buckets still on the truck — not shelved at the hub yet. */
  waiting: string[];
  farmTotal: number;
  farmShelved: number;
  /** Every bucket on the trip with its order's delivery date (for the date filter). */
  buckets: { bucket: string; opl: string; shelved: boolean; offTruck: boolean; deliveryDate: string }[];
};

/** A dispatched trip from this farm and each bucket it carried: shelved at the hub yet? */
export type ShelvedTrip = {
  tripId: string;
  vehicle: string;
  status: string;
  tripDate: string;
  dispatchedAt: string;
  arrivedAt: string;
  receivedAt: string;
  total: number;
  shelved: number;
  buckets: {
    bucketId: string;
    opl: string;
    orderName: string;
    customer: string;
    shelved: boolean;
    shelf: string;
    shelvedAt: string;
  }[];
};

export type FetchAllocationsOutcome =
  | { kind: 'ok'; items: AllocationItem[]; vehicles: string[] }
  | { kind: 'error'; message: string };

export type FetchPlannedTripsOutcome =
  | {
      kind: 'ok';
      trips: PlannedTrip[];
      schedules: OplSchedule[];
      oplStates: Record<string, OplServerState>;
      /** Device orders the server still has rows for at this farm; null when it didn't say. */
      known: string[] | null;
    }
  | { kind: 'error'; message: string };

/** An order's Packhouse Schedule slot (team + position in that team's run). */
/** Where an order's buckets from this farm are on the server. */
export type OplServerState = 'waiting' | 'loaded' | 'transit' | 'arrived';

/** A shelved bucket that can stand in for a missing requested one. */
export type ReplacementCandidate = {
  bucketId: string;
  shelf: string;
  variety: string;
  stemLength: string;
  availableQty: number | null;
  harvestDate: string;
};

export type OplSchedule = { oplName: string; team: string; sequence: number; scheduled: boolean };

export type SaveTrolleyOutcome =
  | { kind: 'ok'; message: string }
  | { kind: 'error'; message: string };

export type LoadSavedOutcome =
  | { kind: 'ok'; trolleys: SavedTrolley[] }
  | { kind: 'error'; message: string };

export type DeleteTrolleysOutcome =
  | { kind: 'ok'; clearedCount: number; skippedLoaded: string[] }
  | { kind: 'error'; message: string };

function mapItem(r: RawAllocationItem): AllocationItem {
  return {
    bucketId: r.bucket_id ?? '',
    variety: r.item_code ?? '',
    varietyLabel: r.item_name || r.item_code || '',
    shelfLocation: r.shelf_location ?? '',
    stemLength: r.stem_length ?? '',
    qty: typeof r.qty === 'number' ? r.qty : Number(r.qty ?? 0) || 0,
    uom: r.uom ?? '',
    oplName: r.opl_name ?? '',
    customer: r.customer ?? '',
    consignee: r.consignee ?? '',
    orderName: r.order_name ?? '',
    harvestDate: r.harvest_date ?? '',
    harvestTime: r.harvest_time ?? '',
    allocatedDate: r.allocated_date ?? '',
    deliveryDate: r.delivery_date ?? '',
    salesOrder: r.sales_order ?? '',
    pickListItemId: r.pick_list_item_id ?? '',
    farm: r.farm || (r.warehouse ?? '').split(' ')[0] || '',
  };
}

function num(v: unknown): number {
  return typeof v === 'number' ? v : Number(v ?? 0) || 0;
}

function mapPlannedTripOrder(r: RawPlannedTripOrder): PlannedTripOrder {
  return {
    deliveryDate: r.delivery_date ?? '',
    opl: r.opl ?? '',
    orderName: r.order_name || r.opl || '',
    customer: r.customer ?? '',
    farm: r.farm ?? '',
    varieties: r.varieties ?? '',
    buckets: num(r.buckets),
    stems: num(r.stems),
    total: num(r.total),
    loaded: num(r.loaded),
    transit: num(r.transit),
    shelved: num(r.shelved),
  };
}

const STOP_STATUSES: StopStatus[] = ['waiting', 'loading', 'ready', 'transit', 'done'];
function asStopStatus(v: string | undefined): StopStatus {
  return STOP_STATUSES.includes(v as StopStatus) ? (v as StopStatus) : 'waiting';
}

function mapPlannedTripStop(r: RawPlannedTripStop): PlannedTripStop {
  return {
    farm: r.farm ?? '',
    stop: num(r.stop),
    isYou: !!r.is_you,
    planned: num(r.planned),
    total: num(r.total),
    awaiting: num(r.awaiting),
    loaded: num(r.loaded),
    transit: num(r.transit),
    shelved: num(r.shelved),
    doneCount: num(r.done_count),
    status: asStopStatus(r.status),
    delaying: !!r.delaying,
  };
}

function mapPlannedTrip(r: RawPlannedTrip): PlannedTrip {
  return {
    tripId: r.trip ?? '',
    vehicle: r.vehicle ?? '',
    tripDate: r.trip_date ?? '',
    status: r.status ?? 'Draft',
    confirmed: r.status === 'Scheduled',
    inTransit: !!r.in_transit,
    yourStop: num(r.your_stop),
    totalStops: num(r.total_stops),
    farmBuckets: num(r.farm_buckets),
    tripBuckets: num(r.trip_buckets),
    capacity: num(r.capacity),
    stops: (r.stops ?? []).map(mapPlannedTripStop),
    orders: (r.orders ?? []).map(mapPlannedTripOrder),
    run: num(r.run),
    runs: num(r.runs),
    runChain: r.run_chain ?? '',
    window: r.window ?? '',
    current: (r.run_state ?? 'current') !== 'later',
    afterRun: num(r.after_run),
    yourStopClosed: !!r.your_stop_closed,
    loadedBuckets: num(r.loaded_buckets),
  };
}

function mapSavedBucket(r: RawSavedTrolleyBucket): SavedTrolleyBucket {
  return {
    bucketId: r.bucket_id ?? '',
    variety: r.item_code ?? '',
    varietyLabel: r.item_name || r.item_code || '',
    shelfLocation: r.shelf_location ?? '',
    stemLength: r.stem_length ?? '',
    qty: typeof r.qty === 'number' ? r.qty : Number(r.qty ?? 0) || 0,
    uom: r.uom ?? '',
    oplName: r.opl_name ?? '',
    truck: r.truck ?? '',
  };
}

function mapTrolley(r: RawSavedTrolley): SavedTrolley {
  return {
    trolleyId: r.trolley_id ?? '',
    truckId: r.truck_id ?? '',
    buckets: (r.buckets ?? []).map(mapSavedBucket),
  };
}

export const karenBucketRequestsRepository = {
  /** Trolley QR shape: `{"<trolley_id>": "trolley"}`. */
  extractTrolleyIdFromScan(raw: string): string | null {
    const text = raw.trim();
    if (!text.startsWith('{') || !text.endsWith('}')) return null;
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === 'object') {
        const entry = Object.entries(parsed as Record<string, unknown>).find(
          ([, v]) => v === 'trolley',
        );
        return entry ? entry[0] : null;
      }
      return null;
    } catch {
      return null;
    }
  },

  /** Bucket QR shape: `{"<bucket_id>": "bucket"}`. */
  extractBucketIdFromScan(raw: string): string | null {
    const text = raw.trim();
    if (!text.startsWith('{') || !text.endsWith('}')) return null;
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === 'object') {
        const entry = Object.entries(parsed as Record<string, unknown>).find(
          ([, v]) => v === 'bucket',
        );
        return entry ? entry[0] : null;
      }
      return null;
    } catch {
      return null;
    }
  },

  async fetchAllocations(farm: string, fromDate?: string, toDate?: string): Promise<FetchAllocationsOutcome> {
    const raw = await karenBucketRequestsApi.fetchAllocatedBuckets(farm, fromDate, toDate);
    if (raw.http_status_code && raw.http_status_code >= 400) {
      return {
        kind: 'error',
        message: raw.error || raw.message || 'Failed to load pick list.',
      };
    }
    return {
      kind: 'ok',
      items: (raw.data ?? []).map(mapItem),
      vehicles: raw.vehicles ?? [],
    };
  },

  /** Upcoming planned trips coming to collect from `farm`. */
  async fetchPlannedTrips(farm: string, opls: string[] = []): Promise<FetchPlannedTripsOutcome> {
    const raw = await karenBucketRequestsApi.getFarmPlannedTrips(farm, opls);
    const m = raw.message ?? {};
    if (m.status === 'success') {
      return {
        kind: 'ok',
        trips: (m.data ?? []).map(mapPlannedTrip),
        schedules: Object.entries(m.schedules ?? {}).map(([oplName, v]) => ({
          oplName,
          team: v?.team ?? '',
          sequence: num(v?.schedule),
          scheduled: !!v?.scheduled,
        })),
        oplStates: Object.fromEntries(
          Object.entries(m.opl_states ?? {}).filter(([, v]) =>
            ['waiting', 'loaded', 'transit', 'arrived'].includes(v as string),
          ),
        ) as Record<string, OplServerState>,
        known: m.opl_states ? Object.keys(m.opl_states) : null,
      };
    }
    return { kind: 'error', message: m.message ?? 'Failed to load planned trips.' };
  },

  async saveTrolley(args: {
    trolleyId: string;
    buckets: { oplName: string; bucketId: string }[];
  }): Promise<SaveTrolleyOutcome> {
    const raw = await karenBucketRequestsApi.saveTrolleyData({
      trolley_id: args.trolleyId,
      buckets: args.buckets.map((b) => ({
        opl_name: b.oplName,
        bucket_id: b.bucketId,
      })),
    });
    const m = raw.message ?? {};
    if (m.status === 'success') {
      return { kind: 'ok', message: m.message ?? 'Saved.' };
    }
    return { kind: 'error', message: m.message ?? 'Save failed.' };
  },

  async loadSavedTrolleys(farm: string): Promise<LoadSavedOutcome> {
    const raw = await karenBucketRequestsApi.getSavedTrolleys(farm);
    const m = raw.message ?? {};
    if (m.status === 'success') {
      return { kind: 'ok', trolleys: (m.data ?? []).map(mapTrolley) };
    }
    return {
      kind: 'error',
      message: m.message ?? 'Failed to load saved trolleys.',
    };
  },

  async loadTrolleyInTruck(args: {
    trolleyId: string;
    truckId: string;
  }): Promise<SaveTrolleyOutcome> {
    const raw = await karenBucketRequestsApi.loadTrolleyInTruck({
      trolley_id: args.trolleyId,
      truck_id: args.truckId,
    });
    const m = raw.message ?? {};
    if (m.status === 'success') {
      return { kind: 'ok', message: m.message ?? 'Loaded.' };
    }
    return { kind: 'error', message: m.message ?? 'Load failed.' };
  },

  /** Move a planned trip to another truck (the planned pick-up truck didn't come). */
  async changeTripVehicle(args: { tripId: string; vehicle: string }): Promise<SaveTrolleyOutcome> {
    const raw = await karenBucketRequestsApi.changeTripVehicle({ name: args.tripId, vehicle: args.vehicle });
    const m = raw.message ?? {};
    if (m.status === 'success') return { kind: 'ok', message: m.message ?? `Trip moved to ${args.vehicle}.` };
    return { kind: 'error', message: m.message ?? 'Could not change the truck.' };
  },

  /** Trucks for the Load-to-truck picker (Vehicle, custom_dispatch_truck = 0). */
  async fetchDispatchTrucks(): Promise<
    { kind: 'ok'; trucks: { name: string; licensePlate: string }[] } | { kind: 'error'; message: string }
  > {
    const raw = await karenBucketRequestsApi.getDispatchTrucks();
    const m = raw.message ?? {};
    if (m.status === 'success') {
      return {
        kind: 'ok',
        trucks: (m.trucks ?? [])
          .filter((t) => !!t.name)
          .map((t) => ({ name: t.name as string, licensePlate: t.license_plate || (t.name as string) })),
      };
    }
    return { kind: 'error', message: m.message ?? 'Failed to load trucks.' };
  },

  async setOfflineTrolleyFlags(args: {
    pliIds: string[];
    flag: 'loaded' | 'transit';
    truck?: string;
  }): Promise<{ kind: 'ok'; updated: number } | { kind: 'error'; message: string }> {
    const raw = await karenBucketRequestsApi.setOfflineTrolleyFlags({
      pli_ids: args.pliIds,
      flag: args.flag,
      ...(args.truck ? { truck: args.truck } : {}),
    });
    const m = raw.message ?? {};
    if (m.status === 'success') return { kind: 'ok', updated: m.updated ?? 0 };
    return { kind: 'error', message: m.message ?? 'Sync failed.' };
  },

  async deleteSavedTrolleys(args: {
    trolleyIds: string[];
    farm: string;
  }): Promise<DeleteTrolleysOutcome> {
    const raw = await karenBucketRequestsApi.deleteSavedTrolleys({
      trolley_ids: args.trolleyIds.join('|~|'),
      farm: args.farm,
    });
    const m = raw.message ?? {};
    if (m.status === 'success') {
      return {
        kind: 'ok',
        clearedCount: m.cleared_count ?? 0,
        skippedLoaded: m.skipped_loaded ?? [],
      };
    }
    return { kind: 'error', message: m.message ?? 'Delete failed.' };
  },

  async findBucketReplacement(
    pickListItem: string,
  ): Promise<
    | { kind: 'ok'; neededQty: number | null; candidates: ReplacementCandidate[] }
    | { kind: 'error'; message: string }
  > {
    const raw = await karenBucketRequestsApi.findRequestedBucketReplacement(pickListItem);
    const m = raw.message ?? {};
    if (m.status === 'success' && m.found && m.new_bucket) {
      const toCandidate = (c: RawReplacementCandidate): ReplacementCandidate => ({
        bucketId: c.new_bucket ?? '',
        shelf: c.shelf ?? '',
        variety: c.variety ?? '',
        stemLength: c.stem_length ?? '',
        availableQty: typeof c.available_qty === 'number' ? c.available_qty : null,
        harvestDate: c.harvest_date ?? '',
      });
      // Older servers send only the best match at the top level.
      const list = m.candidates?.length ? m.candidates : [m];
      return {
        kind: 'ok',
        neededQty: typeof m.needed_qty === 'number' ? m.needed_qty : null,
        candidates: list.map(toCandidate).filter((c) => c.bucketId),
      };
    }
    // The server answered and nothing matches: no candidates (the screen then offers
    // "not found"), not an error.
    if (m.found === false) return { kind: 'ok', neededQty: typeof m.needed_qty === 'number' ? m.needed_qty : null, candidates: [] };
    return { kind: 'error', message: m.message ?? 'No replacement bucket found.' };
  },

  async bucketIssueInfo(pickListItem: string): Promise<BucketIssueInfo | { kind: 'error'; message: string }> {
    const raw = await karenBucketRequestsApi.requestedBucketIssueInfo(pickListItem);
    const m = raw.message ?? {};
    if (m.status !== 'success') return { kind: 'error', message: m.message ?? 'Could not check where it was issued.' };
    return {
      kind: 'ok',
      line: m.line ?? '',
      thisIssued: !!m.this_issued,
      sameLine: !!m.same_line,
      issuedTo: (m.issued_to ?? []).map((r) => ({
        opl: r.opl,
        orderName: r.order_name ?? r.opl,
        team: r.team ?? '',
        sameLine: !!r.same_line,
      })),
    };
  },

  async markBucketIssued(pickListItem: string): Promise<SaveTrolleyOutcome> {
    const raw = await karenBucketRequestsApi.markRequestedBucketIssued(pickListItem);
    const m = raw.message ?? {};
    if (m.status === 'success') return { kind: 'ok', message: m.message ?? 'Marked issued.' };
    return { kind: 'error', message: m.message ?? 'Could not mark it issued.' };
  },

  async markBucketNotFound(pickListItem: string, notes?: string): Promise<SaveTrolleyOutcome> {
    const raw = await karenBucketRequestsApi.markRequestedBucketNotFound({ pick_list_item: pickListItem, notes });
    const m = raw.message ?? {};
    if (m.status === 'success') return { kind: 'ok', message: m.message ?? 'Marked not found.' };
    return { kind: 'error', message: m.message ?? 'Could not mark it not found.' };
  },

  async fetchCompletedTrips(
    farm: string,
  ): Promise<{ kind: 'ok'; trips: CompletedTrip[] } | { kind: 'error'; message: string }> {
    const raw = await karenBucketRequestsApi.getFarmCompletedTrips(farm);
    const m = raw.message ?? {};
    if (m.status !== 'success') return { kind: 'error', message: m.message ?? 'Could not load completed trips.' };
    return {
      kind: 'ok',
      trips: (m.trips ?? []).map((t) => ({
        tripId: t.trip ?? '',
        vehicle: t.vehicle ?? '',
        tripDate: t.trip_date ?? '',
        status: t.status ?? '',
        run: t.run ?? 0,
        runs: t.runs ?? 0,
        runChain: t.run_chain ?? '',
        leftAt: t.left_at ?? '',
        planned: t.planned ?? 0,
        loaded: t.loaded ?? 0,
        leftBehind: t.left_behind ?? 0,
        carriedTo: t.carried_to ?? [],
        stopReopenable: !!t.stop_reopenable,
        arrived: !!t.arrived || !!t.arrived_at,
        orders: (t.orders ?? []).map((o) => ({
          opl: o.opl ?? '',
          deliveryDate: o.delivery_date ?? '',
          orderName: o.order_name ?? o.opl ?? '',
          customer: o.customer ?? '',
          varieties: o.varieties ?? '',
          buckets: o.buckets ?? 0,
          loaded: o.loaded ?? 0,
        })),
      })),
    };
  },

  async fetchShelvedBuckets(
    farm: string,
    deliveryDate?: string,
  ): Promise<{ kind: 'ok'; hub: string; trips: ShelvedTrip[] } | { kind: 'error'; message: string }> {
    const raw = await karenBucketRequestsApi.getFarmShelvedBuckets(farm, deliveryDate);
    const m = raw.message ?? {};
    if (m.status !== 'success') return { kind: 'error', message: m.message ?? 'Could not load shelved buckets.' };
    return {
      kind: 'ok',
      hub: m.hub || 'the packhouse',
      trips: (m.trips ?? []).map((t) => ({
        tripId: t.trip ?? '',
        vehicle: t.vehicle ?? '',
        status: t.status ?? '',
        tripDate: t.trip_date ?? '',
        dispatchedAt: t.dispatched_at ?? '',
        arrivedAt: t.arrived_at ?? '',
        receivedAt: t.received_at ?? '',
        total: t.total ?? 0,
        shelved: t.shelved ?? 0,
        buckets: (t.buckets ?? []).map((b) => ({
          bucketId: b.bucket ?? '',
          opl: b.opl ?? '',
          orderName: b.order_name ?? b.opl ?? '',
          customer: b.customer ?? '',
          shelved: !!b.shelved,
          shelf: b.shelf ?? '',
          shelvedAt: b.shelved_at ?? '',
        })),
      })),
    };
  },

  /** Arrival at the transfer hub for a dispatched trip (see the API). */
  async tripArrival(args: {
    tripId: string;
    farm: string;
    action: 'status' | 'arrive' | 'complete';
  }): Promise<{ kind: 'ok'; arrival: TripArrival } | { kind: 'error'; message: string; unshelved: string[] }> {
    const raw = await karenBucketRequestsApi.tripArrival({ name: args.tripId, farm: args.farm, action: args.action });
    const m = raw.message ?? {};
    if (m.status !== 'success') {
      return { kind: 'error', message: m.message ?? 'Could not update the trip.', unshelved: m.unshelved ?? [] };
    }
    return {
      kind: 'ok',
      arrival: {
        tripId: m.name ?? args.tripId,
        hub: m.hub || 'the packhouse',
        tripStatus: m.trip_status ?? '',
        arrivedAt: m.arrived_at ?? '',
        receivedAt: m.received_at ?? '',
        total: m.total ?? 0,
        shelved: m.shelved ?? 0,
        waiting: m.waiting ?? [],
        farmTotal: m.farm_total ?? 0,
        farmShelved: m.farm_shelved ?? 0,
        buckets: (m.buckets ?? []).map((b) => ({
          bucket: b.bucket ?? '',
          opl: b.opl ?? '',
          shelved: !!b.shelved,
          offTruck: !!b.off_truck,
          deliveryDate: b.delivery_date ?? '',
        })),
      },
    };
  },

  async reopenTripStop(args: { tripId: string; farm: string }): Promise<SaveTrolleyOutcome> {
    const raw = await karenBucketRequestsApi.reopenTripStop({ name: args.tripId, farm: args.farm });
    const m = raw.message ?? {};
    if (m.status === 'success') {
      const n = m.left_behind ?? 0;
      return {
        kind: 'ok',
        message:
          m.mode === 'stop'
            ? `Stop reopened — load the ${n} bucket${n === 1 ? '' : 's'} left behind onto ${args.tripId}.`
            : `${n} bucket${n === 1 ? '' : 's'} left behind moved to ${(m.trips ?? []).join(', ')}.`,
      };
    }
    return { kind: 'error', message: m.message ?? 'Could not reopen the trip.' };
  },

  async closeTripStop(args: { tripId: string; farm: string; reason?: string }): Promise<SaveTrolleyOutcome> {
    const raw = await karenBucketRequestsApi.closeTripStop({
      name: args.tripId,
      farm: args.farm,
      ...(args.reason ? { reason: args.reason } : {}),
    });
    const m = (raw.message ?? {}) as { status?: string; message?: string; trip_status?: string; heading_to?: string; left_behind?: number };
    if (m.status === 'success') {
      const where = m.trip_status === 'Dispatched' ? `dispatched to ${m.heading_to || 'the packhouse'}` : `heading to ${m.heading_to}`;
      return { kind: 'ok', message: `Stop closed — truck ${where}${m.left_behind ? ` · ${m.left_behind} left for the next trip` : ''}.` };
    }
    return { kind: 'error', message: m.message ?? 'Could not close the stop.' };
  },

  async replaceBucket(
    pickListItem: string,
    newBucketId: string,
    reason?: ReplaceReason,
    notes?: string,
  ): Promise<
    | { kind: 'ok'; newBucket: string; shelf: string; stemLength: string; message: string }
    | { kind: 'error'; message: string }
  > {
    const raw = await karenBucketRequestsApi.replaceRequestedBucket(pickListItem, newBucketId, reason, notes);
    const m = raw.message ?? {};
    if (m.status === 'success' && m.new_bucket) {
      return {
        kind: 'ok',
        newBucket: m.new_bucket,
        shelf: m.shelf ?? '',
        stemLength: m.stem_length ?? '',
        message: m.message ?? 'Replaced.',
      };
    }
    return { kind: 'error', message: m.message ?? 'Replace failed.' };
  },
};
