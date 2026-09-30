import * as SQLite from 'expo-sqlite';
import type {
  AllocationItem,
  OplSchedule,
  OplServerState,
  PlannedTrip,
} from '../repository/karen-bucket-requests-repository';

/** A bucket row as the offline UI consumes it. */
export type ReqBucket = {
  id: number;
  bucketId: string;
  variety: string;
  shelf: string;
  /** Remote farm the bucket is transferred from. */
  farm: string;
  stemLength: string;
  qty: number;
  uom: string;
  scanned: boolean;
  trolleyId: string | null;
  pliId: string | null;
};

/** An OPL with its buckets + scan progress. */
export type ReqOpl = {
  oplName: string;
  orderName: string;
  createdOn: string;
  customer: string;
  total: number;
  scanned: number;
  buckets: ReqBucket[];
};

/** Requests tab: OPLs grouped under their order name. */
export type OrderGroup = { orderName: string; opls: ReqOpl[] };

/** Trolley / In-Transit tab: a fully-scanned OPL + the trolley(s) it sits on. */
export type TrolleyOpl = {
  oplName: string;
  orderName: string;
  createdOn: string;
  customer: string;
  trolleys: string[];
  buckets: ReqBucket[];
  loadedToTruck: boolean;
  inTransit: boolean;
  /** Buckets are shelved at the packhouse. */
  arrived: boolean;
  /** Pick List Item names of this OPL's buckets — the sync target. */
  pliIds: string[];
};

export type ScanResult =
  | { ok: true; oplName: string; oplComplete: boolean; bucketId: string }
  | { ok: false; reason: 'not_found' | 'already'; message: string };

/** A dispatch/collection truck, cached offline so the Load-to-truck picker
 *  works without connectivity. `name` is the Vehicle docname (= license plate). */
export type Vehicle = { name: string; licensePlate: string };

let _db: SQLite.SQLiteDatabase | null = null;

async function db(): Promise<SQLite.SQLiteDatabase> {
  if (_db) return _db;
  _db = await SQLite.openDatabaseAsync('karen_bucket_requests.db');
  return _db;
}

const DDL = `
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS opl (
  opl_name TEXT PRIMARY KEY, order_name TEXT, customer TEXT, sales_order TEXT,
  farm TEXT, created_on TEXT, downloaded_at TEXT, total_buckets INTEGER NOT NULL DEFAULT 0,
  loaded_to_truck INTEGER NOT NULL DEFAULT 0, in_transit INTEGER NOT NULL DEFAULT 0,
  last_activity TEXT
);
CREATE TABLE IF NOT EXISTS bucket (
  id INTEGER PRIMARY KEY AUTOINCREMENT, opl_name TEXT NOT NULL, bucket_id TEXT NOT NULL,
  variety TEXT, shelf TEXT, stem_length TEXT, qty REAL, uom TEXT, pick_list_item_id TEXT,
  scanned INTEGER NOT NULL DEFAULT 0, trolley_id TEXT, scanned_at TEXT,
  UNIQUE(opl_name, bucket_id)
);
CREATE TABLE IF NOT EXISTS opl_schedule (opl_name TEXT PRIMARY KEY, team TEXT, sequence INTEGER NOT NULL DEFAULT 0, scheduled INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS trolley (trolley_id TEXT PRIMARY KEY, created_at TEXT);
CREATE TABLE IF NOT EXISTS vehicle (name TEXT PRIMARY KEY, license_plate TEXT);
CREATE TABLE IF NOT EXISTS planned_trip (
  trip_id TEXT PRIMARY KEY, trip_date TEXT, sort_key INTEGER NOT NULL DEFAULT 0,
  payload TEXT NOT NULL, fetched_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_bucket_opl ON bucket(opl_name);
CREATE INDEX IF NOT EXISTS idx_bucket_scan ON bucket(bucket_id, scanned);
`;

export async function initDb(): Promise<void> {
  const d = await db();
  await d.execAsync(DDL);
  // Migrate DBs created before the loaded/transit columns existed.
  const cols = await d.getAllAsync<{ name: string }>('PRAGMA table_info(opl)');
  const have = new Set(cols.map((c) => c.name));
  if (!have.has('loaded_to_truck')) {
    await d.execAsync('ALTER TABLE opl ADD COLUMN loaded_to_truck INTEGER NOT NULL DEFAULT 0');
  }
  if (!have.has('in_transit')) {
    await d.execAsync('ALTER TABLE opl ADD COLUMN in_transit INTEGER NOT NULL DEFAULT 0');
  }
  if (!have.has('last_activity')) {
    await d.execAsync('ALTER TABLE opl ADD COLUMN last_activity TEXT');
  }
  if (!have.has('arrived')) {
    await d.execAsync('ALTER TABLE opl ADD COLUMN arrived INTEGER NOT NULL DEFAULT 0');
  }
  const scols = await d.getAllAsync<{ name: string }>('PRAGMA table_info(opl_schedule)');
  if (!scols.some((c) => c.name === 'scheduled')) {
    await d.execAsync('ALTER TABLE opl_schedule ADD COLUMN scheduled INTEGER NOT NULL DEFAULT 1');
  }
  const bcols = await d.getAllAsync<{ name: string }>('PRAGMA table_info(bucket)');
  if (!bcols.some((c) => c.name === 'farm')) {
    await d.execAsync('ALTER TABLE bucket ADD COLUMN farm TEXT');
  }
}

/** Insert downloaded picklists, skipping any OPL already on device. */
export async function downloadOpls(
  items: AllocationItem[],
  farm: string,
): Promise<{ inserted: number; skipped: number }> {
  const d = await db();
  const groups = new Map<string, AllocationItem[]>();
  for (const it of items) {
    if (!it.oplName || !it.bucketId) continue;
    const arr = groups.get(it.oplName);
    if (arr) arr.push(it);
    else groups.set(it.oplName, [it]);
  }
  let inserted = 0;
  let skipped = 0;
  const now = new Date().toISOString();
  for (const [oplName, rows] of groups) {
    const existing = await d.getFirstAsync<{ c: number }>(
      'SELECT COUNT(*) AS c FROM opl WHERE opl_name = ?',
      [oplName],
    );
    if (existing && existing.c > 0) {
      // Already on device: only backfill the source farm on rows downloaded before it existed.
      for (const r of rows) {
        if (!r.farm) continue;
        await d.runAsync(
          "UPDATE bucket SET farm = ? WHERE opl_name = ? AND bucket_id = ? AND COALESCE(farm, '') = ''",
          [r.farm, oplName, r.bucketId],
        );
      }
      skipped++;
      continue;
    }
    const head = rows[0];
    // A bucket can appear on several rows of the same OPL (mixed-box / split
    // allocations). The bucket table is UNIQUE(opl_name, bucket_id), so it stores
    // one row per bucket — total must count DISTINCT buckets, else scanned can
    // never reach total and the OPL is stuck "incomplete".
    const distinctBuckets = new Set(rows.map((r) => r.bucketId)).size;
    await d.withTransactionAsync(async () => {
      await d.runAsync(
        'INSERT INTO opl (opl_name, order_name, customer, sales_order, farm, created_on, downloaded_at, total_buckets) VALUES (?,?,?,?,?,?,?,?)',
        [
          oplName,
          head.orderName || oplName,
          head.customer || '',
          head.salesOrder || '',
          farm || '',
          head.allocatedDate || '',
          now,
          distinctBuckets,
        ],
      );
      for (const r of rows) {
        await d.runAsync(
          'INSERT OR IGNORE INTO bucket (opl_name, bucket_id, variety, shelf, farm, stem_length, qty, uom, pick_list_item_id, scanned) VALUES (?,?,?,?,?,?,?,?,?,0)',
          [
            oplName,
            r.bucketId,
            r.varietyLabel || r.variety || '',
            r.shelfLocation || '',
            r.farm || '',
            r.stemLength || '',
            r.qty || 0,
            r.uom || '',
            r.pickListItemId || '',
          ],
        );
      }
    });
    inserted++;
  }
  return { inserted, skipped };
}

type BucketRow = {
  id: number;
  bucket_id: string;
  variety: string | null;
  shelf: string | null;
  farm: string | null;
  stem_length: string | null;
  qty: number | null;
  uom: string | null;
  scanned: number;
  trolley_id: string | null;
  pick_list_item_id: string | null;
};

function mapBucketRow(r: BucketRow): ReqBucket {
  return {
    id: r.id,
    bucketId: r.bucket_id,
    variety: r.variety || '',
    shelf: r.shelf || '',
    farm: r.farm || '',
    stemLength: r.stem_length || '',
    qty: r.qty || 0,
    uom: r.uom || '',
    scanned: r.scanned === 1,
    trolleyId: r.trolley_id || null,
    pliId: r.pick_list_item_id || null,
  };
}

type OplRow = {
  opl_name: string;
  order_name: string | null;
  created_on: string | null;
  customer: string | null;
  total: number;
  scanned: number;
  last_activity?: string | null;
};

export async function listRequests(): Promise<OrderGroup[]> {
  const d = await db();
  // Most-recently-scanned OPL first (the one the operator is processing now
  // jumps to the top), then the rest by order name / creation.
  const opls = await d.getAllAsync<OplRow>(`
    SELECT o.opl_name, o.order_name, o.created_on, o.customer, o.total_buckets AS total,
           o.last_activity AS last_activity,
           (SELECT COUNT(*) FROM bucket b WHERE b.opl_name = o.opl_name AND b.scanned = 1) AS scanned
    FROM opl o
    ORDER BY (o.last_activity IS NULL) ASC, o.last_activity DESC,
             o.order_name ASC, o.created_on ASC, o.opl_name ASC`);
  const groups = new Map<string, OrderGroup>();
  for (const o of opls) {
    if (o.scanned >= o.total) continue; // complete → Trolley tab
    const brows = await d.getAllAsync<BucketRow>(
      'SELECT * FROM bucket WHERE opl_name = ? ORDER BY scanned ASC, id ASC',
      [o.opl_name],
    );
    const opl: ReqOpl = {
      oplName: o.opl_name,
      orderName: o.order_name || o.opl_name,
      createdOn: o.created_on || '',
      customer: o.customer || '',
      total: o.total,
      scanned: o.scanned,
      buckets: brows.map(mapBucketRow),
    };
    const g = groups.get(opl.orderName);
    if (g) g.opls.push(opl);
    else groups.set(opl.orderName, { orderName: opl.orderName, opls: [opl] });
  }
  return Array.from(groups.values());
}

type CompletedRow = OplRow & { loaded_to_truck: number; in_transit: number; arrived: number };

/** Fully-scanned OPLs, filtered by their in_transit flag (0 = Trolley tab,
 *  1 = In Transit tab). */
async function listCompleted(inTransitValue: 0 | 1): Promise<TrolleyOpl[]> {
  const d = await db();
  const opls = await d.getAllAsync<CompletedRow>(`
    SELECT o.opl_name, o.order_name, o.created_on, o.customer, o.total_buckets AS total,
           o.loaded_to_truck, o.in_transit, o.arrived,
           (SELECT COUNT(*) FROM bucket b WHERE b.opl_name = o.opl_name AND b.scanned = 1) AS scanned
    FROM opl o ORDER BY o.created_on DESC, o.opl_name ASC`);
  const out: TrolleyOpl[] = [];
  for (const o of opls) {
    if (o.total <= 0 || o.scanned < o.total) continue; // only fully scanned
    if ((o.in_transit === 1 ? 1 : 0) !== inTransitValue) continue;
    const brows = await d.getAllAsync<BucketRow>(
      'SELECT * FROM bucket WHERE opl_name = ? ORDER BY id ASC',
      [o.opl_name],
    );
    const trolleys = Array.from(
      new Set(brows.map((b) => b.trolley_id).filter((t): t is string => !!t)),
    );
    const pliIds = Array.from(
      new Set(brows.map((b) => b.pick_list_item_id).filter((p): p is string => !!p)),
    );
    out.push({
      oplName: o.opl_name,
      orderName: o.order_name || o.opl_name,
      createdOn: o.created_on || '',
      customer: o.customer || '',
      trolleys,
      buckets: brows.map(mapBucketRow),
      loadedToTruck: o.loaded_to_truck === 1,
      inTransit: o.in_transit === 1,
      arrived: o.arrived === 1,
      pliIds,
    });
  }
  return out;
}

export async function listTrolley(): Promise<TrolleyOpl[]> {
  return listCompleted(0);
}

export async function listInTransit(): Promise<TrolleyOpl[]> {
  return listCompleted(1);
}

export async function listOplNames(): Promise<string[]> {
  const d = await db();
  const rows = await d.getAllAsync<{ opl_name: string }>('SELECT opl_name FROM opl');
  return rows.map((r) => r.opl_name);
}

/** Move orders forward to what the server says happened (another device loaded
 *  the truck, the truck left, the buckets were shelved). Never moves backwards. */
export async function applyServerStates(states: Record<string, OplServerState>): Promise<number> {
  const d = await db();
  const now = new Date().toISOString();
  let changed = 0;
  for (const [oplName, state] of Object.entries(states)) {
    if (state === 'waiting') continue;
    const cur = await d.getFirstAsync<{ loaded_to_truck: number; in_transit: number; arrived: number }>(
      'SELECT loaded_to_truck, in_transit, arrived FROM opl WHERE opl_name = ?',
      [oplName],
    );
    if (!cur) continue;
    const want = {
      loaded: 1,
      transit: state === 'transit' || state === 'arrived' ? 1 : 0,
      arrived: state === 'arrived' ? 1 : 0,
    };
    const unscanned = await d.getFirstAsync<{ c: number }>(
      'SELECT COUNT(*) AS c FROM bucket WHERE opl_name = ? AND scanned = 0',
      [oplName],
    );
    if (
      cur.loaded_to_truck >= want.loaded &&
      cur.in_transit >= want.transit &&
      cur.arrived >= want.arrived &&
      !unscanned?.c
    ) {
      continue;
    }
    await d.withTransactionAsync(async () => {
      await d.runAsync('UPDATE bucket SET scanned = 1, scanned_at = COALESCE(scanned_at, ?) WHERE opl_name = ? AND scanned = 0', [
        now,
        oplName,
      ]);
      await d.runAsync(
        'UPDATE opl SET loaded_to_truck = MAX(loaded_to_truck, ?), in_transit = MAX(in_transit, ?), arrived = MAX(arrived, ?), last_activity = ? WHERE opl_name = ?',
        [want.loaded, want.transit, want.arrived, now, oplName],
      );
    });
    changed++;
  }
  return changed;
}

/** Point a downloaded bucket row at its server-side replacement. */
export async function replaceBucketLocal(
  rowId: number,
  bucketId: string,
  shelf: string,
  stemLength: string,
): Promise<void> {
  const d = await db();
  await d.runAsync(
    'UPDATE bucket SET bucket_id = ?, shelf = ?, stem_length = COALESCE(NULLIF(?, \'\'), stem_length) WHERE id = ? AND scanned = 0',
    [bucketId, shelf, stemLength, rowId],
  );
}

/** Mark an OPL loaded-to-truck / in-transit locally (after server sync). */
export async function markLoadedLocal(oplName: string): Promise<void> {
  const d = await db();
  await d.runAsync('UPDATE opl SET loaded_to_truck = 1 WHERE opl_name = ?', [oplName]);
}
export async function markInTransitLocal(oplName: string): Promise<void> {
  const d = await db();
  await d.runAsync('UPDATE opl SET in_transit = 1 WHERE opl_name = ?', [oplName]);
}

export async function counts(): Promise<{ requests: number; trolley: number; inTransit: number }> {
  const d = await db();
  const rows = await d.getAllAsync<{ total: number; scanned: number; in_transit: number }>(`
    SELECT o.total_buckets AS total, o.in_transit,
      (SELECT COUNT(*) FROM bucket b WHERE b.opl_name = o.opl_name AND b.scanned = 1) AS scanned
    FROM opl o`);
  let requests = 0;
  let trolley = 0;
  let inTransit = 0;
  for (const r of rows) {
    const complete = r.total > 0 && r.scanned >= r.total;
    if (!complete) requests++;
    else if (r.in_transit === 1) inTransit++;
    else trolley++;
  }
  return { requests, trolley, inTransit };
}

export async function upsertTrolley(trolleyId: string): Promise<void> {
  const d = await db();
  await d.runAsync('INSERT OR IGNORE INTO trolley (trolley_id, created_at) VALUES (?, ?)', [
    trolleyId,
    new Date().toISOString(),
  ]);
}

export async function scanBucket(bucketId: string, trolleyId: string): Promise<ScanResult> {
  const d = await db();
  const lc = bucketId.trim().toLowerCase();
  const row = await d.getFirstAsync<{ id: number; opl_name: string }>(
    'SELECT id, opl_name FROM bucket WHERE LOWER(bucket_id) = ? AND scanned = 0 LIMIT 1',
    [lc],
  );
  if (!row) {
    const already = await d.getFirstAsync<{ trolley_id: string | null }>(
      'SELECT trolley_id FROM bucket WHERE LOWER(bucket_id) = ? AND scanned = 1 LIMIT 1',
      [lc],
    );
    if (already) {
      return {
        ok: false,
        reason: 'already',
        message: 'Already scanned' + (already.trolley_id ? ' (on ' + already.trolley_id + ')' : ''),
      };
    }
    return { ok: false, reason: 'not_found', message: 'Bucket not in downloaded picklists' };
  }
  const nowIso = new Date().toISOString();
  await d.runAsync('UPDATE bucket SET scanned = 1, trolley_id = ?, scanned_at = ? WHERE id = ?', [
    trolleyId,
    nowIso,
    row.id,
  ]);
  // Stamp the OPL as most-recently-touched so the request the operator is
  // actively scanning floats to the top of the Requests list.
  await d.runAsync('UPDATE opl SET last_activity = ? WHERE opl_name = ?', [nowIso, row.opl_name]);
  const tot = await d.getFirstAsync<{ total: number; scanned: number }>(
    `SELECT total_buckets AS total,
            (SELECT COUNT(*) FROM bucket b WHERE b.opl_name = ? AND b.scanned = 1) AS scanned
     FROM opl WHERE opl_name = ?`,
    [row.opl_name, row.opl_name],
  );
  const oplComplete = !!tot && tot.scanned >= tot.total;
  return { ok: true, oplName: row.opl_name, oplComplete, bucketId };
}

/** Replace the cached truck list wholesale (called after each download). */
export async function replaceVehicles(vehicles: Vehicle[]): Promise<void> {
  const d = await db();
  await d.withTransactionAsync(async () => {
    await d.runAsync('DELETE FROM vehicle');
    for (const v of vehicles) {
      if (!v.name) continue;
      await d.runAsync('INSERT OR REPLACE INTO vehicle (name, license_plate) VALUES (?, ?)', [
        v.name,
        v.licensePlate || '',
      ]);
    }
  });
}

export async function listVehicles(): Promise<Vehicle[]> {
  const d = await db();
  const rows = await d.getAllAsync<{ name: string; license_plate: string | null }>(
    'SELECT name, license_plate FROM vehicle ORDER BY name ASC',
  );
  return rows.map((r) => ({ name: r.name, licensePlate: r.license_plate || '' }));
}

/** Cache the latest planned-trips plan wholesale (called after each download),
 *  so the cold-store attendant still sees the last-known plan while offline.
 *  Trips are stored as JSON blobs keyed by trip id; order is preserved via a
 *  sort key (the server already returns them soonest-first). */
export async function replacePlannedTrips(trips: PlannedTrip[]): Promise<void> {
  const d = await db();
  const now = new Date().toISOString();
  await d.withTransactionAsync(async () => {
    await d.runAsync('DELETE FROM planned_trip');
    for (let i = 0; i < trips.length; i++) {
      const t = trips[i];
      if (!t.tripId) continue;
      await d.runAsync(
        'INSERT OR REPLACE INTO planned_trip (trip_id, trip_date, sort_key, payload, fetched_at) VALUES (?, ?, ?, ?, ?)',
        [t.tripId, t.tripDate || '', i, JSON.stringify(t), now],
      );
    }
  });
}

export async function replaceSchedules(schedules: OplSchedule[]): Promise<void> {
  const d = await db();
  await d.withTransactionAsync(async () => {
    await d.runAsync('DELETE FROM opl_schedule');
    for (const sc of schedules) {
      if (!sc.oplName) continue;
      await d.runAsync(
        'INSERT OR REPLACE INTO opl_schedule (opl_name, team, sequence, scheduled) VALUES (?, ?, ?, ?)',
        [sc.oplName, sc.team, sc.sequence, sc.scheduled ? 1 : 0],
      );
    }
  });
}

export async function listSchedules(): Promise<OplSchedule[]> {
  const d = await db();
  const rows = await d.getAllAsync<{ opl_name: string; team: string | null; sequence: number; scheduled: number }>(
    'SELECT opl_name, team, sequence, scheduled FROM opl_schedule',
  );
  return rows.map((r) => ({
    oplName: r.opl_name,
    team: r.team || '',
    sequence: r.sequence || 0,
    scheduled: r.scheduled === 1,
  }));
}

export async function listPlannedTrips(): Promise<PlannedTrip[]> {
  const d = await db();
  const rows = await d.getAllAsync<{ payload: string }>(
    'SELECT payload FROM planned_trip ORDER BY sort_key ASC',
  );
  const out: PlannedTrip[] = [];
  for (const r of rows) {
    try {
      out.push(JSON.parse(r.payload) as PlannedTrip);
    } catch {
      /* skip a corrupt cache row */
    }
  }
  return out;
}

export async function clearAll(): Promise<void> {
  const d = await db();
  await d.execAsync(
    'DELETE FROM bucket; DELETE FROM opl; DELETE FROM trolley; DELETE FROM vehicle; DELETE FROM planned_trip; DELETE FROM opl_schedule;',
  );
}
