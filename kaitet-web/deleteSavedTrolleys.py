# Frappe Server Script (Type: API), api_method = deleteSavedTrolleys
# Undo a SAVED trolley grouping WITHOUT re-shelving its buckets.
# Clears custom_trolley_id / custom_loaded_in_trolley / custom_awaiting_transfer
# on the trolley's Pick List Item rows, but leaves custom_shelf untouched.
# Only acts on not-yet-loaded trolleys (custom_in_transit != 1); loaded ones
# are skipped and reported back.
# Payload (form params): trolley_ids = "T1|~|T2", farm = "Karen"
# safe_exec: no def/import/+=/.append/parse_json/sql.

frappe.response["message"] = {"status": "error", "message": "Script failed"}

try:
    ids_raw = frappe.form_dict.get("trolley_ids") or ""
    farm = frappe.form_dict.get("farm") or ""

    trolley_ids = []
    parts = ids_raw.split("|~|")
    p = 0
    while p < len(parts):
        v = parts[p].strip()
        if v != "":
            trolley_ids = trolley_ids + [v]
        p = p + 1

    if len(trolley_ids) == 0:
        frappe.response["message"] = {"status": "error", "message": "No trolley ids supplied."}
    else:
        # Scope to the farm's OPLs (drafts carry the trolley grouping), mirroring
        # getSchedulerDrafts.py. If farm is blank, fall back to all draft OPLs.
        opl_filters = [["docstatus", "=", 0]]
        if farm != "":
            opl_filters = opl_filters + [["custom_farm", "=", farm]]
        opls = frappe.get_all("Order Pick List", filters=opl_filters, fields=["name"])
        opl_names = []
        i = 0
        while i < len(opls):
            opl_names = opl_names + [opls[i].name]
            i = i + 1

        cleared_count = 0
        skipped = {}
        if len(opl_names) > 0:
            rows = frappe.get_all(
                "Pick List Item",
                filters=[["parent", "in", opl_names], ["custom_trolley_id", "in", trolley_ids]],
                fields=["name", "custom_trolley_id", "custom_in_transit"],
            )
            j = 0
            while j < len(rows):
                r = rows[j]
                if r.custom_in_transit == 1:
                    skipped[r.custom_trolley_id] = 1
                else:
                    frappe.db.set_value("Pick List Item", r.name, {
                        "custom_trolley_id": "",
                        "custom_loaded_in_trolley": 0,
                        "custom_awaiting_transfer": 0,
                    }, update_modified=True)
                    cleared_count = cleared_count + 1
                j = j + 1

        skipped_loaded = []
        for k in skipped:
            skipped_loaded = skipped_loaded + [k]

        frappe.response["message"] = {
            "status": "success",
            "cleared_count": cleared_count,
            "skipped_loaded": skipped_loaded,
        }

except Exception as e:
    frappe.response["message"] = {"status": "error", "message": str(e)}
