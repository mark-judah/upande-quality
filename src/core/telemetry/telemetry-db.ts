import * as SQLite from 'expo-sqlite';
import type { TelemetryPayload } from './collect';

export type OutboxRow = { id: number; payload: TelemetryPayload; attempts: number };

let _db: SQLite.SQLiteDatabase | null = null;
async function db(): Promise<SQLite.SQLiteDatabase> {
  if (_db) return _db;
  _db = await SQLite.openDatabaseAsync('telemetry.db');
  return _db;
}

export async function initTelemetryDb(): Promise<void> {
  const d = await db();
  await d.execAsync(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS outbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      next_retry_at TEXT,
      last_error TEXT
    );`);
}

export async function enqueue(p: TelemetryPayload): Promise<void> {
  const d = await db();
  await d.runAsync('INSERT INTO outbox (payload_json, created_at, attempts) VALUES (?,?,0)', [
    JSON.stringify(p),
    new Date().toISOString(),
  ]);
}

type RawRow = { id: number; payload_json: string; attempts: number };

function parse(rows: RawRow[]): OutboxRow[] {
  const out: OutboxRow[] = [];
  for (const r of rows) {
    try {
      out.push({ id: r.id, payload: JSON.parse(r.payload_json), attempts: r.attempts });
    } catch {
      /* skip corrupt row */
    }
  }
  return out;
}

export async function dueRows(): Promise<OutboxRow[]> {
  const d = await db();
  const now = new Date().toISOString();
  const rows = await d.getAllAsync<RawRow>(
    'SELECT id, payload_json, attempts FROM outbox WHERE next_retry_at IS NULL OR next_retry_at <= ? ORDER BY id ASC',
    [now],
  );
  return parse(rows);
}

export async function allRows(): Promise<OutboxRow[]> {
  const d = await db();
  const rows = await d.getAllAsync<RawRow>(
    'SELECT id, payload_json, attempts FROM outbox ORDER BY id ASC',
  );
  return parse(rows);
}

export async function markSent(id: number): Promise<void> {
  const d = await db();
  await d.runAsync('DELETE FROM outbox WHERE id = ?', [id]);
}

export async function markFailed(
  id: number,
  error: string,
  nextRetryAt: string | null,
): Promise<void> {
  const d = await db();
  await d.runAsync(
    'UPDATE outbox SET attempts = attempts + 1, last_error = ?, next_retry_at = ? WHERE id = ?',
    [error.slice(0, 300), nextRetryAt, id],
  );
}
