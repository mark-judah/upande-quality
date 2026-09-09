# Packhouse Schedule — Phase 1 design

**Date:** 2026-08-05
**Context:** Karen Roses / upande_kaitet. The packhouse schedule (the order a team packs its orders) is currently stored as `custom_schedule_number` (one Int per Order Pick List, written by `setSchedulerOrder`). That single-field-on-OPL storage is rigid and can't express a curated, reorderable shortlist. Phase 1 moves the schedule into its own doctype and reworks the packhouse-scheduler page. Phase 2 (later) makes transfer-control read this schedule.

## Decisions (from brainstorming)
- **Schedule scope:** one ordered list **per team, per day**.
- **Model:** a **curated subset** — the user explicitly adds "the next 5 or so" orders into the schedule and sequences them (not a stored ordering of the whole ready queue).
- **Build order:** Phase 1 (this spec) first; transfer-control redesign is Phase 2.

## A. Doctypes
**`Packhouse Schedule`** (parent, module "Upande Kaitet")
- `schedule_date` — Date, reqd
- `team` — Select `Team A / Team B / Jamafa / Eldama / Bravo`, reqd
- `orders` — Table → `Packhouse Schedule Order`
- **autoname:** `format:PSCH-{schedule_date}-{team}` → deterministic one-doc-per-(date,team) for trivial upsert.

**`Packhouse Schedule Order`** (child, istable)
- `order_pick_list` — Link → Order Pick List (reqd, in_list_view)
- `order_name` — Data (cached for display)
- `customer` — Data (cached)
- `sequence` — Int

`custom_schedule_number` is left untouched (nothing else breaks) but the scheduler stops writing it; the doctype is the new source of truth.

## B. Server scripts (API type; safe_exec style — while loops, `.append`, `x = x + 1`, no `import`/JSON/`def`/`+=`; delimited strings not JSON)
- `getPackhouseSchedule(team, date)` → `{status, data:{team, date, orders:[{order_pick_list, order_name, customer, sequence}]}}`. Reads `PSCH-{date}-{team}`; child rows come back in idx (= sequence) order.
- `savePackhouseSchedule(team, date, orders)` → upsert. `orders` = `|~|`-joined OPL names in the desired order. Rebuilds the child table, caches `order_name`/`customer` via `frappe.db.get_value`, sets `sequence` 1..N. Returns `{status, name, count}`.
- Keep `getSchedulerData` / `getSchedulerMeta` (ready pool) unchanged.

## C. packhouse-scheduler page rework
- New **"Today's Schedule"** panel bound to the selected **team** (date = today): the ordered selected orders, reorderable (up/down or drag), each with a remove control. Persisted via `savePackhouseSchedule` on every change.
- The **Ready column stays as the pool**; each ready order card gains a **"＋ Schedule"** action that appends it to the shortlist (guard against duplicates).
- On team change (and on load) call `getPackhouseSchedule` to populate the panel; orders already in the schedule are marked in the Ready column.
- Other three columns (packed / partial / status) unchanged.

## D. Phase 2 hook (not built here)
transfer-control will read `Packhouse Schedule` to (a) expose **only scheduled orders** for transfer planning and (b) drive the auto-group-by-farm plan in schedule sequence.

## Testing
- Doctype: create `PSCH-2026-08-05-Eldama` via the API with 3 OPLs; read back in order; re-save with a reordered/trimmed list; confirm upsert (same name, replaced rows). Clean up the test doc.
- Page: local render check that the schedule panel loads, add/remove/reorder persist, and duplicates are blocked.
