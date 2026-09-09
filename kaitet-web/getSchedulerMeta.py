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

    # Packing detection removed 2026-08-05 — the redesigned scheduler no longer has a
    # "packed" column, and the schedulable feed (getSchedulerFeed) is the source of truth.
    frappe.response["message"] = {"success": True, "takt_minutes": takt, "schedule": schedule, "created": created}

except Exception as e:
    frappe.response["message"] = {"success": False, "error": str(e)}
