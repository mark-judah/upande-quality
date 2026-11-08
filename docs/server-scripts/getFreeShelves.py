# Server Script (type: API) -- api_method: upande_quality.mobile.api.getFreeShelves
#
# Shelves that can still take a bucket, for the farms configured in Production
# Settings > Shelf Locations (enabled rows). A shelf holds 2 buckets, counted as
# DISTINCT bucket ids (a bucket spans several Shelf Item rows when it carries
# several varieties) -- the same rule createShelvingEntry enforces. So:
#   free = 2  -> the shelf is empty (its Shelf Item table has no rows)
#   free = 1  -> one bucket on it, room for one more
#
# Optional ?farm=<Farm> narrows to one configured farm.
#
# Frappe Server Script sandbox: no imports, no _-prefixed names, no f-strings,
# no tuple unpacking, no http_status_code. Result goes in frappe.response["message"].

SHELF_CAPACITY = 2

ps = frappe.get_cached_doc("Production Settings")
farms = []
for row in ps.get("shelf_locations") or []:
    if row.get("enabled") and row.get("farm") and row.get("farm") not in farms:
        farms.append(row.get("farm"))

requested = (frappe.form_dict.get("farm") or "").strip()
if requested:
    narrowed = []
    for f in farms:
        if f == requested:
            narrowed.append(f)
    farms = narrowed

groups = []
total_free_shelves = 0
total_free_slots = 0
total_empty = 0

if farms:
    shelves = frappe.get_all(
        "Shelf",
        filters={"farm": ["in", farms]},
        fields=["name", "shelf_id", "farm"],
        order_by="farm asc, shelf_id asc",
        limit_page_length=0,
    )

    buckets_on = {}
    if shelves:
        names = []
        for sh in shelves:
            names.append(sh.name)
        rows = frappe.get_all(
            "Shelf Item",
            filters={"parent": ["in", names], "parenttype": "Shelf"},
            fields=["parent", "bucket_id"],
            limit_page_length=0,
        )
        for r in rows:
            if r.parent not in buckets_on:
                buckets_on[r.parent] = {}
            buckets_on[r.parent][(r.bucket_id or "").lower()] = 1

    by_farm = {}
    for sh in shelves:
        held = len(buckets_on.get(sh.name, {}))
        free = SHELF_CAPACITY - held
        if free <= 0:
            continue
        if sh.farm not in by_farm:
            by_farm[sh.farm] = []
        by_farm[sh.farm].append({"shelf": sh.name, "shelf_id": sh.shelf_id or sh.name, "buckets": held, "free": free})
        total_free_shelves = total_free_shelves + 1
        total_free_slots = total_free_slots + free
        if held == 0:
            total_empty = total_empty + 1

    for f in farms:
        items = by_farm.get(f, [])
        groups.append({"farm": f, "shelves": items, "free_shelves": len(items)})

frappe.response["message"] = {
    "status": "success",
    "capacity": SHELF_CAPACITY,
    "farms": groups,
    "free_shelves": total_free_shelves,
    "free_slots": total_free_slots,
    "empty_shelves": total_empty,
}
