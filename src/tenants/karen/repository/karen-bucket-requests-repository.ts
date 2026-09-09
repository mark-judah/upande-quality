import {
  karenBucketRequestsApi,
  type RawAllocationItem,
  type RawSavedTrolley,
  type RawSavedTrolleyBucket,
  type RawPlannedTrip,
  type RawPlannedTripOrder,
  type RawPlannedTripStop,
} from '../api/karen-bucket-requests-api';

/** Pick-list row as the UI consumes it (snake_case → camelCase, with a stable
 *  per-row key). */
export type AllocationItem = {
  bucketId: string;
  variety: string;
  varietyLabel: string;
  shelfLocation: string;
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
};

export type FetchAllocationsOutcome =
  | { kind: 'ok'; items: AllocationItem[]; vehicles: string[] }
  | { kind: 'error'; message: string };

export type FetchPlannedTripsOutcome =
  | { kind: 'ok'; trips: PlannedTrip[] }
  | { kind: 'error'; message: string };

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
    salesOrder: r.sales_order ?? '',
    pickListItemId: r.pick_list_item_id ?? '',
  };
}

function num(v: unknown): number {
  return typeof v === 'number' ? v : Number(v ?? 0) || 0;
}

function mapPlannedTripOrder(r: RawPlannedTripOrder): PlannedTripOrder {
  return {
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

  async fetchAllocations(farm: string): Promise<FetchAllocationsOutcome> {
    const raw = await karenBucketRequestsApi.fetchAllocatedBuckets(farm);
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
  async fetchPlannedTrips(farm: string): Promise<FetchPlannedTripsOutcome> {
    const raw = await karenBucketRequestsApi.getFarmPlannedTrips(farm);
    const m = raw.message ?? {};
    if (m.status === 'success') {
      return { kind: 'ok', trips: (m.data ?? []).map(mapPlannedTrip) };
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
};
