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
  /** Not in the cold room and nothing to replace it: counts as done for the order but
   *  never goes on a trolley or truck. */
  notFound: boolean;
  trolleyId: string | null;
  pliId: string | null;
  /** A quality-issue replacement the packhouse needs on the next truck. */
  asap: boolean;
};

/** An OPL with its buckets + scan progress. */
export type ReqOpl = {
  oplName: string;
  orderName: string;
  createdOn: string;
  customer: string;
  total: number;
  scanned: number;
  /** Unscanned ASAP buckets: the order goes to the top of the list. */
  asap: number;
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


/** The station's farm. Every list, count and scan only sees this farm's buckets, so a
 *  device set up for one farm never shows (or loads) another farm's transfers — also when
 *  one order collects from several farms. Rows saved before the farm was recorded ('')
 *  stay visible. Unset ('') = no filter. */
let _farm = '';
export function setActiveFarm(farm: string): void {
  _farm = (farm || '').trim();
}
/** Local YYYY-MM-DD, `addDays` from today. */
export function isoDay(addDays = 0): string {
  const dt = new Date();
  dt.setDate(dt.getDate() + addDays);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

/** Delivery-date filter (YYYY-MM-DD); '' = every date. Opens on tomorrow's orders. */
let _deliveryDate = isoDay(1);
export function setActiveDeliveryDate(date: string): void {
  _deliveryDate = (date || '').trim();
}
/** SQL condition on opl alias `o` for the active delivery date, plus its two arguments.
 *  An order without a delivery date shows under every date, so it never goes missing. */
function dateCond(): [string, string[]] {
  return ["(? = '' OR COALESCE(o.delivery_date, '') IN (?, ''))", [_deliveryDate, _deliveryDate]];
}
/** Delivery dates of this farm's orders on the device, soonest first. */
export async function listDeliveryDates(): Promise<string[]> {
  const d = await db();
  const [fc, fa] = farmCond();
  const rows = await d.getAllAsync<{ dd: string }>(
    `SELECT DISTINCT o.delivery_date AS dd FROM opl o
     WHERE COALESCE(o.delivery_date, '') != ''
       AND EXISTS (SELECT 1 FROM bucket b WHERE b.opl_name = o.opl_name AND ${fc})
     ORDER BY o.delivery_date`,
    fa,
  );
  return rows.map((r) => r.dd);
}
/** SQL condition on bucket alias `b` for the active farm, plus its two arguments. */
function farmCond(): [string, string[]] {
  return ["(? = '' OR COALESCE(b.farm, '') IN (?, ''))", [_farm, _farm]];
}

/** One connection for the whole app, kept on globalThis: a hot reload re-runs this
 *  module, and a second openDatabaseAsync left code still holding the old module on a
 *  connection native code had released ("NativeDatabase.prepareAsync … NullPointerException"). */
type DbCache = { conn: Promise<SQLite.SQLiteDatabase> | null; queue?: Promise<unknown> };
const G = globalThis as unknown as { __karenBucketRequestsDb?: DbCache };
const cache: DbCache = (G.__karenBucketRequestsDb ??= { conn: null });
// Per module instance, so a hot reload that adds a column still migrates.
let _migrated: Promise<void> | null = null;

function open(): Promise<SQLite.SQLiteDatabase> {
  if (!cache.conn) {
    cache.conn = SQLite.openDatabaseAsync('karen_bucket_requests.db').catch((e) => {
      cache.conn = null;
      throw e;
    });
  }
  return cache.conn;
}

/** A released native connection: reopen and retry once instead of failing the screen. */
const isDeadConnection = (e: unknown) => /NullPointerException|has been rejected|database is closed/i.test(String((e as Error)?.message ?? e));

function guarded(d: SQLite.SQLiteDatabase, conn: Promise<SQLite.SQLiteDatabase>): SQLite.SQLiteDatabase {
  return new Proxy(d, {
    get(target, prop, receiver) {
      const v = Reflect.get(target, prop, receiver);
      if (typeof v !== 'function') return v;
      if (typeof prop !== 'string' || !prop.endsWith('Async')) return v.bind(target);
      return async (...args: unknown[]) => {
        try {
          return await v.apply(target, args);
        } catch (e) {
          if (!isDeadConnection(e)) throw e;
          // Several queries fail together on one dead connection: only the first
          // drops it, the rest reuse the reopened one instead of racing new opens.
          if (cache.conn === conn) {
            cache.conn = null;
            _migrated = null;
          }
          const fresh = await db();
          return (fresh as unknown as Record<string, (...a: unknown[]) => unknown>)[prop](...args);
        }
      };
    },
  });
}

/** The database, with its schema brought up to date on first use. Migrating here (not
 *  only in initDb) means a hot reload that adds a column can't leave every query failing
 *  on the old table until the app is restarted. */
async function db(): Promise<SQLite.SQLiteDatabase> {
  const conn = open();
  const d = await conn;
  if (!_migrated) {
    // One migration at a time across module copies (each copy migrates once).
    const run = (cache.queue ?? Promise.resolve()).catch(() => {}).then(() => migrate(d));
    cache.queue = run;
    _migrated = run.catch((e) => {
      _migrated = null;
      throw e;
    });
  }
  await _migrated;
  return guarded(d, conn);
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
CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);
CREATE INDEX IF NOT EXISTS idx_bucket_opl ON bucket(opl_name);
CREATE INDEX IF NOT EXISTS idx_bucket_scan ON bucket(bucket_id, scanned);
`;

export async function initDb(): Promise<void> {
  await db();
}

/** ADD COLUMN that tolerates the column already being there (another copy of this
 *  module — a hot reload — may have just added it). */
async function addColumn(d: SQLite.SQLiteDatabase, sql: string): Promise<void> {
  try {
    await d.execAsync(sql);
  } catch (e) {
    if (!/duplicate column/i.test(String((e as Error)?.message ?? e))) throw e;
  }
}

async function migrate(d: SQLite.SQLiteDatabase): Promise<void> {
  await d.execAsync(DDL);
  // Migrate DBs created before the loaded/transit columns existed.
  const cols = await d.getAllAsync<{ name: string }>('PRAGMA table_info(opl)');
  const have = new Set(cols.map((c) => c.name));
  if (!have.has('loaded_to_truck')) {
    await addColumn(d, 'ALTER TABLE opl ADD COLUMN loaded_to_truck INTEGER NOT NULL DEFAULT 0');
  }
  if (!have.has('in_transit')) {
    await addColumn(d, 'ALTER TABLE opl ADD COLUMN in_transit INTEGER NOT NULL DEFAULT 0');
  }
  if (!have.has('last_activity')) {
    await addColumn(d, 'ALTER TABLE opl ADD COLUMN last_activity TEXT');
  }
  if (!have.has('arrived')) {
    await addColumn(d, 'ALTER TABLE opl ADD COLUMN arrived INTEGER NOT NULL DEFAULT 0');
  }
  if (!have.has('delivery_date')) {
    await addColumn(d, 'ALTER TABLE opl ADD COLUMN delivery_date TEXT');
  }
  const scols = await d.getAllAsync<{ name: string }>('PRAGMA table_info(opl_schedule)');
  if (!scols.some((c) => c.name === 'scheduled')) {
    await addColumn(d, 'ALTER TABLE opl_schedule ADD COLUMN scheduled INTEGER NOT NULL DEFAULT 1');
  }
  const bcols = await d.getAllAsync<{ name: string }>('PRAGMA table_info(bucket)');
  if (!bcols.some((c) => c.name === 'farm')) {
    await addColumn(d, 'ALTER TABLE bucket ADD COLUMN farm TEXT');
  }
  if (!bcols.some((c) => c.name === 'priority')) {
    await addColumn(d, 'ALTER TABLE bucket ADD COLUMN priority TEXT');
  }
  if (!bcols.some((c) => c.name === 'not_found')) {
    await addColumn(d, 'ALTER TABLE bucket ADD COLUMN not_found INTEGER NOT NULL DEFAULT 0');
  }
  // Truck state per bucket: an order collecting from two farms moves on each farm's
  // part separately (the order-level flags put the second farm's bucket straight
  // into In Transit once the first farm's part was loaded).
  if (!bcols.some((c) => c.name === 'truck_loaded')) {
    await addColumn(d, 'ALTER TABLE bucket ADD COLUMN truck_loaded INTEGER NOT NULL DEFAULT 0');
  }
  if (!bcols.some((c) => c.name === 'truck_transit')) {
    await addColumn(d, 'ALTER TABLE bucket ADD COLUMN truck_transit INTEGER NOT NULL DEFAULT 0');
  }
  // Once: carry the old order-level truck state onto the buckets, so orders already
  // loaded / in transit stay there. Only for orders whose buckets on this device are
  // all one farm's — a two-farm order is left to the server's per-farm state (the
  // order-level flag is exactly what wrongly moved the second farm's part).
  const ver = await d.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  if ((ver?.user_version ?? 0) < 2) {
    const oneFarm = `opl_name IN (SELECT opl_name FROM bucket GROUP BY opl_name HAVING COUNT(DISTINCT COALESCE(farm, '')) = 1)`;
    await d.runAsync(
      `UPDATE bucket SET truck_loaded = 1 WHERE scanned = 1 AND not_found = 0 AND ${oneFarm}
         AND opl_name IN (SELECT opl_name FROM opl WHERE loaded_to_truck = 1 OR in_transit = 1)`,
    );
    await d.runAsync(
      `UPDATE bucket SET truck_transit = 1 WHERE scanned = 1 AND not_found = 0 AND ${oneFarm}
         AND opl_name IN (SELECT opl_name FROM opl WHERE in_transit = 1)`,
    );
    await d.execAsync('PRAGMA user_version = 2');
  }
}

/** One entry per bucket: the server sends a pick row per BOX, so a bucket packed into
 *  two boxes arrives twice. Stems add up; the variety and length stay as they are unless
 *  the bucket really holds several, then all of them are listed ("Moonwalk 52cm +
 *  Moonwalk 62cm") and the length column is left empty. Shelf, farm, uom and the pick row
 *  id come from the bucket's first row. */
function mergeBucketRows(rows: AllocationItem[]): AllocationItem[] {
  const byBucket = new Map<string, { head: AllocationItem; qty: number; parts: string[] }>();
  for (const r of rows) {
    const key = r.bucketId.toUpperCase();
    const label = r.varietyLabel || r.variety || '';
    const part = [label, r.stemLength || ''].filter(Boolean).join(' ');
    const m = byBucket.get(key);
    if (!m) {
      byBucket.set(key, { head: { ...r }, qty: r.qty || 0, parts: [part] });
      continue;
    }
    m.qty += r.qty || 0;
    if (r.asap) m.head.asap = true;
    if (!m.parts.includes(part)) m.parts.push(part);
  }
  return [...byBucket.values()].map(({ head, qty, parts }) =>
    parts.length > 1
      ? { ...head, qty, varietyLabel: parts.join(' + '), variety: parts.join(' + '), stemLength: '' }
      : { ...head, qty },
  );
}

/** Insert downloaded picklists; an OPL already on the device is refreshed from the
 *  server copy instead (`skipped` / `refreshedOpls`). */
export async function downloadOpls(
  items: AllocationItem[],
  farm: string,
): Promise<{ inserted: number; skipped: number; insertedOpls: string[]; refreshedOpls: string[] }> {
  const d = await db();
  const groups = new Map<string, AllocationItem[]>();
  for (const it of items) {
    if (!it.oplName || !it.bucketId) continue;
    const arr = groups.get(it.oplName);
    if (arr) arr.push(it);
    else groups.set(it.oplName, [it]);
  }
  const insertedOpls: string[] = [];
  const refreshedOpls: string[] = [];
  const now = new Date().toISOString();
  for (const [oplName, rows] of groups) {
    const existing = await d.getFirstAsync<{ c: number }>(
      'SELECT COUNT(*) AS c FROM opl WHERE opl_name = ?',
      [oplName],
    );
    if (existing && existing.c > 0) {
      // Already on device: backfill the source farm on rows downloaded before it
      // existed, and follow a server-side bucket replacement on unscanned rows.
      for (const r of rows) {
        if (r.pickListItemId) {
          await d.runAsync(
            "UPDATE OR IGNORE bucket SET bucket_id = ?, shelf = ?, stem_length = COALESCE(NULLIF(?, ''), stem_length) WHERE opl_name = ? AND pick_list_item_id = ? AND scanned = 0 AND bucket_id <> ?",
            [r.bucketId, r.shelfLocation || '', r.stemLength || '', oplName, r.pickListItemId, r.bucketId],
          );
        }
        if (!r.farm) continue;
        await d.runAsync(
          "UPDATE bucket SET farm = ? WHERE opl_name = ? AND bucket_id = ? AND COALESCE(farm, '') = ''",
          [r.farm, oplName, r.bucketId],
        );
      }
      // Re-download: the order's details follow the server too.
      const head = rows[0];
      await d.runAsync(
        `UPDATE opl SET order_name = COALESCE(NULLIF(?, ''), order_name), customer = COALESCE(NULLIF(?, ''), customer),
           sales_order = COALESCE(NULLIF(?, ''), sales_order), delivery_date = COALESCE(NULLIF(?, ''), delivery_date),
           downloaded_at = ? WHERE opl_name = ?`,
        [head.orderName || '', head.customer || '', head.salesOrder || '', head.deliveryDate || '', now, oplName],
      );
      // The order may also collect from another farm: add this farm's buckets of it,
      // and correct stems / contents saved from a single box row before.
      for (const r of mergeBucketRows(rows)) {
        await d.runAsync(
          `UPDATE bucket SET qty = ?, variety = ?, stem_length = ?,
             shelf = CASE WHEN scanned = 0 AND ? <> '' THEN ? ELSE shelf END,
             pick_list_item_id = COALESCE(NULLIF(?, ''), pick_list_item_id),
             priority = ?
           WHERE opl_name = ? AND UPPER(bucket_id) = ?`,
          [
            r.qty || 0,
            r.varietyLabel || r.variety || '',
            r.stemLength || '',
            r.shelfLocation || '',
            r.shelfLocation || '',
            r.pickListItemId || '',
            r.asap ? 'ASAP' : null,
            oplName,
            r.bucketId.toUpperCase(),
          ],
        );
        await d.runAsync(
          'INSERT OR IGNORE INTO bucket (opl_name, bucket_id, variety, shelf, farm, stem_length, qty, uom, pick_list_item_id, priority, scanned) VALUES (?,?,?,?,?,?,?,?,?,?,0)',
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
            r.asap ? 'ASAP' : null,
          ],
        );
      }
      // Drop this farm's unscanned buckets the server no longer lists for the order
      // (unallocated or moved since the last download), so the refreshed copy matches
      // the server instead of keeping buckets nobody will send. Rows saved before the
      // farm was recorded ('') may be another farm's and are left alone.
      if (farm) {
        const keep = [...new Set(rows.map((r) => r.bucketId.toUpperCase()))];
        await d.runAsync(
          `DELETE FROM bucket WHERE opl_name = ? AND scanned = 0 AND not_found = 0 AND farm = ?
             AND UPPER(bucket_id) NOT IN (${keep.map(() => '?').join(',')})`,
          [oplName, farm, ...keep],
        );
      }
      refreshedOpls.push(oplName);
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
        'INSERT INTO opl (opl_name, order_name, customer, sales_order, farm, created_on, downloaded_at, total_buckets, delivery_date) VALUES (?,?,?,?,?,?,?,?,?)',
        [
          oplName,
          head.orderName || oplName,
          head.customer || '',
          head.salesOrder || '',
          farm || '',
          head.allocatedDate || '',
          now,
          distinctBuckets,
          head.deliveryDate || '',
        ],
      );
      for (const r of mergeBucketRows(rows)) {
        await d.runAsync(
          'INSERT OR IGNORE INTO bucket (opl_name, bucket_id, variety, shelf, farm, stem_length, qty, uom, pick_list_item_id, priority, scanned) VALUES (?,?,?,?,?,?,?,?,?,?,0)',
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
            r.asap ? 'ASAP' : null,
          ],
        );
      }
    });
    insertedOpls.push(oplName);
  }
  return { inserted: insertedOpls.length, skipped: refreshedOpls.length, insertedOpls, refreshedOpls };
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
  not_found?: number | null;
  trolley_id: string | null;
  pick_list_item_id: string | null;
  priority?: string | null;
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
    notFound: r.not_found === 1,
    trolleyId: r.trolley_id || null,
    pliId: r.pick_list_item_id || null,
    asap: r.priority === 'ASAP',
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
  asap?: number | null;
};

export async function listRequests(): Promise<OrderGroup[]> {
  const d = await db();
  // Most-recently-scanned OPL first (the one the operator is processing now
  // jumps to the top), then the rest by order name / creation.
  const [fc, fa] = farmCond();
  const [dc, da] = dateCond();
  const opls = await d.getAllAsync<OplRow>(
    `
    SELECT o.opl_name, o.order_name, o.created_on, o.customer,
           (SELECT COUNT(*) FROM bucket b WHERE b.opl_name = o.opl_name AND ${fc}) AS total,
           o.last_activity AS last_activity,
           (SELECT COUNT(*) FROM bucket b WHERE b.opl_name = o.opl_name AND b.scanned = 1 AND ${fc}) AS scanned,
           (SELECT COUNT(*) FROM bucket b WHERE b.opl_name = o.opl_name AND b.scanned = 0
              AND b.priority = 'ASAP' AND ${fc}) AS asap
    FROM opl o
    WHERE EXISTS (SELECT 1 FROM bucket b WHERE b.opl_name = o.opl_name AND ${fc}) AND ${dc}
    ORDER BY (asap > 0) DESC, (o.last_activity IS NULL) ASC, o.last_activity DESC,
             o.order_name ASC, o.created_on ASC, o.opl_name ASC`,
    [...fa, ...fa, ...fa, ...fa, ...da],
  );
  const groups = new Map<string, OrderGroup>();
  for (const o of opls) {
    if (o.scanned >= o.total) continue; // complete → Trolley tab
    const brows = await d.getAllAsync<BucketRow>(
      `SELECT * FROM bucket b WHERE b.opl_name = ? AND ${fc}
       ORDER BY b.scanned ASC, (b.priority = 'ASAP') DESC, b.id ASC`,
      [o.opl_name, ...fa],
    );
    const opl: ReqOpl = {
      oplName: o.opl_name,
      orderName: o.order_name || o.opl_name,
      createdOn: o.created_on || '',
      customer: o.customer || '',
      total: o.total,
      scanned: o.scanned,
      asap: o.asap ?? 0,
      buckets: brows.map(mapBucketRow),
    };
    const g = groups.get(opl.orderName);
    if (g) g.opls.push(opl);
    else groups.set(opl.orderName, { orderName: opl.orderName, opls: [opl] });
  }
  return Array.from(groups.values());
}

type CompletedRow = OplRow & { loaded_to_truck: number; in_transit: number; arrived: number };

/** This farm's part of an order is on the truck / in transit when every one of its
 *  buckets (not-found ones aside) is — per bucket, so two farms of one order move on
 *  separately. Columns loaded_to_truck / in_transit for opl alias `o`; binds the farm
 *  condition's arguments twice. */
function truckState(fc: string): string {
  return `
  (SELECT CASE WHEN COUNT(*) > 0 AND MIN(b.truck_loaded) = 1 THEN 1 ELSE 0 END FROM bucket b
     WHERE b.opl_name = o.opl_name AND b.not_found = 0 AND ${fc}) AS loaded_to_truck,
  (SELECT CASE WHEN COUNT(*) > 0 AND MIN(b.truck_transit) = 1 THEN 1 ELSE 0 END FROM bucket b
     WHERE b.opl_name = o.opl_name AND b.not_found = 0 AND ${fc}) AS in_transit`;
}

/** Fully-scanned OPLs, filtered by their in_transit flag (0 = Trolley tab,
 *  1 = In Transit tab). */
async function listCompleted(inTransitValue: 0 | 1): Promise<TrolleyOpl[]> {
  const d = await db();
  const [fc, fa] = farmCond();
  const [dc, da] = dateCond();
  const opls = await d.getAllAsync<CompletedRow>(
    `
    SELECT o.opl_name, o.order_name, o.created_on, o.customer,
           (SELECT COUNT(*) FROM bucket b WHERE b.opl_name = o.opl_name AND ${fc}) AS total,
           ${truckState(fc)},
           o.arrived,
           (SELECT COUNT(*) FROM bucket b WHERE b.opl_name = o.opl_name AND b.scanned = 1 AND ${fc}) AS scanned
    FROM opl o WHERE ${dc} ORDER BY o.created_on DESC, o.opl_name ASC`,
    [...fa, ...fa, ...fa, ...fa, ...da],
  );
  const out: TrolleyOpl[] = [];
  for (const o of opls) {
    if (o.total <= 0 || o.scanned < o.total) continue; // only fully scanned
    if ((o.in_transit === 1 ? 1 : 0) !== inTransitValue) continue;
    const brows = await d.getAllAsync<BucketRow>(
      `SELECT * FROM bucket b WHERE b.opl_name = ? AND ${fc} ORDER BY b.id ASC`,
      [o.opl_name, ...fa],
    );
    const trolleys = Array.from(
      new Set(brows.map((b) => b.trolley_id).filter((t): t is string => !!t)),
    );
    // Not-found buckets are done for the order but are never loaded.
    const pliIds = Array.from(
      new Set(brows.filter((b) => b.not_found !== 1).map((b) => b.pick_list_item_id).filter((p): p is string => !!p)),
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

/** The store belongs to one server: signing in to another wipes what came from the
 *  old one (its orders, buckets and trips mean nothing there). Returns true when wiped. */
export async function matchServer(server: string): Promise<boolean> {
  if (!server) return false;
  const d = await db();
  const row = await d.getFirstAsync<{ v: string }>("SELECT v FROM meta WHERE k = 'server'");
  if (row?.v === server) return false;
  const wipe = !!row?.v;
  if (wipe) await clearAll();
  await d.runAsync("INSERT OR REPLACE INTO meta (k, v) VALUES ('server', ?)", [server]);
  return wipe;
}

/** Drop this farm's orders the server no longer knows (not waiting for transfer and
 *  no state for them): an order cancelled, re-allocated, or from another server. */
export async function pruneOpls(keep: Set<string>): Promise<number> {
  const local = await listOplNames();
  const gone = local.filter((o) => !keep.has(o));
  if (!gone.length) return 0;
  const d = await db();
  const [fc, fa] = farmCond();
  await d.withTransactionAsync(async () => {
    for (const o of gone) {
      await d.runAsync(`DELETE FROM bucket WHERE opl_name = ? AND ${fc.replace(/\bb\./g, '')}`, [o, ...fa]);
      const left = await d.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM bucket WHERE opl_name = ?', [o]);
      if (!left?.n) {
        await d.runAsync('DELETE FROM opl WHERE opl_name = ?', [o]);
        await d.runAsync('DELETE FROM opl_schedule WHERE opl_name = ?', [o]);
      }
    }
  });
  return gone.length;
}

export async function listOplNames(): Promise<string[]> {
  const d = await db();
  const [fc, fa] = farmCond();
  const rows = await d.getAllAsync<{ opl_name: string }>(
    `SELECT o.opl_name FROM opl o WHERE EXISTS (SELECT 1 FROM bucket b WHERE b.opl_name = o.opl_name AND ${fc})`,
    fa,
  );
  return rows.map((r) => r.opl_name);
}

/** Move orders forward to what the server says happened (another device loaded
 *  the truck, the truck left, the buckets were shelved). Never moves backwards. */
export async function applyServerStates(states: Record<string, OplServerState>): Promise<number> {
  const d = await db();
  const now = new Date().toISOString();
  const [fc, fa] = farmCond();
  let changed = 0;
  for (const [oplName, state] of Object.entries(states)) {
    if (state === 'waiting') continue;
    // Shelved at the packhouse: this farm is done with the order — drop its buckets
    // from the device (and the order once nothing of it is left), so finished
    // transfers don't sit in In Transit forever.
    if (state === 'arrived') {
      await d.withTransactionAsync(async () => {
        await d.runAsync(
          `DELETE FROM bucket WHERE id IN (SELECT b.id FROM bucket b WHERE b.opl_name = ? AND ${fc})`,
          [oplName, ...fa],
        );
        await d.runAsync(
          'DELETE FROM opl WHERE opl_name = ? AND NOT EXISTS (SELECT 1 FROM bucket WHERE bucket.opl_name = opl.opl_name)',
          [oplName],
        );
      });
      changed++;
      continue;
    }
    // This farm's part only: the server's state is for the farm asking.
    const cur = await d.getFirstAsync<{ loaded_to_truck: number; in_transit: number; arrived: number }>(
      `SELECT ${truckState(fc)}, o.arrived FROM opl o WHERE o.opl_name = ?`,
      [...fa, ...fa, oplName],
    );
    if (!cur) continue;
    // Loaded on the truck counts as in transit for the farm (it's off the farm's
    // hands), whether or not the truck has left yet.
    const want = {
      loaded: 1,
      transit: 1,
      arrived: 0, // arrived orders were removed above
    };
    const unscanned = await d.getFirstAsync<{ c: number }>(
      `SELECT COUNT(*) AS c FROM bucket b WHERE b.opl_name = ? AND b.scanned = 0 AND ${fc}`,
      [oplName, ...fa],
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
      await d.runAsync(
        `UPDATE bucket SET scanned = 1, scanned_at = COALESCE(scanned_at, ?)
         WHERE id IN (SELECT b.id FROM bucket b WHERE b.opl_name = ? AND b.scanned = 0 AND ${fc})`,
        [now, oplName, ...fa],
      );
      await d.runAsync(
        `UPDATE bucket SET truck_loaded = MAX(truck_loaded, ?), truck_transit = MAX(truck_transit, ?)
         WHERE id IN (SELECT b.id FROM bucket b WHERE b.opl_name = ? AND ${fc})`,
        [want.loaded, want.transit, oplName, ...fa],
      );
      await d.runAsync('UPDATE opl SET last_activity = ? WHERE opl_name = ?', [now, oplName]);
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
/** The server left this bucket out of the transfer (not found, no replacement): it is
 *  done for every order on the device waiting on it, without a trolley. */
export async function markNotFoundLocal(bucketId: string): Promise<void> {
  const d = await db();
  await d.runAsync(
    'UPDATE bucket SET scanned = 1, not_found = 1, trolley_id = NULL, scanned_at = COALESCE(scanned_at, ?) WHERE LOWER(bucket_id) = ? AND scanned = 0',
    [new Date().toISOString(), bucketId.trim().toLowerCase()],
  );
}

/** Issued offline to its own line: the request is done, nothing to scan or send. */
export async function removeIssuedLocal(rowId: number): Promise<void> {
  const d = await db();
  await d.runAsync('DELETE FROM bucket WHERE id = ? AND scanned = 0', [rowId]);
}

/** Loaded / in transit: this farm's scanned buckets of the order (an order collecting
 *  from two farms is loaded farm by farm). */
export async function markLoadedLocal(oplName: string): Promise<void> {
  const d = await db();
  const [fc, fa] = farmCond();
  await d.runAsync(
    `UPDATE bucket SET truck_loaded = 1 WHERE id IN (SELECT b.id FROM bucket b WHERE b.opl_name = ? AND b.scanned = 1 AND ${fc})`,
    [oplName, ...fa],
  );
}
export async function markInTransitLocal(oplName: string): Promise<void> {
  const d = await db();
  const [fc, fa] = farmCond();
  await d.runAsync(
    `UPDATE bucket SET truck_loaded = 1, truck_transit = 1 WHERE id IN (SELECT b.id FROM bucket b WHERE b.opl_name = ? AND b.scanned = 1 AND ${fc})`,
    [oplName, ...fa],
  );
}

/** Picklists per stage, and buckets: `scannedBuckets` of `totalBuckets` requested
 *  (the Trolley tab's "scanned/requested"). */
/** `onTrip`: the picklists on a planned trip. When given, only those count, plus any
 *  already moving (scanned or on a truck) — the same picklists the Requests tab lists. */
export async function counts(onTrip?: Set<string>): Promise<{
  requests: number;
  trolley: number;
  inTransit: number;
  scannedBuckets: number;
  totalBuckets: number;
  /** Every requested bucket, how many are on a trolley (or beyond), how many on a truck. */
  allBuckets: number;
  addedBuckets: number;
  transitBuckets: number;
}> {
  const d = await db();
  const [fc, fa] = farmCond();
  const [dc, da] = dateCond();
  const all = await d.getAllAsync<{
    opl_name: string;
    total: number;
    scanned: number;
    on_truck: number;
    in_transit: number;
  }>(
    `
    SELECT o.opl_name, (SELECT COUNT(*) FROM bucket b WHERE b.opl_name = o.opl_name AND ${fc}) AS total, ${truckState(fc)},
      (SELECT COUNT(*) FROM bucket b WHERE b.opl_name = o.opl_name AND b.scanned = 1 AND ${fc}) AS scanned,
      (SELECT COUNT(*) FROM bucket b WHERE b.opl_name = o.opl_name AND b.truck_transit = 1 AND ${fc}) AS on_truck
    FROM opl o
    WHERE EXISTS (SELECT 1 FROM bucket b WHERE b.opl_name = o.opl_name AND ${fc}) AND ${dc}`,
    [...fa, ...fa, ...fa, ...fa, ...fa, ...fa, ...da],
  );
  const rows = onTrip ? all.filter((r) => onTrip.has(r.opl_name) || r.scanned > 0 || r.in_transit === 1) : all;
  let requests = 0;
  let trolley = 0;
  let inTransit = 0;
  let scannedBuckets = 0;
  let totalBuckets = 0;
  let allBuckets = 0;
  let addedBuckets = 0;
  let transitBuckets = 0;
  for (const r of rows) {
    allBuckets += r.total;
    addedBuckets += r.scanned;
    // Buckets on a truck, counted bucket by bucket (a partly loaded order counts too).
    transitBuckets += r.on_truck;
    // Trolley is the stage before the truck: an order already loaded / on the
    // road counts under In Transit, not here.
    if (r.in_transit !== 1) {
      scannedBuckets += r.scanned;
      totalBuckets += r.total;
    }
    const complete = r.total > 0 && r.scanned >= r.total;
    if (!complete) requests++;
    else if (r.in_transit === 1) inTransit++;
    else trolley++;
  }
  return { requests, trolley, inTransit, scannedBuckets, totalBuckets, allBuckets, addedBuckets, transitBuckets };
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
  const [fc, fa] = farmCond();
  const row = await d.getFirstAsync<{ id: number; opl_name: string }>(
    `SELECT b.id, b.opl_name FROM bucket b WHERE LOWER(b.bucket_id) = ? AND b.scanned = 0 AND ${fc} LIMIT 1`,
    [lc, ...fa],
  );
  if (!row) {
    const already = await d.getFirstAsync<{ trolley_id: string | null }>(
      `SELECT b.trolley_id FROM bucket b WHERE LOWER(b.bucket_id) = ? AND b.scanned = 1 AND ${fc} LIMIT 1`,
      [lc, ...fa],
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
    `SELECT (SELECT COUNT(*) FROM bucket b WHERE b.opl_name = ? AND ${fc}) AS total,
            (SELECT COUNT(*) FROM bucket b WHERE b.opl_name = ? AND b.scanned = 1 AND ${fc}) AS scanned`,
    [row.opl_name, ...fa, row.opl_name, ...fa],
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
