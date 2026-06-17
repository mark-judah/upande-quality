# Frappe Server Script (Type: API), api_method = getSchedulerMeta
# Companion read endpoint for the Packhouse Scheduler page.
# Returns the global takt threshold + the persisted queue order (custom_schedule_number)
# for the supplied OPL names. getSchedulerData (app method) does not return these.
# Payload: { "names": ["OPL-xxx", ...] }
# Constraints: no return/def/import/+=/.append — use list=list+[x], dict[k]=v

frappe.response["message"] = {"success": False, "error": "Script failed"}

try:
    # names arrive as a "|~|"-joined string (safe_exec blocks json/imports)
    names_raw = frappe.form_dict.get("names") or ""
    names = []
    parts = names_raw.split("|~|")
    p = 0
    while p < len(parts):
        v = parts[p].strip()
        if v != "":
            names = names + [v]
        p = p + 1

    takt = frappe.db.get_single_value("Production Settings", "custom_takt_time") or 0

    schedule = {}
    created = {}
    if names and isinstance(names, list) and len(names) > 0:
        rows = frappe.get_all(
            "Order Pick List",
            filters=[["name", "in", names]],
            fields=["name", "custom_schedule_number", "creation"]
        )
        i = 0
        while i < len(rows):
            r = rows[i]
            num = 0
            try:
                num = int(float(r.custom_schedule_number or 0))
            except:
                num = 0
            schedule[r.name] = num
            created[r.name] = str(r.creation)
            i = i + 1

    # Packed signal = a Farm Pack List exists for the OPL. The getSchedulerData
    # box counts (staged/loaded/labels) are unreliable, so we detect packing here.
    packed = {}
    if names and isinstance(names, list) and len(names) > 0:
        fpls = frappe.get_all("Farm Pack List",
                              filters=[["custom_order_pick_list", "in", names], ["docstatus", "!=", 2]],
                              fields=["custom_order_pick_list"])
        q = 0
        while q < len(fpls):
            on = fpls[q].custom_order_pick_list
            if on:
                packed[on] = 1
            q = q + 1

    frappe.response["message"] = {"success": True, "takt_minutes": takt, "schedule": schedule, "created": created, "packed": packed}

except Exception as e:
    frappe.response["message"] = {"success": False, "error": str(e)}
