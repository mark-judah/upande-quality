# Shelf Operations — Design

## Problem

Operators currently have no way to:

1. Move a bucket from one shelf to another on the same farm. The only
   existing "add to shelf" flows (`createShelvingEntry` in
   `upande_quality/mobile/api.py`, `shelveBucket` in
   `upande_packhouse/mobile/api.py`) treat a shelving scan as brand new —
   the only "move" semantics that exist today are a narrow self-heal case
   for inter-farm truck transfers (`awaiting_transfer`/`in_transit`/
   `loaded_in_trolley` on a Pick List Item). There is no deliberate,
   operator-initiated "this bucket is now on shelf B, not shelf A" action.
2. Report that a bucket was physically removed from a shelf outside the
   normal sales-issuing flow (damage, quality hold, internal use, or any
   other offline reason) in a way that updates stock.

Both gaps mean the system's shelf state (and, for buckets already
referenced by a draft Order Pick List, the OPL's own record of where to
find the bucket) silently drifts from physical reality. `Pick List
Item.shelf` is written once, at shelving time, and never re-synced — a
bucket moved after that point is effectively "lost" from the picker's
point of view until someone notices during issuing.

Separately, the **Shelving Log** doctype (`shelved_on`/`removed_on` per
bucket, with a `reason` Select including `Shelved`, `Transferred
(Trolley/Truck)`, `Discarded`, `Issued to Sales Order`, `Issued from
Coldstore`, `Replaced`, `Shelf Cleared`, `Aged Out`) is designed to be a
continuous ledger but isn't one in practice: no code path ever writes a
`Shelved` row when a bucket is first shelved, so most of the "removal"
code that looks up an open `Shelved` row to close it finds nothing and
silently no-ops. Discarding never touches the log at all.

## Goals

- A same-farm shelf-to-shelf bucket transfer operation that also
  re-syncs every place a bucket's location is cached for an existing
  order (`Pick List Item.shelf`, `Bucket Allocation Status.shelf_location`
  / `shelf_farm`), so an operator picking against a draft OPL always
  sees the bucket's current shelf.
- An "offline removal" report operation for buckets removed from a
  shelf for reasons other than a normal sales issue or a formal
  Discard-Request-driven discard — with real stock impact via a new,
  distinct Stock Entry type, not a silent shelf-only edit.
- Both operations produce a correct, continuous Shelving Log entry.
- Fix the pre-existing gap so normal shelving also writes a `Shelved`
  log entry, since both new operations depend on finding one to close.

## Non-goals

- Cross-farm bucket transfer (existing truck-transfer flow already
  owns that; out of scope here).
- Changing the existing Discard Request / `createDiscardEntry` flow.
- Any change to how a bucket is issued to a sales order
  (`issueBucketToSaleOrderItem`).
- Backfilling history for buckets already on a shelf before this
  change ships (the `Shelved` log fix only affects shelving actions
  going forward).

## Data model changes

- **Stock Entry Type**: add `"Offline Issuing"`, alongside the existing
  `Discard` type. Distinct meaning: the bucket was consumed/used
  outside the normal flow, not wasted (Discard) and not tied to a
  specific `sale_order_item` (a normal sales issue).
- **Shelving Log `reason` Select**: add two new options —
  `"Transferred (Shelf-to-Shelf)"` (distinct from the existing
  `"Transferred (Trolley/Truck)"`, which specifically means inter-farm
  truck moves) and `"Offline Issuing"`.
- **Shelving Log gap fix**: `createShelvingEntry`
  (`upande_quality/upande_quality/mobile/api.py`) and `shelveBucket`
  (`upande_packhouse/upande_packhouse/mobile/api.py`) both currently
  `shelf_doc.append("items", …)` / `.save()` without ever inserting a
  Shelving Log row. Both get a new insert immediately after the Shelf
  Item is appended: `reason="Shelved"`, `shelved_on=now()`,
  `shelved_by=frappe.session.user`, `shelf_item=<new Shelf Item row
  name>`, plus the same bucket/farm/variety/stem_qty/etc. snapshot
  fields the doctype already defines. This is additive — no existing
  field or behavior changes.

## Operation 1 — Transfer bucket to another shelf

New whitelisted endpoint `transferBucket(bucket_id, to_shelf_id)` in
`upande_quality/upande_quality/mobile/api.py`, next to
`createDiscardEntry`/`createShelvingEntry`.

A bucket transfers as one physical unit: every `Shelf Item` row for
`bucket_id` (it can have more than one, e.g. mixed variety/length)
moves together.

Steps:

1. Load all `Shelf Item` rows for `bucket_id`. If none, error: bucket
   isn't currently on any shelf.
2. Load the destination `Shelf` (`to_shelf_id`). Validate its `farm`
   matches the current shelf's `farm` — reject cross-farm moves with a
   clear error naming both farms.
3. Reject if any of the bucket's `Pick List Item` rows have
   `awaiting_transfer`, `in_transit`, or `loaded_in_trolley` set — that
   means it's mid inter-farm-truck-transfer, which is a different flow
   and shouldn't be touched here.
4. Validate destination shelf capacity (same max-2-buckets rule
   `createShelvingEntry` already enforces) against the incoming rows.
5. Delete the source `Shelf Item` rows; insert new ones on the
   destination shelf carrying over `variety`/`stem_qty`/`stem_length`/
   `cut_stage`/`harvest_date`/`receiving_date`/`farm`/`harvester`/
   `graded_by`/`grading_date`/`greenhouse`/`warehouse` unchanged.
6. For every `Pick List Item` row where `bucket = bucket_id` and
   `issued != 1`: set `shelf = to_shelf_id`. (An already-issued row's
   shelf is moot — issuing already happened.)
7. If a `Bucket Allocation Status` row exists for this bucket, update
   `shelf_location`/`shelf_farm` to match.
8. Find the bucket's open Shelving Log row (`reason="Shelved"`,
   `removed_on` empty) and close it: `removed_on=now()`,
   `reason="Transferred (Shelf-to-Shelf)"`. Insert a new `Shelved` row
   for the destination shelf (same pattern as the gap fix above).
9. `frappe.db.commit()`.

All validation (steps 1-4) happens before any write in steps 5-8, so a
rejected transfer never partially mutates state.

## Operation 2 — Report offline removal ("Offline Issuing")

New whitelisted endpoint `createOfflineIssuingEntry(bucket_id, reason)`
in the same file, `reason` a required free-text string from the
operator.

Steps:

1. Load all `Shelf Item` rows for `bucket_id`. If none, error: bucket
   isn't currently on any shelf.
2. Check `Bucket Allocation Status` for this bucket. If
   `allocated_quantity > 0`, **block**: error message names the sales
   order the allocation belongs to and tells the operator to use
   normal issuing instead. No writes happen in this case.
3. Create and submit a `Stock Entry`: `stock_entry_type="Offline
   Issuing"`, `purpose="Material Issue"`, `from_warehouse` = the
   shelf's warehouse, quantity = sum of `stem_qty` across the bucket's
   Shelf Item rows, `remarks` = the operator's reason text. This is the
   real stock-ledger impact.
4. Delete the bucket's `Shelf Item` rows.
5. Find the bucket's open Shelving Log row and close it:
   `removed_on=now()`, `reason="Offline Issuing"`.
6. `frappe.db.commit()`.

## Mobile screen — "Shelf Operations"

New feature, following the existing per-tenant layered structure
exactly (`ShelvingScreen`/`DiscardsScreen` as the closest precedents):

- `app/(tabs)/shelf-operations.tsx` — thin route, gated by
  `useTenant()` + `<RequireStation>`, renders the Karen-tenant screen
  (other tenants show the existing `<PendingScreen>` until built).
- `src/tenants/karen/features/shelf-operations/ShelfOperationsScreen.tsx`
  — two modes:
  - **Transfer**: scan bucket → scan destination shelf → confirm →
    `OutcomeCard`.
  - **Report Offline Removal**: scan bucket → free-text reason input →
    confirm → `OutcomeCard`. A blocked (allocated) result renders as an
    error naming the specific sales order.
- `src/tenants/karen/state/karen-shelf-operations-store.ts` — zustand
  store: current mode, scanned bucket/shelf, reason text, last outcome.
- `src/tenants/karen/repository/karen-shelf-operations-repository.ts` —
  maps raw API responses to typed outcome unions, including a distinct
  `blocked-allocated` outcome kind carrying the order name.
- `src/tenants/karen/api/karen-shelf-operations-api.ts` — two calls:
  `transferBucket(bucketId, toShelfId)`,
  `reportOfflineRemoval(bucketId, reason)`.
- Registration: icon entry in `app/(tabs)/_layout.tsx`'s `ICONS` map,
  drawer entry in `src/tenants/karen/navigation.ts`.

## Testing

Backend (Python, in the relevant bench app's test suite):

- Transfer: happy path (Shelf Item moved, `Pick List Item.shelf` and
  BAS synced for un-issued rows only, Shelving Log closed + reopened
  correctly); capacity-exceeded rejection; cross-farm rejection;
  rejection when a Pick List Item shows the bucket mid truck-transfer.
- Offline removal: happy path (Stock Entry submitted with correct type/
  qty/remarks, Shelf Item deleted, log closed); blocked when allocated,
  asserting the order name appears in the error.
- Shelving Log gap fix: a normal `createShelvingEntry`/`shelveBucket`
  call now produces a `Shelved` row with the right fields.

Mobile: no existing automated screen tests in this repo. Gate on
TypeScript + lint, plus a manual smoke-test pass through both flows on
a real device before considering the feature done.

## Open questions for implementation time

- Exact field name(s) `Shelf Item`/`Pick List Item` use for warehouse
  when a shelf's farm has more than one associated warehouse — confirm
  against the live schema before writing the transfer's warehouse
  carry-over logic.
- Whether `upande_quality`'s `createShelvingEntry` and
  `upande_packhouse`'s `shelveBucket` are actually both live entry
  points, or one is legacy/unused — worth a quick check before
  duplicating the Shelving Log fix into both. Working hypothesis: both
  are live but serve different mobile clients (the React Native
  `upande-quality` app calls `createShelvingEntry`; `shelveBucket`
  looks like the entry point for the separate Flutter packhouse app
  referenced elsewhere), in which case both genuinely need the fix —
  confirm this before assuming either can be skipped.
