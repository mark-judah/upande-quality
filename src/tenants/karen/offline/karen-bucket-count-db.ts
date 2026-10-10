import * as SQLite from 'expo-sqlite';

/** A locally-queued bucket count scan, plus whatever the server resolved for
 *  it once synced. Scanning writes here instantly (no network) so counting a
 *  farm's empty buckets never waits on connectivity; `syncBucketCountScans`
 *  is the one thing that ever talks to the server, and only when the user
 *  asks it to. Mirrors karen-stock-take-db.ts. */
export type BucketCountScanRow = {
  id: number;
  farm: string;
  bucketId: string;
  location: string;
  scannedAt: string;
  synced: boolean;
  serverLocation: string | null;
  /** 'already_in_use' — the bucket's real status wasn't actually empty. */
  warning: string | null;
  syncError: string | null;
};

/** One bucket's result from a sync batch — mirrors the server's own
 *  per-bucket result shape (api/mobile/syncBucketCountScans). */
export type BucketCountSyncResult =
  | { bucketId: string; ok: true; location: string; warning?: string | null }
  | { bucketId: string; ok: false; message: string };

let _db: SQLite.SQLiteDatabase | null = null;

async function db(): Promise<SQLite.SQLiteDatabase> {
  if (_db) return _db;
  _db = await SQLite.openDatabaseAsync('karen_bucket_count.db');
  return _db;
}

const DDL = `
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS bucket_count_scan (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  farm TEXT NOT NULL,
  bucket_id TEXT NOT NULL,
  location TEXT NOT NULL,
  scanned_at TEXT NOT NULL,
  synced INTEGER NOT NULL DEFAULT 0,
  server_location TEXT,
  warning TEXT,
  sync_error TEXT,
  UNIQUE(farm, bucket_id)
);
CREATE INDEX IF NOT EXISTS idx_bucket_count_farm ON bucket_count_scan(farm);
CREATE INDEX IF NOT EXISTS idx_bucket_count_pending ON bucket_count_scan(farm, synced);
`;

export async function initBucketCountDb(): Promise<void> {
  const d = await db();
  await d.execAsync(DDL);
}

type Row = {
  id: number;
  farm: string;
  bucket_id: string;
  location: string;
  scanned_at: string;
  synced: number;
  server_location: string | null;
  warning: string | null;
  sync_error: string | null;
};

function mapRow(r: Row): BucketCountScanRow {
  return {
    id: r.id,
    farm: r.farm,
    bucketId: r.bucket_id,
    location: r.location,
    scannedAt: r.scanned_at,
    synced: r.synced === 1,
    serverLocation: r.server_location,
    warning: r.warning,
    syncError: r.sync_error,
  };
}

/** Record a scan instantly — no network. Unlike stock take, a bucket already
 *  counted today for this farm is NOT left alone: its location (and
 *  scanned_at) is updated in place and it is marked pending again, since a
 *  bucket can genuinely move between zones (Greenhouse -> Washing Area ->
 *  Packhouse) within the same day and the count should reflect wherever it
 *  was LAST seen. `moved` tells the caller which happened, so the UI can
 *  toast "moved to {location}" instead of a plain scan confirmation. */
export async function scanBucket(
  farm: string,
  bucketId: string,
  location: string,
): Promise<{ moved: boolean }> {
  const d = await db();
  const existing = await d.getFirstAsync<{ id: number; location: string }>(
    'SELECT id, location FROM bucket_count_scan WHERE farm = ? AND bucket_id = ?',
    [farm, bucketId],
  );
  const nowIso = new Date().toISOString();
  if (existing) {
    await d.runAsync(
      `UPDATE bucket_count_scan
       SET location = ?, scanned_at = ?, synced = 0, server_location = NULL, warning = NULL, sync_error = NULL
       WHERE farm = ? AND bucket_id = ?`,
      [location, nowIso, farm, bucketId],
    );
    return { moved: existing.location !== location };
  }
  await d.runAsync(
    'INSERT INTO bucket_count_scan (farm, bucket_id, location, scanned_at, synced) VALUES (?, ?, ?, ?, 0)',
    [farm, bucketId, location, nowIso],
  );
  return { moved: false };
}

/** Newest-first, for the on-screen running log. */
export async function listScans(farm: string): Promise<BucketCountScanRow[]> {
  const d = await db();
  const rows = await d.getAllAsync<Row>(
    'SELECT * FROM bucket_count_scan WHERE farm = ? ORDER BY id DESC',
    [farm],
  );
  return rows.map(mapRow);
}

export async function countPending(farm: string): Promise<number> {
  const d = await db();
  const row = await d.getFirstAsync<{ c: number }>(
    'SELECT COUNT(*) AS c FROM bucket_count_scan WHERE farm = ? AND synced = 0',
    [farm],
  );
  return row?.c ?? 0;
}

/** One sync chunk's worth of not-yet-synced scans, oldest first (so a long
 *  session syncs roughly in scan order). */
export async function getPendingBatch(
  farm: string,
  limit: number,
): Promise<{ bucketId: string; location: string; scannedAt: string }[]> {
  const d = await db();
  const rows = await d.getAllAsync<{ bucket_id: string; location: string; scanned_at: string }>(
    'SELECT bucket_id, location, scanned_at FROM bucket_count_scan WHERE farm = ? AND synced = 0 ORDER BY id ASC LIMIT ?',
    [farm, limit],
  );
  return rows.map((r) => ({ bucketId: r.bucket_id, location: r.location, scannedAt: r.scanned_at }));
}

/** Applies one chunk's results after a successful upload - each bucket
 *  either resolves (synced, with the server's data cached locally for
 *  display) or is marked synced-with-error (acknowledged by the server as
 *  unresolvable, e.g. an unrecognised bucket - not retried forever, but
 *  flagged so the operator can see it needs attention). */
export async function applySyncResults(
  farm: string,
  results: BucketCountSyncResult[],
): Promise<void> {
  const d = await db();
  await d.withTransactionAsync(async () => {
    for (const r of results) {
      if (r.ok) {
        await d.runAsync(
          `UPDATE bucket_count_scan
           SET synced = 1, sync_error = NULL, server_location = ?, warning = ?
           WHERE farm = ? AND bucket_id = ?`,
          [r.location, r.warning ?? null, farm, r.bucketId],
        );
      } else {
        await d.runAsync(
          `UPDATE bucket_count_scan SET synced = 1, sync_error = ? WHERE farm = ? AND bucket_id = ?`,
          [r.message, farm, r.bucketId],
        );
      }
    }
  });
}

export async function clearFarm(farm: string): Promise<void> {
  const d = await db();
  await d.runAsync('DELETE FROM bucket_count_scan WHERE farm = ?', [farm]);
}
