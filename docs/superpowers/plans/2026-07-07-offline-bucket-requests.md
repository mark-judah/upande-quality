# Offline Bucket Requests (expo-sqlite) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform Bucket Requests into an offline-first, SQLite-backed feature: download picklists while online, then scan trolleys/buckets fully offline with per-OPL progress across two tabs (Requests / Trolley).

**Architecture:** Raw `expo-sqlite` behind a single `bucket-requests-db.ts` module (schema + typed query fns); a reworked Zustand store calls that module and holds reactive view state; the screen renders two tabs. Download uses the existing `fetchAllocatedBuckets` endpoint. Connectivity via `expo-network`. No server writes this phase.

**Tech Stack:** Expo SDK 54 / React Native + TypeScript, `expo-sqlite ~16` (async API), `expo-network`, Zustand.

## Global Constraints

- **Local only:** no server upload this phase (no `saveTrolleyData`/load-to-truck). Download → scan → persist in SQLite.
- **Per-OPL completion:** an OPL leaves Requests → Trolley when all its buckets are scanned. Requests is **grouped by `order_name`**.
- **Multiple trolleys:** scan a trolley QR to make it active; scan another to switch; each bucket records its `trolley_id`.
- **Replace** the existing online Bucket Requests screen/store.
- **No test framework / expo-sqlite needs a device:** verify with `npx tsc --noEmit` (must pass, no new errors in touched files) + `npx expo lint`, plus the final on-device manual pass in Task 5. Confirmations use React Native `Alert` aliased `RNAlert` (the screen already imports a custom `Alert` from Card).
- **DB name:** `karen_bucket_requests.db`. Bucket id matching is **case-insensitive** (store the id as returned; compare with `lower()`).

---

## File Structure

- `src/tenants/karen/offline/bucket-requests-db.ts` — **Create.** SQLite open + migrate + all query fns + row types.
- `src/tenants/karen/repository/karen-bucket-requests-repository.ts` — **Modify.** Add `salesOrder`/`pickListItemId` to `AllocationItem`+`mapItem`; keep `fetchAllocations` + QR extractors.
- `src/tenants/karen/state/karen-bucket-requests-store.ts` — **Rewrite.** Offline store over the db module.
- `src/tenants/karen/features/bucket-requests/BucketRequestsScreen.tsx` — **Rewrite.** Two tabs + scanner + download/clear.

---

## Task 1: SQLite db module (schema + queries)

**Files:**
- Create: `src/tenants/karen/offline/bucket-requests-db.ts`

**Interfaces:**
- Consumes: `AllocationItem` from the repository (Task 2 adds `salesOrder`, `pickListItemId`; this task only reads fields that already exist plus those two — order Task 2 first if implementing strictly, but the module compiles against the extended type).
- Produces:
  - Types: `ReqBucket`, `ReqOpl`, `OrderGroup`, `TrolleyOpl`, `ScanResult`.
  - `initDb(): Promise<void>`
  - `downloadOpls(items: AllocationItem[]): Promise<{ inserted: number; skipped: number }>`
  - `listRequests(): Promise<OrderGroup[]>`
  - `listTrolley(): Promise<TrolleyOpl[]>`
  - `counts(): Promise<{ requests: number; trolley: number }>`
  - `upsertTrolley(trolleyId: string): Promise<void>`
  - `scanBucket(bucketId: string, trolleyId: string): Promise<ScanResult>`
  - `clearAll(): Promise<void>`

- [ ] **Step 1: Install expo-sqlite**

Run: `npx expo install expo-sqlite`
Expected: `expo-sqlite` added to package.json dependencies (SDK 54 → ~16.x).

- [ ] **Step 2: Create the module**

Create `src/tenants/karen/offline/bucket-requests-db.ts`:

```typescript
import * as SQLite from 'expo-sqlite';
import type { AllocationItem } from '../repository/karen-bucket-requests-repository';

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
export type ReqOpl = {
  oplName: string;
  orderName: string;
  createdOn: string;
  customer: string;
  total: number;
  scanned: number;
  buckets: ReqBucket[];
};
export type OrderGroup = { orderName: string; opls: ReqOpl[] };
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

export async function downloadOpls(items: AllocationItem[]): Promise<{ inserted: number; skipped: number }> {
  const d = await db();
  // group by oplName
  const groups = new Map<string, AllocationItem[]>();
  for (const it of items) {
    if (!it.oplName || !it.bucketId) continue;
    const arr = groups.get(it.oplName);
    if (arr) arr.push(it); else groups.set(it.oplName, [it]);
  }
  let inserted = 0, skipped = 0;
  const now = new Date().toISOString();
  for (const [oplName, rows] of groups) {
    const existing = await d.getFirstAsync<{ c: number }>(
      'SELECT COUNT(*) AS c FROM opl WHERE opl_name = ?', [oplName],
    );
    if (existing && existing.c > 0) { skipped++; continue; }
    const head = rows[0];
    await d.withTransactionAsync(async () => {
      await d.runAsync(
        'INSERT INTO opl (opl_name, order_name, customer, sales_order, farm, created_on, downloaded_at, total_buckets) VALUES (?,?,?,?,?,?,?,?)',
        [oplName, head.orderName || oplName, head.customer || '', head.salesOrder || '', head.farm || '', head.allocatedDate || '', now, rows.length],
      );
      for (const r of rows) {
        await d.runAsync(
          'INSERT OR IGNORE INTO bucket (opl_name, bucket_id, variety, shelf, stem_length, qty, uom, pick_list_item_id, scanned) VALUES (?,?,?,?,?,?,?,?,0)',
          [oplName, r.bucketId, r.varietyLabel || r.variety || '', r.shelfLocation || '', r.stemLength || '', r.qty || 0, r.uom || '', r.pickListItemId || ''],
        );
      }
    });
    inserted++;
  }
  return { inserted, skipped };
}

function mapBucketRow(r: any): ReqBucket {
  return {
    id: r.id, bucketId: r.bucket_id, variety: r.variety || '', shelf: r.shelf || '',
    stemLength: r.stem_length || '', qty: r.qty || 0, uom: r.uom || '',
    scanned: r.scanned === 1, trolleyId: r.trolley_id || null,
  };
}

export async function listRequests(): Promise<OrderGroup[]> {
  const d = await db();
  const opls = await d.getAllAsync<any>(`
    SELECT o.opl_name, o.order_name, o.created_on, o.customer, o.total_buckets AS total,
           (SELECT COUNT(*) FROM bucket b WHERE b.opl_name = o.opl_name AND b.scanned = 1) AS scanned
    FROM opl o
    ORDER BY o.order_name ASC, o.created_on ASC, o.opl_name ASC`);
  const groups = new Map<string, OrderGroup>();
  for (const o of opls) {
    if (o.scanned >= o.total) continue; // complete → Trolley tab
    const brows = await d.getAllAsync<any>(
      'SELECT * FROM bucket WHERE opl_name = ? ORDER BY scanned ASC, id ASC', [o.opl_name]);
    const opl: ReqOpl = {
      oplName: o.opl_name, orderName: o.order_name || o.opl_name, createdOn: o.created_on || '',
      customer: o.customer || '', total: o.total, scanned: o.scanned, buckets: brows.map(mapBucketRow),
    };
    const g = groups.get(opl.orderName);
    if (g) g.opls.push(opl); else groups.set(opl.orderName, { orderName: opl.orderName, opls: [opl] });
  }
  return Array.from(groups.values());
}

export async function listTrolley(): Promise<TrolleyOpl[]> {
  const d = await db();
  const opls = await d.getAllAsync<any>(`
    SELECT o.opl_name, o.order_name, o.created_on, o.customer, o.total_buckets AS total,
           (SELECT COUNT(*) FROM bucket b WHERE b.opl_name = o.opl_name AND b.scanned = 1) AS scanned
    FROM opl o ORDER BY o.created_on DESC, o.opl_name ASC`);
  const out: TrolleyOpl[] = [];
  for (const o of opls) {
    if (o.total <= 0 || o.scanned < o.total) continue; // only fully scanned
    const brows = await d.getAllAsync<any>(
      'SELECT * FROM bucket WHERE opl_name = ? ORDER BY id ASC', [o.opl_name]);
    const trolleys = Array.from(new Set(brows.map((b) => b.trolley_id).filter(Boolean))) as string[];
    out.push({
      oplName: o.opl_name, orderName: o.order_name || o.opl_name, createdOn: o.created_on || '',
      customer: o.customer || '', trolleys, buckets: brows.map(mapBucketRow),
    });
  }
  return out;
}

export async function counts(): Promise<{ requests: number; trolley: number }> {
  const d = await db();
  const rows = await d.getAllAsync<any>(`
    SELECT o.opl_name, o.total_buckets AS total,
      (SELECT COUNT(*) FROM bucket b WHERE b.opl_name=o.opl_name AND b.scanned=1) AS scanned
    FROM opl o`);
  let requests = 0, trolley = 0;
  for (const r of rows) { if (r.total > 0 && r.scanned >= r.total) trolley++; else requests++; }
  return { requests, trolley };
}

export async function upsertTrolley(trolleyId: string): Promise<void> {
  const d = await db();
  await d.runAsync('INSERT OR IGNORE INTO trolley (trolley_id, created_at) VALUES (?, ?)', [trolleyId, new Date().toISOString()]);
}

export async function scanBucket(bucketId: string, trolleyId: string): Promise<ScanResult> {
  const d = await db();
  const lc = bucketId.trim().toLowerCase();
  // already scanned?
  const already = await d.getFirstAsync<any>(
    'SELECT trolley_id FROM bucket WHERE LOWER(bucket_id) = ? AND scanned = 1 LIMIT 1', [lc]);
  const row = await d.getFirstAsync<any>(
    'SELECT id, opl_name FROM bucket WHERE LOWER(bucket_id) = ? AND scanned = 0 LIMIT 1', [lc]);
  if (!row) {
    if (already) return { ok: false, reason: 'already', message: 'Already scanned' + (already.trolley_id ? ' (on ' + already.trolley_id + ')' : '') };
    return { ok: false, reason: 'not_found', message: 'Bucket not in downloaded picklists' };
  }
  await d.runAsync('UPDATE bucket SET scanned = 1, trolley_id = ?, scanned_at = ? WHERE id = ?',
    [trolleyId, new Date().toISOString(), row.id]);
  const tot = await d.getFirstAsync<any>(
    `SELECT total_buckets AS total, (SELECT COUNT(*) FROM bucket b WHERE b.opl_name=? AND b.scanned=1) AS scanned
     FROM opl WHERE opl_name=?`, [row.opl_name, row.opl_name]);
  const oplComplete = !!tot && tot.scanned >= tot.total;
  return { ok: true, oplName: row.opl_name, oplComplete, bucketId };
}

export async function clearAll(): Promise<void> {
  const d = await db();
  await d.execAsync('DELETE FROM bucket; DELETE FROM opl; DELETE FROM trolley;');
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep bucket-requests-db || echo "clean"`
Expected: `clean` (after Task 2 adds `salesOrder`/`pickListItemId`/`farm`/`pickListItemId` to `AllocationItem`; if run before Task 2 you'll see missing-property errors on `head.salesOrder`/`r.pickListItemId` — do Task 2 first).

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json src/tenants/karen/offline/bucket-requests-db.ts
git commit -m "feat(bucket-requests): expo-sqlite db module (schema + offline queries)"
```

---

## Task 2: Repository — expose download fields

**Files:**
- Modify: `src/tenants/karen/repository/karen-bucket-requests-repository.ts`

**Interfaces:**
- Produces: `AllocationItem` gains `salesOrder: string`, `pickListItemId: string`, `farm: string` (already may have `allocatedDate`, `oplName`, `orderName`, `bucketId`, `varietyLabel`, `shelfLocation`, `stemLength`, `qty`, `uom`, `customer`). `fetchAllocations(farm)` and the two QR extractors are unchanged and still exported.

- [ ] **Step 1: Extend the type**

In `AllocationItem` (the `export type` block), add after `allocatedDate`:
```typescript
  salesOrder: string;
  pickListItemId: string;
  farm: string;
```

- [ ] **Step 2: Extend the mapper**

In `mapItem`, add to the returned object:
```typescript
    salesOrder: r.sales_order ?? '',
    pickListItemId: r.pick_list_item_id ?? '',
    farm: r.farm ?? '',
```
(`RawAllocationItem` already declares `sales_order`, `pick_list_item_id`; if `farm` isn't declared there, add `farm?: string;` to `RawAllocationItem` in `karen-bucket-requests-api.ts`.)

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -E "karen-bucket-requests-(repository|api)" || echo "clean"`
Expected: `clean`.

- [ ] **Step 4: Commit**

```bash
git add src/tenants/karen/repository/karen-bucket-requests-repository.ts src/tenants/karen/api/karen-bucket-requests-api.ts
git commit -m "feat(bucket-requests): expose salesOrder/pickListItemId/farm on AllocationItem"
```

---

## Task 3: Offline Zustand store

**Files:**
- Modify (rewrite): `src/tenants/karen/state/karen-bucket-requests-store.ts`

**Interfaces:**
- Consumes: db module (Task 1), `karenBucketRequestsRepository.fetchAllocations` + `extractTrolleyIdFromScan`/`extractBucketIdFromScan` (Task 2).
- Produces the hook `useKarenBucketRequestsStore` with state `{ ready, requests: OrderGroup[], trolley: TrolleyOpl[], counts, activeTrolleyId, online, downloading, error }` and actions `init(), refresh(), download(farm), setTrolleyFromScan(raw), scanBucketFromScan(raw), clearAll()`.

- [ ] **Step 1: Rewrite the store**

Replace the entire file with:

```typescript
import { create } from 'zustand';
import * as Network from 'expo-network';
import {
  karenBucketRequestsRepository,
} from '../repository/karen-bucket-requests-repository';
import * as db from '../offline/bucket-requests-db';
import type { OrderGroup, TrolleyOpl, ScanResult } from '../offline/bucket-requests-db';

type State = {
  ready: boolean;
  error: string | null;
  requests: OrderGroup[];
  trolley: TrolleyOpl[];
  reqCount: number;
  trolleyCount: number;
  activeTrolleyId: string | null;
  online: boolean;
  downloading: boolean;

  init: () => Promise<void>;
  refresh: () => Promise<void>;
  refreshOnline: () => Promise<void>;
  download: (farm: string) => Promise<{ ok: boolean; message: string }>;
  setTrolleyFromScan: (raw: string) => { ok: boolean; message?: string; trolleyId?: string };
  clearActiveTrolley: () => void;
  scanBucketFromScan: (raw: string) => Promise<{ ok: boolean; message: string }>;
  clearAll: () => Promise<void>;
};

export const useKarenBucketRequestsStore = create<State>((set, get) => ({
  ready: false,
  error: null,
  requests: [],
  trolley: [],
  reqCount: 0,
  trolleyCount: 0,
  activeTrolleyId: null,
  online: false,
  downloading: false,

  init: async () => {
    try {
      await db.initDb();
      set({ ready: true, error: null });
      await get().refresh();
      await get().refreshOnline();
    } catch (e: any) {
      set({ ready: false, error: e?.message || 'Failed to open local database.' });
    }
  },

  refresh: async () => {
    const [requests, trolley, c] = await Promise.all([db.listRequests(), db.listTrolley(), db.counts()]);
    set({ requests, trolley, reqCount: c.requests, trolleyCount: c.trolley });
  },

  refreshOnline: async () => {
    try {
      const s = await Network.getNetworkStateAsync();
      set({ online: !!s.isConnected && s.isInternetReachable !== false });
    } catch { set({ online: false }); }
  },

  download: async (farm) => {
    await get().refreshOnline();
    if (!get().online) return { ok: false, message: 'Connect to the internet to download picklists.' };
    set({ downloading: true });
    try {
      const outcome = await karenBucketRequestsRepository.fetchAllocations(farm);
      if (outcome.kind === 'error') { set({ downloading: false }); return { ok: false, message: outcome.message }; }
      const res = await db.downloadOpls(outcome.items);
      await get().refresh();
      set({ downloading: false });
      return { ok: true, message: `Downloaded ${res.inserted} picklist${res.inserted === 1 ? '' : 's'}` + (res.skipped ? ` (${res.skipped} already on device)` : '') + '.' };
    } catch (e: any) {
      set({ downloading: false });
      return { ok: false, message: e?.message || 'Download failed.' };
    }
  },

  setTrolleyFromScan: (raw) => {
    const id = karenBucketRequestsRepository.extractTrolleyIdFromScan(raw);
    if (!id) return { ok: false, message: 'Not a trolley QR code.' };
    set({ activeTrolleyId: id });
    // fire-and-forget persist
    db.upsertTrolley(id).catch(() => {});
    return { ok: true, trolleyId: id };
  },

  clearActiveTrolley: () => set({ activeTrolleyId: null }),

  scanBucketFromScan: async (raw) => {
    const id = karenBucketRequestsRepository.extractBucketIdFromScan(raw);
    if (!id) return { ok: false, message: 'Not a bucket QR code.' };
    const trolley = get().activeTrolleyId;
    if (!trolley) return { ok: false, message: 'Scan a trolley first.' };
    const res: ScanResult = await db.scanBucket(id, trolley);
    await get().refresh();
    if (!res.ok) return { ok: false, message: res.message };
    return { ok: true, message: `${res.bucketId} → ${trolley}` + (res.oplComplete ? ' · order complete' : '') };
  },

  clearAll: async () => {
    await db.clearAll();
    set({ activeTrolleyId: null });
    await get().refresh();
  },
}));

export type { OrderGroup, TrolleyOpl };
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep karen-bucket-requests-store || echo "clean"`
Expected: `clean`.

- [ ] **Step 3: Commit**

```bash
git add src/tenants/karen/state/karen-bucket-requests-store.ts
git commit -m "feat(bucket-requests): offline zustand store over sqlite"
```

---

## Task 4: Screen — two tabs, scanner, download/clear

**Files:**
- Modify (rewrite): `src/tenants/karen/features/bucket-requests/BucketRequestsScreen.tsx`

**Interfaces:**
- Consumes: `useKarenBucketRequestsStore` (Task 3), `ScanField`/`focusWhenReady`, `useToast`, UI kit (`Screen`, `Card`, `Button`, `Segmented`, `Spinner`, `Alert` from Card), theme.

- [ ] **Step 1: Rewrite the screen**

Replace the file with a two-tab screen. Full component:

```tsx
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert as RNAlert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '@/src/core/ui/Screen';
import { Card, Alert } from '@/src/core/ui/Card';
import { Button } from '@/src/core/ui/Button';
import { Segmented } from '@/src/core/ui/Segmented';
import { Spinner } from '@/src/core/ui/Spinner';
import { ScanField, type ScanFieldHandle } from '@/src/core/scanning/ScanField';
import { focusWhenReady } from '@/src/core/scanning/focus';
import { useToast } from '@/src/core/ui/Toast';
import { borderRadius, COLORS, fontFamily, fontSize, spacing } from '@/src/core/theme';
import { useKarenBucketRequestsStore } from '@/src/tenants/karen/state/karen-bucket-requests-store';

type Tab = 'requests' | 'trolley';

export function KarenBucketRequestsScreen({ userFarm }: { userFarm: string }) {
  const trolleyRef = useRef<ScanFieldHandle>(null);
  const bucketRef = useRef<ScanFieldHandle>(null);
  const { showSuccess, showError } = useToast();
  const [tab, setTab] = useState<Tab>('requests');
  const [refreshing, setRefreshing] = useState(false);

  const {
    ready, error, requests, trolley, reqCount, trolleyCount, activeTrolleyId, online, downloading,
    init, refresh, download, setTrolleyFromScan, clearActiveTrolley, scanBucketFromScan, clearAll,
  } = useKarenBucketRequestsStore();

  useEffect(() => { init(); }, [init]);

  useFocusEffect(useCallback(() => {
    focusWhenReady(activeTrolleyId ? bucketRef : trolleyRef);
  }, [activeTrolleyId]));
  useEffect(() => { focusWhenReady(activeTrolleyId ? bucketRef : trolleyRef); }, [activeTrolleyId]);

  const onTrolleyScan = (raw: string) => {
    const r = setTrolleyFromScan(raw);
    if (!r.ok) { showError(r.message ?? 'Invalid trolley QR.'); trolleyRef.current?.clear(); focusWhenReady(trolleyRef); }
    else { showSuccess(`Trolley ${r.trolleyId}`); trolleyRef.current?.clear(); }
  };
  const onBucketScan = async (raw: string) => {
    const r = await scanBucketFromScan(raw);
    if (r.ok) showSuccess(r.message); else showError(r.message);
    bucketRef.current?.clear(); focusWhenReady(bucketRef);
  };

  const onDownload = async () => {
    const r = await download(userFarm);
    if (r.ok) showSuccess(r.message); else showError(r.message);
  };
  const onClear = () => {
    RNAlert.alert('Clear downloaded data?', 'This removes all downloaded picklists, scans and trolleys from this device.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clear', style: 'destructive', onPress: async () => { await clearAll(); showSuccess('Cleared.'); } },
    ]);
  };
  const onRefresh = async () => { setRefreshing(true); try { await refresh(); } finally { setRefreshing(false); } };

  if (!ready && error) {
    return (
      <Screen title="Bucket Requests" scroll={false}>
        <Alert tone="danger">{error}</Alert>
        <Card><Button label="Retry" iconLeft="refresh" onPress={() => init()} /></Card>
      </Screen>
    );
  }

  return (
    <Screen title="Bucket Requests" scroll={false}>
      <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.text} />}>

        <View style={s.topRow}>
          <View style={{ flex: 1 }}>
            <Button label={downloading ? 'Downloading…' : 'Download picklists'} iconLeft="cloud-download-outline"
              onPress={onDownload} loading={downloading} disabled={downloading} />
          </View>
          <Pressable style={s.clearBtn} hitSlop={8} onPress={onClear}>
            <Ionicons name="trash-outline" size={16} color={COLORS.danger ?? '#EF4444'} />
          </Pressable>
        </View>
        {!online ? <Text style={s.offline}>Offline — you can still scan; downloads need internet.</Text> : null}

        <Card>
          <View style={s.scanRow}>
            <View style={s.scanField}>
              <Text style={s.scanLabel}>1 · Trolley</Text>
              <ScanField ref={trolleyRef} onScan={onTrolleyScan} autoFocus={!activeTrolleyId}
                placeholder="Scan trolley QR" value={activeTrolleyId ?? undefined} editable={!activeTrolleyId} />
              {activeTrolleyId ? (
                <Pressable onPress={() => { clearActiveTrolley(); focusWhenReady(trolleyRef); }} hitSlop={8} style={s.changeRow}>
                  <Ionicons name="swap-horizontal" size={14} color={COLORS.text} />
                  <Text style={s.changeLink}>Change trolley</Text>
                </Pressable>
              ) : null}
            </View>
            <View style={s.scanField}>
              <Text style={s.scanLabel}>2 · Bucket</Text>
              <ScanField ref={bucketRef} onScan={onBucketScan} autoFocus={!!activeTrolleyId}
                placeholder={activeTrolleyId ? 'Scan bucket QR' : 'Scan trolley first'} editable={!!activeTrolleyId} />
            </View>
          </View>
        </Card>

        <Segmented value={tab} onChange={(v) => setTab(v as Tab)}
          options={[{ value: 'requests', label: `Requests (${reqCount})` }, { value: 'trolley', label: `Trolley (${trolleyCount})` }]} />

        {tab === 'requests'
          ? <RequestsTab groups={requests} />
          : <TrolleyTab items={trolley} />}
      </ScrollView>
    </Screen>
  );
}

function RequestsTab({ groups }: { groups: { orderName: string; opls: any[] }[] }) {
  if (!groups.length) return (
    <Card><View style={s.empty}><Ionicons name="download-outline" size={26} color={COLORS.textMuted} />
      <Text style={s.emptyTitle}>No picklists</Text>
      <Text style={s.emptyHint}>Tap “Download picklists” while online to load your orders.</Text></View></Card>
  );
  return (
    <>
      {groups.map((g) => (
        <View key={g.orderName}>
          <Text style={s.groupHdr}>{g.orderName}</Text>
          {g.opls.map((o) => <OplCard key={o.oplName} opl={o} />)}
        </View>
      ))}
    </>
  );
}

function OplCard({ opl }: { opl: any }) {
  const pct = opl.total > 0 ? Math.round((opl.scanned / opl.total) * 100) : 0;
  return (
    <Card>
      <View style={s.oplHead}>
        <View style={{ flex: 1 }}>
          <Text style={s.oplDate}>{opl.createdOn || '—'}</Text>
          <Text style={s.oplMeta}>{opl.scanned}/{opl.total} scanned</Text>
        </View>
        <Text style={s.pct}>{pct}%</Text>
      </View>
      <View style={s.track}><View style={[s.fill, { width: `${pct}%` }]} /></View>
      <View style={s.divider} />
      {opl.buckets.map((b: any) => (
        <View key={b.id} style={s.bRow}>
          <Ionicons name={b.scanned ? 'checkmark-circle' : 'ellipse-outline'} size={18}
            color={b.scanned ? (COLORS.success ?? '#12B76A') : COLORS.textMuted} />
          <View style={{ flex: 1 }}>
            <Text style={s.bId}>{b.bucketId}</Text>
            <Text style={s.bMeta} numberOfLines={1}>{b.variety}{b.shelf ? ` · ${b.shelf}` : ''}</Text>
          </View>
          <Text style={s.bQty}>{Math.round(b.qty)} {b.uom}</Text>
        </View>
      ))}
    </Card>
  );
}

function TrolleyTab({ items }: { items: any[] }) {
  if (!items.length) return (
    <Card><View style={s.empty}><Ionicons name="cart-outline" size={26} color={COLORS.textMuted} />
      <Text style={s.emptyTitle}>No completed orders</Text>
      <Text style={s.emptyHint}>Fully-scanned orders appear here with their trolley.</Text></View></Card>
  );
  return (
    <>
      {items.map((o) => (
        <Card key={o.oplName}>
          <View style={s.oplHead}>
            <View style={{ flex: 1 }}>
              <Text style={s.bId}>{o.orderName}</Text>
              <Text style={s.oplMeta}>{o.createdOn} · trolley {o.trolleys.join(', ') || '—'}</Text>
            </View>
            <View style={s.badge}><Text style={s.badgeTxt}>{o.buckets.length}</Text></View>
          </View>
          <View style={s.divider} />
          {o.buckets.map((b: any) => (
            <View key={b.id} style={s.bRow}>
              <Ionicons name="checkmark-circle" size={16} color={COLORS.success ?? '#12B76A'} />
              <View style={{ flex: 1 }}><Text style={s.bId}>{b.bucketId}</Text>
                <Text style={s.bMeta} numberOfLines={1}>{b.variety}{b.shelf ? ` · ${b.shelf}` : ''}</Text></View>
              <Text style={s.bQty}>{b.trolleyId || ''}</Text>
            </View>
          ))}
        </Card>
      ))}
    </>
  );
}

const s = StyleSheet.create({
  scroll: { paddingBottom: 40 },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.xs },
  clearBtn: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.surfaceAlt },
  offline: { fontFamily: fontFamily.regular, fontSize: fontSize.xs, color: COLORS.textMuted, marginBottom: spacing.sm },
  scanRow: { flexDirection: 'row', gap: spacing.sm },
  scanField: { flex: 1 },
  scanLabel: { fontFamily: fontFamily.semiBold, fontSize: fontSize.xs, color: COLORS.textMuted, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: spacing.xs },
  changeRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: spacing.xs, alignSelf: 'flex-end' },
  changeLink: { fontFamily: fontFamily.medium, fontSize: fontSize.xs, color: COLORS.text },
  groupHdr: { fontFamily: fontFamily.bold, fontSize: fontSize.sm, color: COLORS.text, marginTop: spacing.md, marginBottom: spacing.xs, marginLeft: spacing.xs },
  oplHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  oplDate: { fontFamily: fontFamily.semiBold, fontSize: fontSize.sm, color: COLORS.text },
  oplMeta: { fontFamily: fontFamily.regular, fontSize: fontSize.xs, color: COLORS.textMuted },
  pct: { fontFamily: fontFamily.bold, fontSize: fontSize.md, color: COLORS.text },
  track: { height: 6, borderRadius: 3, backgroundColor: COLORS.surfaceAlt, marginTop: spacing.sm, overflow: 'hidden' },
  fill: { height: 6, backgroundColor: COLORS.text },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: COLORS.border, marginVertical: spacing.sm },
  bRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 6 },
  bId: { fontFamily: 'monospace', fontSize: fontSize.sm, color: COLORS.text, fontWeight: '700' },
  bMeta: { fontFamily: fontFamily.medium, fontSize: fontSize.sm, color: COLORS.textSecondary },
  bQty: { fontFamily: fontFamily.semiBold, fontSize: fontSize.xs, color: COLORS.textSecondary },
  badge: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: borderRadius.full, backgroundColor: COLORS.text },
  badgeTxt: { fontFamily: fontFamily.bold, fontSize: 11, color: COLORS.textOnPrimary ?? '#fff' },
  empty: { alignItems: 'center', paddingVertical: spacing.lg, gap: spacing.xs },
  emptyTitle: { fontFamily: fontFamily.semiBold, fontSize: fontSize.md, color: COLORS.text },
  emptyHint: { fontFamily: fontFamily.regular, fontSize: fontSize.sm, color: COLORS.textMuted, textAlign: 'center' },
});
```

- [ ] **Step 2: Typecheck + lint**

Run: `npx tsc --noEmit 2>&1 | grep BucketRequestsScreen || echo "clean"`
Expected: `clean`.
Run: `npx expo lint 2>&1 | grep BucketRequestsScreen || echo "no lint issues"`
Expected: `no lint issues` (fix any that appear — e.g. unused imports).

- [ ] **Step 3: Commit**

```bash
git add src/tenants/karen/features/bucket-requests/BucketRequestsScreen.tsx
git commit -m "feat(bucket-requests): offline two-tab screen (requests/trolley) + download/clear"
```

---

## Task 5: On-device end-to-end verification

**Files:** none (verification only).

- [ ] **Step 1: Build & launch**

Run a dev build on a device/emulator (expo-sqlite needs native — not Expo Go web): `npx expo run:android` (or `run:ios`), sign in as a Karen station user.

- [ ] **Step 2: Download (online)**

On Bucket Requests, tap **Download picklists**. Expect a toast "Downloaded N picklists"; Requests tab shows orders grouped by order name, each OPL card with a date (OPL creation date), 0% progress, and bucket rows showing variety · shelf with an empty circle. Tap Download again → "(N already on device)" and no duplicates.

- [ ] **Step 3: Scan offline**

Turn on airplane mode (prove offline). Scan a trolley QR → active. Scan a bucket QR from a listed OPL → its row gets a ✔, the OPL progress bar advances, count updates. Scan an unknown QR → "Bucket not in downloaded picklists". Re-scan a scanned one → "Already scanned". Force-quit and reopen → scans persisted (still ✔).

- [ ] **Step 4: Completion → Trolley tab**

Scan all buckets of one OPL. It disappears from Requests and appears under **Trolley (n)**, showing the order + trolley id(s) and the fully-scanned buckets. If an order has multiple OPLs, only the completed OPL moves; the rest stay under the order group in Requests.

- [ ] **Step 5: Clear**

Tap the trash → confirm → all tabs empty, counts 0.

- [ ] **Step 6: Final commit (if any fixes)**

```bash
git add -A && git commit -m "fix(bucket-requests): offline verification follow-ups"
```
(Skip if nothing changed.)

---

## Self-Review notes (addressed)

- **Spec §3 architecture** → Tasks 1 (db module), 3 (store), 4 (screen); expo-sqlite install in Task 1·1.
- **Spec §4 schema** → Task 1·2 DDL (verbatim).
- **Spec §5 download + skip** → `downloadOpls` (Task 1) skips existing `opl_name`; store gates on `online` (Task 3); UI button (Task 4).
- **Spec §6 scan flow** → `scanBucket` (Task 1) + store `scanBucketFromScan` (Task 3) + scanner UI (Task 4); guards not_found/already/no-trolley.
- **Spec §7 tabs (group by order name, per-OPL completion, trolley shows trolleys)** → `listRequests`/`listTrolley` (Task 1) + `RequestsTab`/`TrolleyTab` (Task 4).
- **Spec §8 clear + errors** → `clearAll` (Task 1/3/4), DB-failure banner (Task 4 Step 1 render guard), offline message (Task 3 download).
- **Type consistency:** `OrderGroup`/`TrolleyOpl`/`ReqOpl`/`ReqBucket`/`ScanResult` defined in Task 1 and consumed unchanged in Tasks 3–4; store action names (`init/refresh/download/setTrolleyFromScan/scanBucketFromScan/clearAll`) match between Task 3 and Task 4.
- **No test framework / expo-sqlite native-only:** verification is tsc + lint per task and the Task 5 device pass, stated in Global Constraints.
