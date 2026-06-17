# Frappe Server Script (Type: API), api_method = getSchedulerData
# Constraints: no return, no def, no import, no augmented assignment (+=),
# no .append/.add/.update — use  list = list + [x] , dict[k]=v , set | {x}
#
# Returns OPLs bucketed into the 4 scheduler columns:
#   partially_allocated | awaiting_transfer | ready_lines | packed
# ready_lines is ordered by custom_schedule_number (asc), default by creation time.

frappe.response["message"] = {"success": False, "error": "Script failed"}

try:
    team_filter = frappe.form_dict.get("team_filter", "all")
    period      = frappe.form_dict.get("period", "today")
    from_date   = frappe.form_dict.get("from_date")
    to_date     = frappe.form_dict.get("to_date")

    today = frappe.utils.today()

    date_filter = None
    if period == "today":
        date_filter = ["date_created", "=", today]
    elif period == "yesterday":
        date_filter = ["date_created", "=", frappe.utils.add_days(today, -1)]
    elif period == "last_7_days":
        date_filter = ["date_created", ">=", frappe.utils.add_days(today, -7)]
    elif period == "custom":
        if from_date and to_date:
            from_d = frappe.utils.getdate(from_date)
            to_d   = frappe.utils.getdate(to_date)
            if from_d > to_d:
                tmp = from_d
                from_d = to_d
                to_d = tmp
            date_filter = ["date_created", "between", (from_d, to_d)]
        else:
            date_filter = ["date_created", "=", today]
    else:
        date_filter = ["date_created", "=", today]

    base_filters = []
    if date_filter is not None:
        base_filters = base_filters + [date_filter]
    if str(team_filter).lower() != "all":
        base_filters = base_filters + [["custom_team", "=", team_filter]]

    takt_minutes = frappe.db.get_single_value("Production Settings", "custom_takt_time") or 0

    all_opls = frappe.get_all(
        "Order Pick List",
        filters=base_filters,
        fields=["name", "customer", "custom_order_name", "custom_team",
                "custom_total_stems", "custom_status", "custom_schedule_number",
                "docstatus", "creation"],
        order_by="creation desc"
    )

    opl_names = []
    i = 0
    while i < len(all_opls):
        opl_names = opl_names + [all_opls[i].name]
        i = i + 1

    variety_by_opl = {}
    shelf_by_opl = {}
    total_items_by_opl = {}
    issued_items_by_opl = {}
    ready_items_by_opl = {}
    awaiting_items_by_opl = {}

    if len(opl_names) > 0:
        locations = frappe.get_all(
            "Pick List Item",
            filters=[["parent", "in", opl_names]],
            fields=["parent", "item_name", "custom_shelf", "custom_issued",
                    "custom_ready_for_packing", "custom_shelved",
                    "custom_awaiting_transfer", "custom_loaded_in_trolley",
                    "custom_in_transit"]
        )
        i = 0
        while i < len(locations):
            loc = locations[i]
            p = loc.parent

            current_varieties = variety_by_opl.get(p, set())
            variety_by_opl[p] = current_varieties | {loc.item_name}

            shelf = (loc.custom_shelf or "").strip()
            if shelf != "":
                current_shelves = shelf_by_opl.get(p, set())
                shelf_by_opl[p] = current_shelves | {shelf}

            current_total = total_items_by_opl.get(p, 0)
            total_items_by_opl[p] = current_total + 1

            if loc.custom_issued == 1:
                cur = issued_items_by_opl.get(p, 0)
                issued_items_by_opl[p] = cur + 1

            is_ready = loc.custom_ready_for_packing == 1 or loc.custom_shelved == 1
            if is_ready:
                cur = ready_items_by_opl.get(p, 0)
                ready_items_by_opl[p] = cur + 1

            is_awaiting = (loc.custom_awaiting_transfer == 1 or
                           loc.custom_loaded_in_trolley == 1 or
                           loc.custom_in_transit == 1)
            if is_awaiting and loc.custom_shelved != 1:
                cur = awaiting_items_by_opl.get(p, 0)
                awaiting_items_by_opl[p] = cur + 1

            i = i + 1

    expected_boxes_by_opl = {}
    if len(opl_names) > 0:
        so_items = frappe.get_all(
            "Sales Order Item",
            filters=[["custom_opl", "in", opl_names], ["docstatus", "=", 1]],
            fields=["custom_opl", "custom_number_of_boxes"]
        )
        i = 0
        while i < len(so_items):
            item = so_items[i]
            oid = item.custom_opl
            boxes = item.custom_number_of_boxes or 0
            current = expected_boxes_by_opl.get(oid, 0)
            expected_boxes_by_opl[oid] = current + boxes
            i = i + 1

    packed_boxes_by_opl = {}
    packed_stems_by_opl = {}
    if len(opl_names) > 0:
        fpls = frappe.get_all(
            "Farm Pack List",
            filters=[["custom_order_pick_list", "in", opl_names], ["docstatus", "!=", 2]],
            fields=["name", "custom_order_pick_list"]
        )
        i = 0
        while i < len(fpls):
            f = fpls[i]
            oid = f.custom_order_pick_list
            try:
                doc = frappe.get_doc("Farm Pack List", f.name)
                stems = 0
                boxes = set()
                items = doc.pack_list_item or []
                j = 0
                while j < len(items):
                    row = items[j]
                    stems = stems + (row.custom_number_of_stems or 0)
                    if row.box_id:
                        boxes = boxes | {str(row.box_id).strip()}
                    j = j + 1
                cs = packed_stems_by_opl.get(oid, 0)
                packed_stems_by_opl[oid] = cs + stems
                cb = packed_boxes_by_opl.get(oid, 0)
                packed_boxes_by_opl[oid] = cb + len(boxes)
            except:
                pass
            i = i + 1

    partially_allocated = []
    awaiting_transfer = []
    ready_pairs = []
    packed = []

    i = 0
    while i < len(all_opls):
        opl = all_opls[i]
        oid = opl.name

        planned = 0
        try:
            planned = int(float(opl.custom_total_stems or 0))
        except:
            planned = 0
        bunches = planned // 10 if planned > 0 else 0

        ti = total_items_by_opl.get(oid, 0)
        ii = issued_items_by_opl.get(oid, 0)
        issuing_pct = round(ii / ti * 100) if ti > 0 else 0

        ps = packed_stems_by_opl.get(oid, 0)
        packing_pct = round(ps / planned * 100) if planned > 0 else 0
        if packing_pct > 100:
            packing_pct = 100

        eb = expected_boxes_by_opl.get(oid, 0)
        pb = packed_boxes_by_opl.get(oid, 0)
        box_prog = str(pb) + "/" + str(eb) if eb > 0 else "0/0"

        vs = variety_by_opl.get(oid, set())
        variety = "N/A"
        if len(vs) == 1:
            variety = list(vs)[0]
        elif len(vs) > 1:
            variety = "Mixed Varieties"

        ss = shelf_by_opl.get(oid, set())
        shelves = "N/A"
        if len(ss) > 0:
            shelves = ", ".join(sorted(ss))

        n_ready = ready_items_by_opl.get(oid, 0)
        n_awaiting = awaiting_items_by_opl.get(oid, 0)
        sched = 0
        try:
            sched = int(float(opl.custom_schedule_number or 0))
        except:
            sched = 0

        row = {
            "opl_id": oid,
            "order_name": opl.custom_order_name or oid,
            "customer": opl.customer,
            "team": opl.custom_team or "Unassigned",
            "total_bunches": bunches,
            "total_stems": planned,
            "shelf_locations": shelves,
            "variety": variety,
            "issuing_percentage": issuing_pct,
            "packing_percentage": packing_pct,
            "box_progress": box_prog,
            "schedule_number": sched,
            "issued_at": None,
            "staged_at": None,
            "creation": str(opl.creation)
        }

        # classify into one column (progression: packed > ready > awaiting > partial)
        if planned > 0 and packing_pct >= 100:
            packed = packed + [row]
        elif n_ready > 0:
            skey = sched if sched > 0 else 999999
            ready_pairs = ready_pairs + [[skey, str(opl.creation), row]]
        elif n_awaiting > 0:
            awaiting_transfer = awaiting_transfer + [row]
        else:
            partially_allocated = partially_allocated + [row]

        i = i + 1

    # order ready_lines by schedule_number then creation
    ready_sorted = sorted(ready_pairs)
    ready_lines = []
    i = 0
    while i < len(ready_sorted):
        ready_lines = ready_lines + [ready_sorted[i][2]]
        i = i + 1

    frappe.response["message"] = {
        "success": True,
        "takt_minutes": takt_minutes,
        "counts": {
            "partially_allocated": len(partially_allocated),
            "awaiting_transfer": len(awaiting_transfer),
            "ready_lines": len(ready_lines),
            "packed": len(packed)
        },
        "partially_allocated": partially_allocated,
        "awaiting_transfer": awaiting_transfer,
        "ready_lines": ready_lines,
        "packed": packed
    }

except Exception as e:
    frappe.response["message"] = {"success": False, "error": str(e)}
