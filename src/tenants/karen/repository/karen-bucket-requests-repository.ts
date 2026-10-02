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
export type ReplaceReason = 'Missing' | 'Damaged' | 'Wrong variety' | 'Other';
export const REPLACE_REASONS: ReplaceReason[] = ['Missing', 'Damaged', 'Wrong variety', 'Other'];

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

export type FetchAllocationsOutcome =
  | { kind: 'ok'; items: AllocationItem[]; vehicles: string[] }
  | { kind: 'error'; message: string };

export type FetchPlannedTripsOutcome =
  | { kind: 'ok'; trips: PlannedTrip[]; schedules: OplSchedule[]; oplStates: Record<string, OplServerState> }
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

  async markBucketNotFound(pickListItem: string, notes?: string): Promise<SaveTrolleyOutcome> {
    const raw = await karenBucketRequestsApi.markRequestedBucketNotFound({ pick_list_item: pickListItem, notes });
    const m = raw.message ?? {};
    if (m.status === 'success') return { kind: 'ok', message: m.message ?? 'Marked not found.' };
    return { kind: 'error', message: m.message ?? 'Could not mark it not found.' };
  },

  async closeTripStop(args: { tripId: string; farm: string }): Promise<SaveTrolleyOutcome> {
    const raw = await karenBucketRequestsApi.closeTripStop({ name: args.tripId, farm: args.farm });
    const m = (raw.message ?? {}) as { status?: string; message?: string; trip_status?: string; heading_to?: string; left_behind?: number };
    if (m.status === 'success') {
      const where = m.trip_status === 'Dispatched' ? `dispatched to ${m.heading_to || 'the packhouse'}` : `heading to ${m.heading_to}`;
      return { kind: 'ok', message: `Stop closed — truck ${where}${m.left_behind ? ` · ${m.left_behind} left for the next run` : ''}.` };
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
