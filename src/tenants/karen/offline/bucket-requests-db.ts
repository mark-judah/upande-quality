import * as SQLite from 'expo-sqlite';
import type { AllocationItem } from '../repository/karen-bucket-requests-repository';

/** A bucket row as the offline UI consumes it. */
export type ReqBucket = {
  id: number;
  bucketId: string;
  variety: string;
  shelf: string;
  stemLength: string;
  qty: number;
  uom: string;
  scanned: boolean;
  trolleyId: string | null;
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

/** Trolley tab: a fully-scanned OPL + the trolley(s) it sits on. */
export type TrolleyOpl = {
  oplName: string;
  orderName: string;
  createdOn: string;
  customer: string;
  trolleys: string[];
  buckets: ReqBucket[];
};

export type ScanResult =
  | { ok: true; oplName: string; oplComplete: boolean; bucketId: string }
  | { ok: false; reason: 'not_found' | 'already'; message: string };

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
  farm TEXT, created_on TEXT, downloaded_at TEXT, total_buckets INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS bucket (
  id INTEGER PRIMARY KEY AUTOINCREMENT, opl_name TEXT NOT NULL, bucket_id TEXT NOT NULL,
  variety TEXT, shelf TEXT, stem_length TEXT, qty REAL, uom TEXT, pick_list_item_id TEXT,
  scanned INTEGER NOT NULL DEFAULT 0, trolley_id TEXT, scanned_at TEXT,
  UNIQUE(opl_name, bucket_id)
);
CREATE TABLE IF NOT EXISTS trolley (trolley_id TEXT PRIMARY KEY, created_at TEXT);
CREATE INDEX IF NOT EXISTS idx_bucket_opl ON bucket(opl_name);
CREATE INDEX IF NOT EXISTS idx_bucket_scan ON bucket(bucket_id, scanned);
`;

export async function initDb(): Promise<void> {
  const d = await db();
  await d.execAsync(DDL);
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
      skipped++;
      continue;
    }
    const head = rows[0];
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
          rows.length,
        ],
      );
      for (const r of rows) {
        await d.runAsync(
          'INSERT OR IGNORE INTO bucket (opl_name, bucket_id, variety, shelf, stem_length, qty, uom, pick_list_item_id, scanned) VALUES (?,?,?,?,?,?,?,?,0)',
          [
            oplName,
            r.bucketId,
            r.varietyLabel || r.variety || '',
            r.shelfLocation || '',
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
  stem_length: string | null;
  qty: number | null;
  uom: string | null;
  scanned: number;
  trolley_id: string | null;
};

function mapBucketRow(r: BucketRow): ReqBucket {
  return {
    id: r.id,
    bucketId: r.bucket_id,
    variety: r.variety || '',
    shelf: r.shelf || '',
    stemLength: r.stem_length || '',
    qty: r.qty || 0,
    uom: r.uom || '',
    scanned: r.scanned === 1,
    trolleyId: r.trolley_id || null,
  };
}

type OplRow = {
  opl_name: string;
  order_name: string | null;
  created_on: string | null;
  customer: string | null;
  total: number;
  scanned: number;
};

export async function listRequests(): Promise<OrderGroup[]> {
  const d = await db();
  const opls = await d.getAllAsync<OplRow>(`
    SELECT o.opl_name, o.order_name, o.created_on, o.customer, o.total_buckets AS total,
           (SELECT COUNT(*) FROM bucket b WHERE b.opl_name = o.opl_name AND b.scanned = 1) AS scanned
    FROM opl o
    ORDER BY o.order_name ASC, o.created_on ASC, o.opl_name ASC`);
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

export async function listTrolley(): Promise<TrolleyOpl[]> {
  const d = await db();
  const opls = await d.getAllAsync<OplRow>(`
    SELECT o.opl_name, o.order_name, o.created_on, o.customer, o.total_buckets AS total,
           (SELECT COUNT(*) FROM bucket b WHERE b.opl_name = o.opl_name AND b.scanned = 1) AS scanned
    FROM opl o ORDER BY o.created_on DESC, o.opl_name ASC`);
  const out: TrolleyOpl[] = [];
  for (const o of opls) {
    if (o.total <= 0 || o.scanned < o.total) continue; // only fully scanned
    const brows = await d.getAllAsync<BucketRow>(
      'SELECT * FROM bucket WHERE opl_name = ? ORDER BY id ASC',
      [o.opl_name],
    );
    const trolleys = Array.from(
      new Set(brows.map((b) => b.trolley_id).filter((t): t is string => !!t)),
    );
    out.push({
      oplName: o.opl_name,
      orderName: o.order_name || o.opl_name,
      createdOn: o.created_on || '',
      customer: o.customer || '',
      trolleys,
      buckets: brows.map(mapBucketRow),
    });
  }
  return out;
}

export async function counts(): Promise<{ requests: number; trolley: number }> {
  const d = await db();
  const rows = await d.getAllAsync<{ total: number; scanned: number }>(`
    SELECT o.total_buckets AS total,
      (SELECT COUNT(*) FROM bucket b WHERE b.opl_name = o.opl_name AND b.scanned = 1) AS scanned
    FROM opl o`);
  let requests = 0;
  let trolley = 0;
  for (const r of rows) {
    if (r.total > 0 && r.scanned >= r.total) trolley++;
    else requests++;
  }
  return { requests, trolley };
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
  await d.runAsync('UPDATE bucket SET scanned = 1, trolley_id = ?, scanned_at = ? WHERE id = ?', [
    trolleyId,
    new Date().toISOString(),
    row.id,
  ]);
  const tot = await d.getFirstAsync<{ total: number; scanned: number }>(
    `SELECT total_buckets AS total,
            (SELECT COUNT(*) FROM bucket b WHERE b.opl_name = ? AND b.scanned = 1) AS scanned
     FROM opl WHERE opl_name = ?`,
    [row.opl_name, row.opl_name],
  );
  const oplComplete = !!tot && tot.scanned >= tot.total;
  return { ok: true, oplName: row.opl_name, oplComplete, bucketId };
}

export async function clearAll(): Promise<void> {
  const d = await db();
  await d.execAsync('DELETE FROM bucket; DELETE FROM opl; DELETE FROM trolley;');
}
