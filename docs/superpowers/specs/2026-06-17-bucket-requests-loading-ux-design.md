# Bucket Requests — Loading UX Fixes + Clear Saved Trolleys

**Date:** 2026-06-17
**Status:** Design — awaiting user review
**Area:** Karen tenant · Bucket Requests feature (`src/tenants/karen/features/bucket-requests/`)

## 1. Problem

Operators on the Bucket Requests screen scan buckets onto trolleys, save them, then load them to a truck. Three issues:

1. **The "Load to truck" button sometimes disappears.** It's rendered inside the collapsible body of each saved-trolley card; collapsing the card (or a saved-list re-fetch that remounts cards) hides it.
2. **The loading UI is confusing** — it's not clear which trolleys are still in-progress, which are saved, which are loaded, and which buckets belong to each.
3. **No way to clear saved trolleys.** A trolley saved by mistake (or left dangling) stays in the list forever; there is no delete/clear action anywhere.

## 2. Decisions (from brainstorming)

- **Persistence model unchanged.** Keep the current server-backed model: in-progress trolleys live in memory, Save pushes to the server, the "Saved" list is re-fetched from the server. No on-device/offline-first persistence in this work.
- **Clear = undo the save on the server, do NOT re-shelve.** Deleting a saved trolley clears its trolley grouping on the server but leaves its buckets off-shelf (picked). Needs a new backend endpoint.
- **Scope = both** per-trolley delete and a clear-all.
- **Delete applies only to SAVED (not-yet-loaded) trolleys.** Trolleys already loaded to a truck (`custom_in_transit=1`) are out of scope and protected.

## 3. Data model (confirmed via `kaitet-web/getSchedulerDrafts.py`)

A "saved trolley" is not a standalone record. It is a set of **Pick List Item** rows carrying:
- `custom_trolley_id` — the trolley grouping
- `custom_loaded_in_trolley = 1` — set on Save; `custom_shelf` is cleared on Save
- `custom_in_transit = 1` + `custom_transit_truck` — set later by `loadTrolleyInTruck`
- `custom_bucket`, `custom_awaiting_transfer`, `custom_shelved`, `custom_issued`

`getSavedTrolleys(farm)` groups these rows by `custom_trolley_id`. `truck_id` populated ⇒ the trolley is loaded.

Existing server methods (`fetchAllocatedBuckets`, `saveTrolleyData`, `getSavedTrolleys`, `loadTrolleyInTruck`) appear to be custom-app methods (not editable Server Scripts). The delete is added as a **new, independent Server Script** that operates on the same Pick List Item rows — no changes to existing methods.

## 4. Frontend changes

Files: `src/tenants/karen/features/bucket-requests/BucketRequestsScreen.tsx`,
`src/tenants/karen/state/karen-bucket-requests-store.ts`,
`src/tenants/karen/repository/karen-bucket-requests-repository.ts`,
`src/tenants/karen/api/karen-bucket-requests-api.ts`.

### 4.1 Disappearing button — fix
In `SavedTrolleyCard`, move the action region (the `Load to truck` button and the "Loaded in {truck}" inline indicator) **out of the `{open ? … }` collapsible block** so it renders unconditionally. Only the bucket list and its dividers remain collapsible. The card's `open` state then affects only the bucket detail, never the action.

### 4.2 Clearer states
- Distinct badges: **UNSAVED** (in-progress, "This session" section), **SAVED** (saved, not loaded), **LOADED** (on a truck, names the truck). Reuse existing badge styles; ensure SAVED and LOADED are visually different from each other and from UNSAVED.
- Loaded cards show "✓ Loaded in {truck}" as the always-visible action region; no delete control.
- Saved (not-loaded) cards show an always-visible `Load to truck` button plus a 🗑 delete control in the header.
- Bucket list stays collapsible (tap chevron) so operators can verify "which buckets" per trolley.

### 4.3 Clear controls
- **Per-trolley delete:** a trash icon in each SAVED card header → confirm dialog → `deleteSavedTrolley(trolleyId)`.
- **Clear all:** a "Clear all" text button in the "Saved" section header → confirm dialog → `clearSavedTrolleys()` (all not-loaded saved trolley ids).
- Clear-all targets **only saved (not-loaded)** trolleys; in-progress "This session" trolleys are unaffected.
- Confirm copy: "Delete trolley {id}? Its buckets stay picked (off-shelf); only the trolley grouping is removed." Clear-all: "Clear N saved trolleys? Their buckets stay picked; loaded trolleys are kept."

### 4.4 Store actions
- `deleteSavedTrolley(trolleyId)` and `clearSavedTrolleys()`:
  - call the repository, optimistically remove affected trolleys from `savedTrolleys`,
  - on error: show the message and re-fetch `loadSaved(farm)` to restore truth,
  - track in-flight state (reuse a `deleting: Record<string, boolean>` map analogous to `loadingToTruck`) so buttons can show progress / disable.

## 5. Backend — new Server Script `deleteSavedTrolleys`

API-type Server Script, `api_method = deleteSavedTrolleys`. safe_exec rules (no import/def/`+=`/`.append`; use `x = x + [i]`, `while`, `d[k]=v`). Payload `{ data: { trolley_ids: [...], farm } }` (trolley_ids may be a list or a `|~|`-joined string — match the existing methods' payload convention; verify live).

Logic:
1. Resolve the Pick List Item rows whose `custom_trolley_id` is in `trolley_ids` (scoped to the farm via their parent OPL, matching how `getSavedTrolleys` scopes).
2. For each such row where `custom_in_transit != 1` (guard — never touch loaded trolleys): set `custom_trolley_id = ""`, `custom_loaded_in_trolley = 0`, `custom_awaiting_transfer = 0`. **Do not modify `custom_shelf`.**
3. Skip and record any row whose trolley is already loaded.
4. Return `{ status: "success", cleared_count, skipped_loaded: [trolley_ids…] }`, or `{ status: "error", message }`.

Exact field names + the farm-scoping query verified against the live instance before finalizing (mirror `getSchedulerDrafts.py`).

## 6. Error handling

- All deletes confirm first (native Alert with destructive style).
- Failures: toast the server message, re-fetch saved list so UI matches server.
- Loaded trolleys cannot be deleted (server guard + no UI control); if a stale UI somehow requests one, the server skips it and reports it in `skipped_loaded`.
- Optimistic UI removal reverts via re-fetch on any error.

## 7. Verification

- **Backend:** curl `deleteSavedTrolleys` against a real saved (not-loaded) trolley; confirm via `getSchedulerDrafts`/`getSavedTrolleys` that `custom_trolley_id`/`custom_loaded_in_trolley` cleared and `custom_shelf` unchanged; confirm a loaded trolley is skipped.
- **Frontend:** run the app, walk the flow — save → SAVED badge → Load button visible even when the card is collapsed → delete one (confirm) → clear all (confirm) → loaded trolley remains and has no delete control. Verify the saved list matches the server after each action.

## 8. Out of scope

- Offline-first / on-device persistence.
- Editing existing server methods.
- Undoing a truck load (loaded trolleys are protected).
- Re-shelving buckets on delete.
