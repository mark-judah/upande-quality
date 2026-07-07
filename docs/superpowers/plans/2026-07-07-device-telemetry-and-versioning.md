# Device Telemetry, App Versioning & IT-Dashboard Presentation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the running OTA code version in-app; collect device telemetry hourly into an expo-sqlite outbox that transmits with silent 5/10-min + on-reopen retries; present it on the IT dashboard and remove the "SLA at risk" KPI.

**Architecture:** A `src/core/telemetry/` module (collect → sqlite outbox → foreground scheduler → POST). A new Frappe `Device Telemetry` doctype + `reportDeviceTelemetry` (write) and `getDeviceTelemetry` (read, permission-bypassing) Server Scripts. Version display extends `settings.tsx`/`SideMenu` via expo-updates + expo-application.

**Tech Stack:** Expo SDK 54 / RN + TS, expo-sqlite, expo-device/battery/application/cellular/network/updates, Zustand-free (plain module singleton), Frappe Server Scripts + FAC.

## Global Constraints

- **No test framework; expo-sqlite + device APIs are native-only.** Verify per task with `npx tsc --noEmit` (0 new errors in touched files) + `npx expo lint`; server scripts curl-verified via `./kaitet-web/fac.sh` (`export FAC_TOKEN=ca1df47f12af6ba:abb4db10d61bc0a`, ask for a fresh token on `AuthenticationError`); final on-device pass in the last task.
- **IMEI impossible; true data-usage byte counts impossible** — use platform stable id + network type/generation only.
- **Telemetry must fail silently** (console.warn only) and never block the app.
- **Retry:** eligible when `next_retry_at IS NULL OR <= now`; after failure set +5min (attempts→1), +10min (attempts→2), then a far-future sentinel (attempts≥3) so only the reopen `flushAll` (ignores `next_retry_at`) retries it.
- **No true background execution.** Foreground `setInterval` + AppState + launch flush only.
- Platforms already restricted to `ios`/`android` (web export excluded).

---

## File Structure
- `src/core/telemetry/collect.ts` — build the payload (Create)
- `src/core/telemetry/telemetry-db.ts` — sqlite `telemetry.db` outbox (Create)
- `src/core/telemetry/service.ts` — scheduler + send + retry (Create)
- `app/_layout.tsx` — start the service (Modify)
- `app/(tabs)/settings.tsx` — OTA version display (Modify)
- `src/core/ui/SideMenu.tsx` — channel + short updateId in footer (Modify)
- `kaitet-web/reportDeviceTelemetry.py`, `kaitet-web/getDeviceTelemetry.py` — server scripts (Create + deploy)
- `Device Telemetry` doctype — created via FAC
- `kaitet-web/it-dashboard.html` — remove SLA KPI, add Devices panel (Modify)

---

## Task 1: Install native libraries

- [ ] **Step 1:** Run `npx expo install expo-device expo-battery expo-application expo-cellular`
  Expected: all four added to `package.json` (SDK-54 versions).
- [ ] **Step 2:** `npx tsc --noEmit 2>&1 | grep -c "error TS"` → Expected `0`.
- [ ] **Step 3:** Commit
```bash
git add package.json package-lock.json
git commit -m "chore(telemetry): add expo-device/battery/application/cellular"
```

---

## Task 2: Telemetry collector

**Files:** Create `src/core/telemetry/collect.ts`
**Interfaces:** Produces `type TelemetryPayload` and `collectTelemetry(): Promise<TelemetryPayload>`.

- [ ] **Step 1: Implement**
```typescript
import { Platform } from 'react-native';
import * as Device from 'expo-device';
import * as Battery from 'expo-battery';
import * as Application from 'expo-application';
import * as Network from 'expo-network';
import * as Cellular from 'expo-cellular';
import * as Updates from 'expo-updates';

export type TelemetryPayload = {
  device_id: string;
  device_name: string;
  model: string;
  brand: string;
  os: string;
  os_version: string;
  app_version: string;
  build: string;
  ota_update_id: string;
  ota_channel: string;
  ota_created_at: string;
  is_embedded: boolean;
  battery_level: number;
  battery_state: string;
  network_type: string;
  is_connected: boolean;
  is_internet_reachable: boolean;
  cellular_generation: string;
  captured_at: string;
};

async function deviceId(): Promise<string> {
  try {
    if (Platform.OS === 'android') return Application.getAndroidId() ?? '';
    const v = await Application.getIosIdForVendorAsync();
    return v ?? '';
  } catch {
    return '';
  }
}

const NET: Record<number, string> = {
  [Network.NetworkStateType.WIFI]: 'wifi',
  [Network.NetworkStateType.CELLULAR]: 'cellular',
  [Network.NetworkStateType.NONE]: 'none',
};
const GEN: Record<number, string> = {
  [Cellular.CellularGeneration.CELLULAR_2G]: '2g',
  [Cellular.CellularGeneration.CELLULAR_3G]: '3g',
  [Cellular.CellularGeneration.CELLULAR_4G]: '4g',
  [Cellular.CellularGeneration.CELLULAR_5G]: '5g',
};
const BATT: Record<number, string> = {
  [Battery.BatteryState.UNPLUGGED]: 'unplugged',
  [Battery.BatteryState.CHARGING]: 'charging',
  [Battery.BatteryState.FULL]: 'full',
};

export async function collectTelemetry(): Promise<TelemetryPayload> {
  const [id, level, state, net, gen] = await Promise.all([
    deviceId(),
    Battery.getBatteryLevelAsync().catch(() => -1),
    Battery.getBatteryStateAsync().catch(() => Battery.BatteryState.UNKNOWN),
    Network.getNetworkStateAsync().catch(() => ({}) as Network.NetworkState),
    Cellular.getCellularGenerationAsync().catch(() => Cellular.CellularGeneration.UNKNOWN),
  ]);
  return {
    device_id: id,
    device_name: Device.deviceName ?? '',
    model: Device.modelName ?? '',
    brand: Device.brand ?? '',
    os: Platform.OS,
    os_version: String(Device.osVersion ?? Platform.Version ?? ''),
    app_version: Application.nativeApplicationVersion ?? '',
    build: Application.nativeBuildVersion ?? '',
    ota_update_id: Updates.updateId ?? '',
    ota_channel: (Updates.channel as string) ?? '',
    ota_created_at: Updates.createdAt ? Updates.createdAt.toISOString() : '',
    is_embedded: Updates.isEmbeddedLaunch ?? false,
    battery_level: typeof level === 'number' ? level : -1,
    battery_state: BATT[state] ?? 'unknown',
    network_type: NET[(net as Network.NetworkState).type ?? -1] ?? 'unknown',
    is_connected: !!(net as Network.NetworkState).isConnected,
    is_internet_reachable: (net as Network.NetworkState).isInternetReachable !== false,
    cellular_generation: GEN[gen] ?? 'unknown',
    captured_at: new Date().toISOString(),
  };
}
```
- [ ] **Step 2:** `npx tsc --noEmit 2>&1 | grep telemetry/collect || echo clean` → Expected `clean`.
- [ ] **Step 3:** Commit `git add src/core/telemetry/collect.ts && git commit -m "feat(telemetry): device stats collector"`

---

## Task 3: Telemetry outbox db

**Files:** Create `src/core/telemetry/telemetry-db.ts`
**Interfaces:** Consumes `TelemetryPayload`. Produces `type OutboxRow`, `initTelemetryDb()`, `enqueue(p)`, `dueRows()`, `allRows()`, `markSent(id)`, `markFailed(id, error, nextRetryAt|null)`.

- [ ] **Step 1: Implement**
```typescript
import * as SQLite from 'expo-sqlite';
import type { TelemetryPayload } from './collect';

export type OutboxRow = { id: number; payload: TelemetryPayload; attempts: number };

let _db: SQLite.SQLiteDatabase | null = null;
async function db() {
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

function parse(rows: { id: number; payload_json: string; attempts: number }[]): OutboxRow[] {
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
  const rows = await d.getAllAsync<{ id: number; payload_json: string; attempts: number }>(
    'SELECT id, payload_json, attempts FROM outbox WHERE next_retry_at IS NULL OR next_retry_at <= ? ORDER BY id ASC',
    [now],
  );
  return parse(rows);
}

export async function allRows(): Promise<OutboxRow[]> {
  const d = await db();
  const rows = await d.getAllAsync<{ id: number; payload_json: string; attempts: number }>(
    'SELECT id, payload_json, attempts FROM outbox ORDER BY id ASC',
  );
  return parse(rows);
}

export async function markSent(id: number): Promise<void> {
  const d = await db();
  await d.runAsync('DELETE FROM outbox WHERE id = ?', [id]);
}

export async function markFailed(id: number, error: string, nextRetryAt: string | null): Promise<void> {
  const d = await db();
  await d.runAsync(
    'UPDATE outbox SET attempts = attempts + 1, last_error = ?, next_retry_at = ? WHERE id = ?',
    [error.slice(0, 300), nextRetryAt, id],
  );
}
```
- [ ] **Step 2:** `npx tsc --noEmit 2>&1 | grep telemetry-db || echo clean` → `clean`.
- [ ] **Step 3:** Commit `git add src/core/telemetry/telemetry-db.ts && git commit -m "feat(telemetry): sqlite outbox"`

---

## Task 4: Telemetry service (scheduler + send + retry)

**Files:** Create `src/core/telemetry/service.ts`
**Interfaces:** Consumes collect + db + `api`. Produces `startTelemetry()` and `stopTelemetry()`.

- [ ] **Step 1: Implement**
```typescript
import { AppState, type AppStateStatus } from 'react-native';
import { api } from '@/src/core/api/client';
import { collectTelemetry } from './collect';
import {
  initTelemetryDb, enqueue, dueRows, allRows, markSent, markFailed, type OutboxRow,
} from './telemetry-db';

const HOUR_MS = 3_600_000;
const FAR_FUTURE = '2999-01-01T00:00:00.000Z'; // sentinel: only a reopen flush retries
let hourly: ReturnType<typeof setInterval> | null = null;
let retry5: ReturnType<typeof setTimeout> | null = null;
let retry10: ReturnType<typeof setTimeout> | null = null;
let started = false;

async function sendRow(r: OutboxRow): Promise<boolean> {
  try {
    const res = await api<{ message?: { status?: string }; exc?: string }>({
      method: 'POST',
      url: '/api/method/reportDeviceTelemetry',
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
  return FAR_FUTURE; // give up on timed retries; wait for reopen
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
  retry5 = setTimeout(() => flushDue().catch(() => {}), 5 * 60_000);
  retry10 = setTimeout(() => flushDue().catch(() => {}), 15 * 60_000);
}

export async function flushDue(): Promise<void> {
  try { await drain(await dueRows()); } catch (e) { console.warn('[telemetry] flushDue', e); }
}
export async function flushAll(): Promise<void> {
  try { await drain(await allRows()); } catch (e) { console.warn('[telemetry] flushAll', e); }
}

async function hourlyTick(): Promise<void> {
  try {
    await enqueue(await collectTelemetry());
    await flushDue();
  } catch (e) {
    console.warn('[telemetry] tick', e);
  }
}

function onAppState(s: AppStateStatus) {
  if (s === 'active') flushAll().catch(() => {}); // reopen/foreground catch-up
}

export async function startTelemetry(): Promise<void> {
  if (started) return;
  started = true;
  try {
    await initTelemetryDb();
    await hourlyTick();                 // collect + attempt immediately on launch
    await flushAll();                   // drain any backlog from previous runs
    hourly = setInterval(() => hourlyTick().catch(() => {}), HOUR_MS);
    AppState.addEventListener('change', onAppState);
  } catch (e) {
    console.warn('[telemetry] start', e);
  }
}

export function stopTelemetry(): void {
  if (hourly) clearInterval(hourly);
  if (retry5) clearTimeout(retry5);
  if (retry10) clearTimeout(retry10);
  started = false;
}
```
- [ ] **Step 2:** `npx tsc --noEmit 2>&1 | grep telemetry/service || echo clean` → `clean`.
- [ ] **Step 3: Wire into `app/_layout.tsx`** — import and start after auth hydration. Add near the existing `reportVersionIfDue` usage:
```typescript
import { startTelemetry } from '@/src/core/telemetry/service';
// inside the effect that runs once hydrated + hasSession (same place reportVersionIfDue is called):
startTelemetry();
```
(If `reportVersionIfDue` isn't already invoked in an effect, add: `useEffect(() => { if (hydrated && hasSession) { reportVersionIfDue(); startTelemetry(); } }, [hydrated, hasSession]);`)
- [ ] **Step 4:** `npx tsc --noEmit 2>&1 | grep -E "_layout|telemetry" || echo clean` → `clean`; `npx expo lint 2>&1 | grep -E "telemetry|_layout" || echo ok`.
- [ ] **Step 5:** Commit `git add src/core/telemetry/service.ts "app/_layout.tsx" && git commit -m "feat(telemetry): foreground scheduler + silent retry + launch flush"`

---

## Task 5: Server — Device Telemetry doctype + reportDeviceTelemetry

**Files:** Create `kaitet-web/reportDeviceTelemetry.py`; create doctype via FAC.

- [ ] **Step 1: Create the `Device Telemetry` doctype** via FAC (custom, module "Upande Kaitet"):
```bash
export FAC_TOKEN=ca1df47f12af6ba:abb4db10d61bc0a
./kaitet-web/fac.sh create_document '{"doctype":"DocType","data":{
  "name":"Device Telemetry","module":"Upande Kaitet","custom":1,"autoname":"hash",
  "track_changes":0,
  "fields":[
    {"fieldname":"device_id","label":"Device ID","fieldtype":"Data","in_list_view":1},
    {"fieldname":"device_name","label":"Device Name","fieldtype":"Data"},
    {"fieldname":"model","label":"Model","fieldtype":"Data","in_list_view":1},
    {"fieldname":"brand","label":"Brand","fieldtype":"Data"},
    {"fieldname":"os","label":"OS","fieldtype":"Data"},
    {"fieldname":"os_version","label":"OS Version","fieldtype":"Data"},
    {"fieldname":"app_version","label":"App Version","fieldtype":"Data"},
    {"fieldname":"build","label":"Build","fieldtype":"Data"},
    {"fieldname":"ota_update_id","label":"OTA Update ID","fieldtype":"Data"},
    {"fieldname":"ota_channel","label":"OTA Channel","fieldtype":"Data"},
    {"fieldname":"battery_level","label":"Battery Level","fieldtype":"Float"},
    {"fieldname":"battery_state","label":"Battery State","fieldtype":"Data"},
    {"fieldname":"network_type","label":"Network Type","fieldtype":"Data"},
    {"fieldname":"cellular_generation","label":"Cellular Generation","fieldtype":"Data"},
    {"fieldname":"is_connected","label":"Connected","fieldtype":"Check"},
    {"fieldname":"captured_at","label":"Captured At","fieldtype":"Datetime","in_list_view":1},
    {"fieldname":"raw_json","label":"Raw","fieldtype":"Long Text"}
  ],
  "permissions":[{"role":"System Manager","read":1,"write":1,"create":1,"delete":1}]
}}'
```
Expected: success. Verify: `./kaitet-web/fac.sh get_document '{"doctype":"DocType","name":"Device Telemetry"}'` returns the fields.

- [ ] **Step 2: Write `kaitet-web/reportDeviceTelemetry.py`**
```python
# Server Script (API), api_method = reportDeviceTelemetry
# Inserts one Device Telemetry record from the posted payload. Fail-safe, no submit.
frappe.response["message"] = {"status": "error", "message": "Script failed"}
try:
    data = frappe.request.get_json()
    if isinstance(data, dict) and "data" in data:
        data = data.get("data")
    data = data or {}
    fields = ["device_id","device_name","model","brand","os","os_version","app_version",
              "build","ota_update_id","ota_channel","battery_level","battery_state",
              "network_type","cellular_generation","captured_at"]
    doc = {"doctype": "Device Telemetry"}
    i = 0
    while i < len(fields):
        f = fields[i]
        doc[f] = data.get(f)
        i = i + 1
    doc["is_connected"] = 1 if data.get("is_connected") else 0
    doc["raw_json"] = frappe.as_json(data)
    d = frappe.get_doc(doc)
    d.insert(ignore_permissions=True)
    frappe.db.commit()
    frappe.response["message"] = {"status": "success", "name": d.name}
except Exception as e:
    frappe.response["message"] = {"status": "error", "message": str(e)}
```
- [ ] **Step 3: Deploy + verify**
```bash
./kaitet-web/fac.sh create_document '{"doctype":"Server Script","data":{"name":"reportDeviceTelemetry","script_type":"API","api_method":"reportDeviceTelemetry","allow_guest":0,"disabled":0,"script":"frappe.response[\"message\"]={\"status\":\"error\"}"}}'
PY=$(python3 -c 'import json,sys;print(json.dumps(open(sys.argv[1]).read()))' kaitet-web/reportDeviceTelemetry.py)
./kaitet-web/fac.sh update_document "{\"doctype\":\"Server Script\",\"name\":\"reportDeviceTelemetry\",\"data\":{\"script\":$PY}}"
curl -s -m 60 -X POST "https://kaitet-group.upande.com/api/method/reportDeviceTelemetry" -H "Authorization: token $FAC_TOKEN" -H "Content-Type: application/json" -d '{"data":{"device_id":"TEST-DEV","model":"Test","os":"android","app_version":"1.0.0","captured_at":"2026-07-07T10:00:00Z","is_connected":true}}' | python3 -m json.tool
```
Expected: `{"message":{"status":"success","name":"..."}}`. (Leave the one TEST-DEV row; it's harmless and useful for dashboard testing.)
- [ ] **Step 4:** Commit `git add kaitet-web/reportDeviceTelemetry.py && git commit -m "feat(telemetry): Device Telemetry doctype + reportDeviceTelemetry endpoint"`

---

## Task 6: Server — getDeviceTelemetry (latest per device)

**Files:** Create `kaitet-web/getDeviceTelemetry.py`

- [ ] **Step 1: Write it** (bypasses doctype read-perm via `frappe.get_all`, gated to IT User Admin / System Manager like `itAssignableRoles`)
```python
# Server Script (API), api_method = getDeviceTelemetry — latest row per device_id.
frappe.response["message"] = {"status": "error", "devices": []}
try:
    my = frappe.get_all("Has Role", filters={"parent": frappe.session.user, "parenttype": "User"}, fields=["role"], limit_page_length=0)
    roles = {}
    i = 0
    while i < len(my):
        roles[my[i].role] = 1
        i = i + 1
    if ("IT User Admin" not in roles) and ("System Manager" not in roles):
        frappe.response["message"] = {"status": "forbidden", "devices": []}
    else:
        rows = frappe.get_all("Device Telemetry",
            fields=["device_id","device_name","model","brand","os","os_version","app_version",
                    "build","ota_update_id","ota_channel","battery_level","battery_state",
                    "network_type","cellular_generation","is_connected","captured_at","creation"],
            order_by="creation desc", limit_page_length=2000)
        latest = {}
        seen = {}
        j = 0
        while j < len(rows):
            r = rows[j]
            k = r.get("device_id") or r.get("creation")
            if k not in seen:
                seen[k] = 1
                latest_row = dict(r)
                latest_row["creation"] = str(r.get("creation"))
                latest[k] = latest_row
            j = j + 1
        out = []
        for k in latest:
            out = out + [latest[k]]
        frappe.response["message"] = {"status": "success", "devices": out, "count": len(out)}
except Exception as e:
    frappe.response["message"] = {"status": "error", "message": str(e), "devices": []}
```
- [ ] **Step 2: Deploy + verify**
```bash
./kaitet-web/fac.sh create_document '{"doctype":"Server Script","data":{"name":"getDeviceTelemetry","script_type":"API","api_method":"getDeviceTelemetry","allow_guest":0,"disabled":0,"script":"frappe.response[\"message\"]={\"status\":\"error\"}"}}'
PY=$(python3 -c 'import json,sys;print(json.dumps(open(sys.argv[1]).read()))' kaitet-web/getDeviceTelemetry.py)
./kaitet-web/fac.sh update_document "{\"doctype\":\"Server Script\",\"name\":\"getDeviceTelemetry\",\"data\":{\"script\":$PY}}"
curl -s -m 60 "https://kaitet-group.upande.com/api/method/getDeviceTelemetry" -H "Authorization: token $FAC_TOKEN" | python3 -c 'import sys,json;m=json.load(sys.stdin)["message"];print("status",m.get("status"),"count",m.get("count"))'
```
Expected: `status success count >=1` (the TEST-DEV row).
- [ ] **Step 3:** Commit `git add kaitet-web/getDeviceTelemetry.py && git commit -m "feat(telemetry): getDeviceTelemetry (latest per device, perm-bypass)"`

---

## Task 7: App — OTA version display

**Files:** Modify `app/(tabs)/settings.tsx`, `src/core/ui/SideMenu.tsx`

- [ ] **Step 1: settings.tsx** — import `expo-application` and expand the Version row. Replace the Version `<View style={s.row}>…</View>` block's hint with app version + build + OTA identity:
```tsx
import * as Application from 'expo-application';
// ...inside component:
const buildNo = Application.nativeBuildVersion ?? '';
const otaId = (Updates.updateId ?? '').slice(0, 8);
const channel = (Updates.channel as string) ?? '';
const otaDate = Updates.createdAt ? Updates.createdAt.toISOString().slice(0, 10) : '';
const codeLine = Updates.isEmbeddedLaunch
  ? 'embedded build'
  : `OTA ${otaId || '—'}${otaDate ? ' · ' + otaDate : ''}${channel ? ' · ' + channel : ''}`;
```
Then render under the Version hint:
```tsx
            <Text style={s.rowHint}>
              v{appVersion}{buildNo ? ` (${buildNo})` : ''}
            </Text>
            <Text style={s.rowHint}>{codeLine}</Text>
```
- [ ] **Step 2: SideMenu.tsx** — append channel + short id to the footer line:
```tsx
import * as Updates from 'expo-updates';
// replace the version <Text>:
<Text style={s.version}>
  Upande Quality v{APP_VERSION}
  {Updates.channel ? ` · ${Updates.channel}` : ''}
  {Updates.updateId ? ` · ${Updates.updateId.slice(0, 8)}` : ''}
</Text>
```
- [ ] **Step 3:** `npx tsc --noEmit 2>&1 | grep -E "settings|SideMenu" || echo clean` → `clean`; `npx expo lint` clean for both.
- [ ] **Step 4:** Commit `git add "app/(tabs)/settings.tsx" src/core/ui/SideMenu.tsx && git commit -m "feat(version): show OTA update identity in settings + side menu"`

---

## Task 8: IT dashboard — remove SLA KPI + Devices panel

**Files:** Modify `kaitet-web/it-dashboard.html` (then deploy via FAC). Fetch a fresh copy first if not present locally: `./kaitet-web/fac.sh get_document '{"doctype":"Web Page","name":"it-dashboard"}'` → write `main_section_html` to `kaitet-web/it-dashboard.html`.

- [ ] **Step 1: Remove the SLA-at-risk KPI.** Delete the `kpi('SLA at risk', …)` entry (line ~652) from its KPI array, and the now-unused `slaDue` computation (line ~641) if referenced nowhere else (grep `slaDue`). Leave the rest of the Helpdesk section intact.

- [ ] **Step 2: Add a Devices nav item + panel.** In the sidebar nav add `<a class="nav-item" data-nav="devices" id="nav-devices">… Devices</a>`; add a `<section class="panel" data-panel="devices">` with a table `<table class="aph-tbl"><thead><tr><th>Device</th><th>Model</th><th>OS</th><th>App / OTA</th><th>Battery</th><th>Network</th><th>Last seen</th></tr></thead><tbody id="dev-body"></tbody></table>`.

- [ ] **Step 3: Wire the fetch.** Add a loader that calls `getDeviceTelemetry` via the page's `frp` helper and renders rows:
```javascript
function loadDevices(){
  frp('getDeviceTelemetry',{}).then(function(m){
    var rows=(m&&m.devices)||[];
    var tb=$('dev-body'); if(!tb)return;
    if(!rows.length){tb.innerHTML='<tr><td colspan="7"><div class="aph-empty">No device check-ins yet</div></td></tr>';return;}
    tb.innerHTML=rows.map(function(d){
      var batt=(d.battery_level!=null&&d.battery_level>=0)?Math.round(d.battery_level*100)+'%':'—';
      var net=(d.network_type||'—')+(d.cellular_generation&&d.cellular_generation!=='unknown'?(' '+d.cellular_generation):'');
      var app='v'+(d.app_version||'—')+(d.ota_channel?(' · '+d.ota_channel):'');
      return '<tr><td>'+esc(d.device_name||d.device_id||'—')+'</td><td>'+esc(d.model||'—')+'</td><td>'+esc((d.os||'')+' '+(d.os_version||''))+'</td><td>'+esc(app)+'</td><td>'+batt+'</td><td>'+esc(net)+'</td><td>'+esc(String(d.captured_at||d.creation||'').slice(0,16).replace('T',' '))+'</td></tr>';
    }).join('');
  }).catch(function(){});
}
```
Call `loadDevices()` when the devices panel is shown (hook into the existing nav switch), and once on load.

- [ ] **Step 4: Deploy + verify**
```bash
HTML=$(python3 -c 'import json,sys;print(json.dumps(open(sys.argv[1]).read()))' kaitet-web/it-dashboard.html)
./kaitet-web/fac.sh update_document "{\"doctype\":\"Web Page\",\"name\":\"it-dashboard\",\"data\":{\"main_section_html\":$HTML}}"
```
Then re-fetch and confirm `getDeviceTelemetry` present and `SLA at risk` absent:
```bash
./kaitet-web/fac.sh get_document '{"doctype":"Web Page","name":"it-dashboard"}' | python3 -c "import sys,json;h=json.loads(sys.stdin.read())['result']['content'][0]['text'];import json as j;s=j.loads(h)['result']['data']['main_section_html'];print('getDeviceTelemetry:', 'getDeviceTelemetry' in s);print('SLA at risk gone:', 'SLA at risk' not in s)"
```
Expected: `getDeviceTelemetry: True`, `SLA at risk gone: True`.
- [ ] **Step 5:** Commit `git add kaitet-web/it-dashboard.html && git commit -m "feat(it-dashboard): device telemetry panel; remove SLA-at-risk KPI"`

---

## Task 9: On-device end-to-end

**Files:** none.
- [ ] **Step 1:** Dev build (`npx expo run:android`). Open the app; Settings shows app version + build + OTA line; SideMenu footer shows channel + short id.
- [ ] **Step 2:** Leave the app open; confirm (via the IT dashboard Devices panel or `getDeviceTelemetry`) a real row appears for this device on launch, with battery/network/model/versions populated. `device_id` non-empty (SSAID/idForVendor).
- [ ] **Step 3:** Airplane mode → reopen the app a few times → confirm no crash, rows queue in `telemetry.db`, and drain (rows appear server-side) once connectivity returns.
- [ ] **Step 4:** IT dashboard: "SLA at risk" KPI gone; Devices panel lists the device(s), one row per device with "last seen".
- [ ] **Step 5:** Final commit if fixes needed.

---

## Self-Review notes (addressed)
- **Spec §4 version display** → Task 7. **§5 collect/db/service** → Tasks 2/3/4. **§6 server** → Tasks 5/6. **§7 dashboard + remove SLA** → Task 8.
- **Retry semantics** (5/10-min then reopen sentinel) → Task 4 `nextRetryFor` + `dueRows`/`allRows`.
- **Silent failure** → all telemetry paths try/catch + console.warn; never thrown to UI.
- **IMEI/data-usage impossibility** → Task 2 uses SSAID/idForVendor + network type/generation only.
- **Type consistency:** `TelemetryPayload` (Task 2) consumed by db (Task 3) + service (Task 4); `startTelemetry` (Task 4) called in `_layout` (Task 4·3); endpoint names `reportDeviceTelemetry`/`getDeviceTelemetry` match across app + server + dashboard.
- **No test framework / native-only** → tsc+lint+curl per task, device pass Task 9.
