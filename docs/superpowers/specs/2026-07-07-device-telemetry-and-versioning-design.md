# Device Telemetry, App Versioning & IT-Dashboard Presentation

**Date:** 2026-07-07
**Status:** Design — approved (user said "proceed with the build")
**Area:** Expo app (`src/core/`, `app/`) + Frappe (`it-dashboard`, new endpoint + doctype)

## 1. Goal

1. **App version visibility** — show the actual running code identity (expo-updates OTA
   update) in the app.
2. **Device telemetry** — collect device stats hourly, queue in expo-sqlite, transmit to a
   new Frappe endpoint, retry silently, survive offline/restart.
3. **Present** the telemetry on the `it-dashboard`, and **remove the "SLA at risk" KPI**.

## 2. Decisions (from brainstorming)

- **Device id:** platform stable id (Android SSAID / iOS idForVendor via `expo-application`)
  + device name + model + OS/Android version. (IMEI is impossible on modern Android/iOS.)
- **"Data usage":** true byte counters are not exposed by Expo/RN — **out of scope**.
  Capture **network type** (wifi/cellular/none), connectivity, and **cellular generation**
  (2G/3G/4G/5G via `expo-cellular`) as the network/data info instead.
- **Scheduling:** foreground hourly + flush on app reopen. **No true background** task.
- **Retry:** on send failure → +5 min, then +10 min, then wait for next reopen/hourly tick.
  Silent (never surfaced, never blocks). Payloads persist in SQLite across restarts.
- **Server:** new Server Script `reportDeviceTelemetry` + new `Device Telemetry` doctype
  (created via FAC).
- **Version shown:** app version + build, OTA `updateId` (short), `createdAt`, `channel`,
  embedded-vs-update.

## 3. Libraries

Already present: `expo-constants`, `expo-network`, `expo-updates`.
**Add:** `expo-device`, `expo-battery`, `expo-application`, `expo-cellular`
(`npx expo install …`).

## 4. Part 1 — Version display

- `settings.tsx`: extend the Version row to also show OTA identity — app version + build
  (`Application.nativeApplicationVersion` / `nativeBuildVersion`), `Updates.updateId`
  (first 8 chars), `Updates.createdAt` (date), `Updates.channel`, and
  `Updates.isEmbeddedLaunch` ("embedded build" vs "OTA update").
- `SideMenu` footer: append the channel + short updateId to the existing `v{APP_VERSION}`.
- No behaviour change to the existing "Check for updates" flow.

## 5. Part 2 — Telemetry (Expo app)

Units under `src/core/telemetry/`:

### 5.1 `collect.ts` → `collectTelemetry(): Promise<TelemetryPayload>`
Payload fields:
- `device_id` (SSAID / idForVendor), `device_name`, `model`, `brand`
- `os` (`ios`/`android`), `os_version`
- `app_version`, `build`
- `ota_update_id`, `ota_channel`, `ota_created_at`, `is_embedded`
- `battery_level` (0–1), `battery_state` (unplugged/charging/full)
- `network_type` (wifi/cellular/none/unknown), `is_connected`, `is_internet_reachable`,
  `cellular_generation` (2g/3g/4g/5g/unknown)
- `captured_at` (ISO)

### 5.2 `telemetry-db.ts` (separate SQLite file `telemetry.db`)
```sql
CREATE TABLE IF NOT EXISTS outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_retry_at TEXT,          -- ISO; NULL = eligible now
  last_error TEXT
);
```
Functions: `initTelemetryDb()`, `enqueue(payload)`, `dueRows(nowISO)` (next_retry_at IS NULL
OR <= now), `allRows()` (reopen flush), `markSent(id)` (delete), `markFailed(id, error, nextRetryAt)`.

### 5.3 `service.ts` — scheduler (singleton)
- `startTelemetry()` — called once from `app/_layout.tsx` after auth/hydration:
  - `initTelemetryDb()`, then `flushAll()` (send every queued row — the reopen catch-up).
  - `setInterval(hourlyTick, 3_600_000)` while the app is foregrounded (cleared on
    unmount / background via AppState).
- `hourlyTick()` — `enqueue(await collectTelemetry())` then `flushDue()`.
- `flushDue()/flushAll()` — for each row: POST; success → `markSent`; failure → compute the
  next retry:
  - `attempts` 0 → +5 min; `attempts` 1 → +10 min; `attempts` ≥ 2 → `next_retry_at = NULL`
    is NOT set (leave a far-future / sentinel so it only retries on reopen/hourly). We store
    `next_retry_at = null` **only** to mean "eligible", so for the "wait for reopen" state we
    set a sentinel far-future timestamp and `flushAll()` (reopen) ignores `next_retry_at`.
  - Schedule `setTimeout` for the +5/+10 windows while foregrounded.
- All wrapped in try/catch; failures logged to `console.warn` only.

### 5.4 transport
Reuse `src/core/api/client` `api(...)`, POST `/api/method/reportDeviceTelemetry` with the
payload. `validateStatus: () => true`; treat non-2xx / `exc` as failure.

## 6. Part 3 — Server

- **`Device Telemetry` doctype** (created via FAC): fields mirroring the payload
  (`device_id`, `device_name`, `model`, `brand`, `os`, `os_version`, `app_version`,
  `build`, `ota_update_id`, `ota_channel`, `battery_level`, `battery_state`,
  `network_type`, `cellular_generation`, `is_connected`, `captured_at`, `raw_json`).
  Naming: autoname hash. Track `creation` for "last seen".
- **`reportDeviceTelemetry`** Server Script (API, safe_exec): reads the posted JSON and
  inserts one `Device Telemetry` doc (`frappe.get_doc({...}).insert(ignore_permissions=True)`),
  returns `{status:'success'}`. Fail-safe (returns error JSON, never 500-loops).

## 7. Part 4 — IT-dashboard presentation + remove SLA KPI

- **Remove the "SLA at risk" KPI** from `it-dashboard` (the KPI card + its JS wiring + any
  server field feeding only it).
- **Add a "Devices" panel/tab** listing the latest telemetry **per device** (one row per
  `device_id`, most recent `captured_at`): device name / model, OS + version, app + OTA
  version (channel), battery %, network type/generation, and "last seen" (relative).
- Data via a new read Server Script **`getDeviceTelemetry`** that returns the latest row per
  `device_id` using `frappe.get_all` (bypasses doctype read-permission like
  `itAssignableRoles`), gated to `IT User Admin`/`System Manager`.

## 8. Files

**App:** add libs; `src/core/telemetry/{collect,telemetry-db,service}.ts`;
`app/_layout.tsx` (start service); `app/(tabs)/settings.tsx` + `src/core/ui/SideMenu.tsx`
(version display).
**Server (FAC):** `Device Telemetry` doctype; `kaitet-web/reportDeviceTelemetry.py`;
`kaitet-web/getDeviceTelemetry.py`; `kaitet-web/it-dashboard.html` (remove SLA KPI, add
Devices panel).

## 9. Out of scope

- True background execution (WorkManager/BGTask).
- Actual data-usage byte counters (no Expo API).
- IMEI (not obtainable).
- Historical charts of telemetry (v1 shows latest per device only).
