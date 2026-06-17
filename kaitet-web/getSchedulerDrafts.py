# Frappe Server Script (Type: API), api_method = getSchedulerDrafts
# getSchedulerData (app method) only returns SUBMITTED (docstatus 1) OPLs, so the
# scheduler never sees drafts — yet drafts are where the transfer flags live
# (awaiting / in-transit / loaded-in-trolley) and also the not-yet-allocated orders.
# This returns DRAFT OPLs for the delivery date with the same shape the board uses,
# so the page can merge them in.
# Payload: { delivery_date: "YYYY-MM-DD" }
# Constraints: no def/import/+= — keep it flat.

frappe.response["message"] = {"success": False, "error": "Script failed"}

try:
    dd = frappe.form_dict.get("delivery_date") or frappe.utils.today()

    opls = frappe.get_all(
        "Order Pick List",
        filters=[["docstatus", "=", 0], ["date_created", "=", dd]],
        fields=["name", "customer", "custom_order_name", "custom_team", "custom_farm",
                "custom_total_stems", "custom_status", "docstatus", "date_created"]
    )

    names = []
    i = 0
    while i < len(opls):
        names = names + [opls[i].name]
        i = i + 1

    locs_by = {}
    if len(names) > 0:
        rows = frappe.get_all(
            "Pick List Item",
            filters=[["parent", "in", names]],
            fields=["parent", "item_code", "item_name", "warehouse", "custom_shelf", "stock_qty",
                    "custom_bucket", "custom_awaiting_transfer", "custom_loaded_in_trolley",
                    "custom_in_transit", "custom_shelved", "custom_issued", "custom_ready_for_packing",
                    "custom_trolley_id", "custom_transit_truck", "modified"]
        )
        j = 0
        while j < len(rows):
            r = rows[j]
            p = r.parent
            if p not in locs_by:
                locs_by[p] = []
            locs_by[p] = locs_by[p] + [r]
            j = j + 1

    out = []
    k = 0
    while k < len(opls):
        o = opls[k]
        d = dict(o)
        d["locations"] = locs_by.get(o.name, [])
        d["staged_boxes"] = 0
        d["loaded_boxes"] = 0
        d["box_labels_count"] = 0
        out = out + [d]
        k = k + 1

    frappe.response["message"] = {"success": True, "data": out}

except Exception as e:
    frappe.response["message"] = {"success": False, "error": str(e)}
