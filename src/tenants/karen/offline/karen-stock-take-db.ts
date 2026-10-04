import * as SQLite from 'expo-sqlite';

/** A locally-queued bucket scan, plus whatever the server resolved for it
 *  once synced. Scanning writes here instantly (no network) so walking a
 *  cold store scanning thousands of buckets never waits on connectivity;
 *  `syncStockTakeBuckets` is the only thing that ever talks to the server,
 *  and only when the user asks it to. */
export type StockTakeScanRow = {
  id: number;
  coldstore: string;
  bucketId: string;
  scannedAt: string;
  synced: boolean;
  serverStatus: 'Shelved' | 'Unshelved' | null;
  serverShelf: string | null;
  serverVariety: string | null;
  serverStemLength: string | null;
  /** Stems in the bucket (its shelf record, or its latest harvest entry). */
  serverQty: number | null;
  serverAgeDays: number | null;
  syncError: string | null;
};

/** One bucket's result from a sync batch — mirrors the server's own
 *  per-bucket result shape (api/mobile/syncStockTakeBuckets). */
export type StockTakeSyncResult =
  | {
      bucketId: string;
      ok: true;
      status: 'Shelved' | 'Unshelved';
      shelf: string | null;
      variety: string | null;
      stemLength: string | null;
      qty: number | null;
      ageDays: number | null;
    }
  | { bucketId: string; ok: false; message: string };

let _db: SQLite.SQLiteDatabase | null = null;

async function db(): Promise<SQLite.SQLiteDatabase> {
  if (_db) return _db;
  _db = await SQLite.openDatabaseAsync('karen_stock_take.db');
  return _db;
}

const DDL = `
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS stock_take_scan (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  coldstore TEXT NOT NULL,
  bucket_id TEXT NOT NULL,
  scanned_at TEXT NOT NULL,
  synced INTEGER NOT NULL DEFAULT 0,
  server_status TEXT,
  server_shelf TEXT,
  server_variety TEXT,
  server_stem_length TEXT,
  server_qty REAL,
  server_age_days INTEGER,
  sync_error TEXT,
  UNIQUE(coldstore, bucket_id)
);
CREATE INDEX IF NOT EXISTS idx_stock_take_coldstore ON stock_take_scan(coldstore);
CREATE INDEX IF NOT EXISTS idx_stock_take_pending ON stock_take_scan(coldstore, synced);
`;

export async function initStockTakeDb(): Promise<void> {
  const d = await db();
  await d.execAsync(DDL);
  // Phones that created the table before it had server_qty get the column added.
  const cols = await d.getAllAsync<{ name: string }>('PRAGMA table_info(stock_take_scan)');
  if (!cols.some((c) => c.name === 'server_qty')) {
    await d.execAsync('ALTER TABLE stock_take_scan ADD COLUMN server_qty REAL');
  }
}

type Row = {
  id: number;
  coldstore: string;
  bucket_id: string;
  scanned_at: string;
  synced: number;
  server_status: string | null;
  server_shelf: string | null;
  server_variety: string | null;
  server_stem_length: string | null;
  server_qty: number | null;
  server_age_days: number | null;
  sync_error: string | null;
};

function mapRow(r: Row): StockTakeScanRow {
  return {
    id: r.id,
    coldstore: r.coldstore,
    bucketId: r.bucket_id,
    scannedAt: r.scanned_at,
    synced: r.synced === 1,
    serverStatus: (r.server_status as 'Shelved' | 'Unshelved' | null) ?? null,
    serverShelf: r.server_shelf,
    serverVariety: r.server_variety,
    serverStemLength: r.server_stem_length,
    serverQty: r.server_qty ?? null,
    serverAgeDays: r.server_age_days,
    syncError: r.sync_error,
  };
}

/** Record a scan instantly — no network. A bucket already in today's list
 *  for this cold store (pending or already synced) is left exactly as it
 *  is — `alreadyScanned: true` tells the caller to alert instead, so a
 *  stray double-scan can never silently wipe out a bucket's already-synced
 *  result or bump it back to pending for no reason. */
export async function scanBucket(
  coldstore: string,
  bucketId: string,
): Promise<{ alreadyScanned: boolean }> {
  const d = await db();
  const existing = await d.getFirstAsync<{ id: number }>(
    'SELECT id FROM stock_take_scan WHERE coldstore = ? AND bucket_id = ?',
    [coldstore, bucketId],
  );
  if (existing) {
    return { alreadyScanned: true };
  }
  const nowIso = new Date().toISOString();
  await d.runAsync(
    'INSERT INTO stock_take_scan (coldstore, bucket_id, scanned_at, synced) VALUES (?, ?, ?, 0)',
    [coldstore, bucketId, nowIso],
  );
  return { alreadyScanned: false };
}

/** Newest-first, for the on-screen running log. */
export async function listScans(coldstore: string): Promise<StockTakeScanRow[]> {
  const d = await db();
  const rows = await d.getAllAsync<Row>(
    'SELECT * FROM stock_take_scan WHERE coldstore = ? ORDER BY id DESC',
    [coldstore],
  );
  return rows.map(mapRow);
}

export async function countPending(coldstore: string): Promise<number> {
  const d = await db();
  const row = await d.getFirstAsync<{ c: number }>(
    'SELECT COUNT(*) AS c FROM stock_take_scan WHERE coldstore = ? AND synced = 0',
    [coldstore],
  );
  return row?.c ?? 0;
}

/** One sync chunk's worth of not-yet-synced scans, oldest first (so a long
 *  session syncs roughly in scan order). */
export async function getPendingBatch(
  coldstore: string,
  limit: number,
): Promise<{ bucketId: string; scannedAt: string }[]> {
  const d = await db();
  const rows = await d.getAllAsync<{ bucket_id: string; scanned_at: string }>(
    'SELECT bucket_id, scanned_at FROM stock_take_scan WHERE coldstore = ? AND synced = 0 ORDER BY id ASC LIMIT ?',
    [coldstore, limit],
  );
  return rows.map((r) => ({ bucketId: r.bucket_id, scannedAt: r.scanned_at }));
}

/** Applies one chunk's results after a successful upload - each bucket
 *  either resolves (synced, with the server's data cached locally for
 *  display) or is marked synced-with-error (acknowledged by the server as
 *  unresolvable, e.g. an unrecognised bucket - not retried forever, but
 *  flagged so the operator can see it needs attention). */
export async function applySyncResults(
  coldstore: string,
  results: StockTakeSyncResult[],
): Promise<void> {
  const d = await db();
  await d.withTransactionAsync(async () => {
    for (const r of results) {
      if (r.ok) {
        await d.runAsync(
          `UPDATE stock_take_scan
           SET synced = 1, sync_error = NULL, server_status = ?, server_shelf = ?,
               server_variety = ?, server_stem_length = ?, server_qty = ?, server_age_days = ?
           WHERE coldstore = ? AND bucket_id = ?`,
          [r.status, r.shelf, r.variety, r.stemLength, r.qty, r.ageDays, coldstore, r.bucketId],
        );
      } else {
        await d.runAsync(
          `UPDATE stock_take_scan SET synced = 1, sync_error = ? WHERE coldstore = ? AND bucket_id = ?`,
          [r.message, coldstore, r.bucketId],
        );
      }
    }
  });
}

export async function clearColdstore(coldstore: string): Promise<void> {
  const d = await db();
  await d.runAsync('DELETE FROM stock_take_scan WHERE coldstore = ?', [coldstore]);
}
