import { AppState, type AppStateStatus } from 'react-native';
import { api } from '@/src/core/api/client';
import { collectTelemetry } from './collect';
import {
  initTelemetryDb,
  enqueue,
  dueRows,
  allRows,
  markSent,
  markFailed,
  type OutboxRow,
} from './telemetry-db';

const HOUR_MS = 3_600_000;
// Sentinel far-future retry time: after the +5/+10 windows are exhausted a row
// is parked here so timed flushes skip it — only a reopen flushAll() retries it.
const FAR_FUTURE = '2999-01-01T00:00:00.000Z';

let hourly: ReturnType<typeof setInterval> | null = null;
let retry5: ReturnType<typeof setTimeout> | null = null;
let retry10: ReturnType<typeof setTimeout> | null = null;
let appStateSub: { remove: () => void } | null = null;
let started = false;

async function sendRow(r: OutboxRow): Promise<boolean> {
  try {
    const res = await api<{ message?: { status?: string }; exc?: string }>({
      method: 'POST',
      url: '/api/method/upande_agriculture.mobile.api.reportDeviceTelemetry',
      data: { data: r.payload },
      validateStatus: () => true,
    });
    return res?.message?.status === 'success';
  } catch {
    return false;
  }
}

function nextRetryFor(attempts: number): string | null {
  if (attempts === 0) return new Date(Date.now() + 5 * 60_000).toISOString();
  if (attempts === 1) return new Date(Date.now() + 10 * 60_000).toISOString();
  return FAR_FUTURE; // give up on timed retries; wait for the next reopen
}

async function drain(rows: OutboxRow[]): Promise<void> {
  let anyFailed = false;
  for (const r of rows) {
    const ok = await sendRow(r);
    if (ok) {
      await markSent(r.id);
    } else {
      anyFailed = true;
      await markFailed(r.id, 'send failed', nextRetryFor(r.attempts));
    }
  }
  if (anyFailed) scheduleRetries();
}

function scheduleRetries(): void {
  if (retry5) clearTimeout(retry5);
  if (retry10) clearTimeout(retry10);
  retry5 = setTimeout(() => {
    flushDue().catch(() => {});
  }, 5 * 60_000);
  retry10 = setTimeout(() => {
    flushDue().catch(() => {});
  }, 15 * 60_000);
}

export async function flushDue(): Promise<void> {
  try {
    await drain(await dueRows());
  } catch (e) {
    console.warn('[telemetry] flushDue', e);
  }
}

export async function flushAll(): Promise<void> {
  try {
    await drain(await allRows());
  } catch (e) {
    console.warn('[telemetry] flushAll', e);
  }
}

async function hourlyTick(): Promise<void> {
  try {
    await enqueue(await collectTelemetry());
    await flushDue();
  } catch (e) {
    console.warn('[telemetry] tick', e);
  }
}

function onAppState(s: AppStateStatus): void {
  if (s === 'active') flushAll().catch(() => {});
}

export async function startTelemetry(): Promise<void> {
  if (started) return;
  started = true;
  try {
    await initTelemetryDb();
    await hourlyTick(); // collect + attempt immediately on launch
    await flushAll(); // drain any backlog from previous runs
    hourly = setInterval(() => {
      hourlyTick().catch(() => {});
    }, HOUR_MS);
    appStateSub = AppState.addEventListener('change', onAppState);
  } catch (e) {
    console.warn('[telemetry] start', e);
  }
}

export function stopTelemetry(): void {
  if (hourly) clearInterval(hourly);
  if (retry5) clearTimeout(retry5);
  if (retry10) clearTimeout(retry10);
  if (appStateSub) appStateSub.remove();
  hourly = null;
  retry5 = null;
  retry10 = null;
  appStateSub = null;
  started = false;
}
