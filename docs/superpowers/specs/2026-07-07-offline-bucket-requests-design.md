# Offline Bucket Requests (expo-sqlite)

**Date:** 2026-07-07
**Status:** Design — awaiting user review
**Area:** Karen tenant · Bucket Requests (`src/tenants/karen/features/bucket-requests/`)

## 1. Goal

Transform the Bucket Requests feature into an **offline-first** workflow backed by
`expo-sqlite`. A picker downloads their picklists while online; the data persists on
device; they then scan trolleys and buckets fully offline. Progress is tracked per OPL,
and fully-scanned OPLs move from a **Requests** tab into a **Trolley** tab.

## 2. Decisions (from brainstorming)

- **Local only, this phase.** No upload to the server. Download → scan → save in SQLite.
  Syncing completed trolleys back to the server (`saveTrolleyData` / load-to-truck) is a
  **later phase**, explicitly out of scope here.
- **Per-OPL completion.** An OPL leaves Requests and appears in Trolley when *all its
  buckets* are scanned. The Requests list is **grouped by `order_name`** (an order can
  span multiple OPLs); each OPL within a group completes independently.
- **Multiple trolleys.** Scan a trolley QR to make it active; scan buckets onto it; scan
  another trolley QR to switch. A bucket records which trolley it was scanned onto.
- **Replace / transform** the existing online screen. The old online store/repository are
  retired for this feature.

## 3. Architecture

Raw `expo-sqlite` (Expo SDK 54 → `expo-sqlite ~16`, async API) behind a small **db
module**; a reworked **Zustand store** calls the db module and holds the reactive view
state; the **screen** renders two tabs. Connectivity via `expo-network`. No ORM.

- `expo-sqlite` is **not yet installed** — add it (`npx expo install expo-sqlite`).
- All SQL lives in one `bucket-requests-db.ts` module (open, migrate, CRUD queries).
- The download still calls the existing server endpoint `fetchAllocatedBuckets(farm)` —
  **no server-side change**.

### File structure
- `src/tenants/karen/offline/bucket-requests-db.ts` — **Create.** SQLite open + schema
  migration + typed query functions (download insert, scan update, list queries, clear).
- `src/tenants/karen/state/karen-bucket-requests-store.ts` — **Rewrite.** Offline store:
  download, active trolley, scan trolley/bucket, tab data selectors, clear.
- `src/tenants/karen/repository/karen-bucket-requests-repository.ts` — **Modify.** Keep
  `fetchAllocations(farm)` (download source) + QR extractors; drop the online save/load
  methods no longer used.
- `src/tenants/karen/features/bucket-requests/BucketRequestsScreen.tsx` — **Rewrite.**
  Two tabs (Requests / Trolley), scanner, download + clear controls.
- `src/tenants/karen/api/karen-bucket-requests-api.ts` — **Modify.** Keep
  `fetchAllocatedBuckets`; unused endpoints (saveTrolleyData/getSavedTrolleys/
  loadTrolleyInTruck/deleteSavedTrolleys) may remain but are no longer called here.

## 4. SQLite schema

```sql
CREATE TABLE IF NOT EXISTS opl (
  opl_name TEXT PRIMARY KEY,      -- dedupe key ("skip already downloaded")
  order_name TEXT,                -- grouping + card title
  customer TEXT,
  sales_order TEXT,
  farm TEXT,
  created_on TEXT,                -- allocated_date (OPL creation date) → date shown in list
  downloaded_at TEXT,
  total_buckets INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS bucket (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  opl_name TEXT NOT NULL,         -- FK → opl.opl_name
  bucket_id TEXT NOT NULL,
  variety TEXT,
  shelf TEXT,
  stem_length TEXT,
  qty REAL,
  uom TEXT,
  pick_list_item_id TEXT,         -- kept for a future sync phase
  scanned INTEGER NOT NULL DEFAULT 0,   -- 0/1 → cross mark
  trolley_id TEXT,                -- set when scanned
  scanned_at TEXT,
  UNIQUE(opl_name, bucket_id)
);
CREATE TABLE IF NOT EXISTS trolley (
  trolley_id TEXT PRIMARY KEY,
  created_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_bucket_opl ON bucket(opl_name);
CREATE INDEX IF NOT EXISTS idx_bucket_scan ON bucket(bucket_id, scanned);
```

- **Completion:** an OPL is complete when `COUNT(scanned=1) == total_buckets`.
- **Progress:** `scanned / total_buckets` per OPL.

## 5. Download + skip-already-downloaded

- "Download picklists" button; enabled only when online (`expo-network`).
- Calls `fetchAllocatedBuckets(userFarm)`. Group returned buckets by `opl_name`.
- For each `opl_name` **not already in `opl`**: insert the OPL row + its buckets in a
  single transaction (`total_buckets` = row count). OPLs already present are **skipped
  entirely** (not updated).
- Result toast: "Downloaded N picklists (M already on device)."
- Offline attempt → "Connect to the internet to download picklists."

## 6. Scan flow (offline)

Scanner (Trolley field + Bucket field) at the top of the Requests tab, two-step UX as
today:
1. Scan **trolley QR** → extract trolley id → upsert into `trolley`, set as the active
   trolley in the store, focus the bucket field.
2. Scan **bucket QR** → extract bucket id → find an **un-scanned** `bucket` row with that
   `bucket_id`:
   - found → `UPDATE bucket SET scanned=1, trolley_id=<active>, scanned_at=now`. UI marks
     it ✔ and bumps the OPL progress. If that OPL is now complete, it moves to Trolley.
   - already scanned → toast "Already scanned (on trolley T)."
   - not found → toast "Bucket not in downloaded picklists."
   - no active trolley → toast "Scan a trolley first."

All writes hit SQLite immediately — nothing is lost offline or on app restart.

## 7. Two tabs

- **Requests** — OPLs with `scanned < total`, **grouped by `order_name`** (group header =
  order name). Under each group, one card per OPL showing: `created_on` date, a progress
  bar (`scanned/total`), and bucket rows (variety · **shelf** · ✔/✗). A completed OPL
  drops out; when all OPLs in an order group are complete the group disappears.
- **Trolley** — OPLs with `scanned == total` (fully scanned only), each showing the order,
  the **trolley(s)** its buckets are on (distinct `trolley_id`s), and the scanned bucket
  list.

Tab labels show counts: `Requests (n)` / `Trolley (n)` by OPL.

## 8. Controls & edge cases

- **Download picklists** (online-gated).
- **Clear downloaded data** — confirm dialog, then wipe `bucket`, `opl`, `trolley`. Resets
  the picker's device state.
- Duplicate bucket scan, unknown bucket, no active trolley → toasts (above).
- DB open/migrate failure → error banner with retry; the screen never white-screens.
- Bucket id matching is case-insensitive (store canonical id from the download).

## 9. Out of scope (later phases)

- Uploading completed trolleys to the server (`saveTrolleyData`) and load-to-truck sync.
- Editing/removing individual scanned buckets (v1 supports clear-all only).
- Conflict handling between device and server state.
