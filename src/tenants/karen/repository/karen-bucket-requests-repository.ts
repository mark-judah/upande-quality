import {
  karenBucketRequestsApi,
  type RawAllocationItem,
  type RawSavedTrolley,
  type RawSavedTrolleyBucket,
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

export type FetchAllocationsOutcome =
  | { kind: 'ok'; items: AllocationItem[]; vehicles: string[] }
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

  async setOfflineTrolleyFlags(args: {
    pliIds: string[];
    flag: 'loaded' | 'transit';
  }): Promise<{ kind: 'ok'; updated: number } | { kind: 'error'; message: string }> {
    const raw = await karenBucketRequestsApi.setOfflineTrolleyFlags({
      pli_ids: args.pliIds,
      flag: args.flag,
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
