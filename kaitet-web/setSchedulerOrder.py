# Frappe Server Script (Type: API), api_method = setSchedulerOrder
# Persists the drag order of the Ready Lines column.
# Payload: { "order": ["OPL-xxx", "OPL-yyy", ...] }  (top -> bottom)
# Writes custom_schedule_number = 1..N onto each OPL in that order.
# Constraints: no return/def/import/+=/.append — use list = list + [x], dict[k]=v

frappe.response["message"] = {"success": False, "error": "Script failed"}

try:
    # order arrives as a "|~|"-joined string (safe_exec blocks json/imports)
    order_raw = frappe.form_dict.get("order") or ""
    order = []
    parts = order_raw.split("|~|")
    p = 0
    while p < len(parts):
        v = parts[p].strip()
        if v != "":
            order = order + [v]
        p = p + 1

    if not order:
        frappe.response["message"] = {"success": False, "error": "No order provided"}
    else:
        updated = 0
        i = 0
        while i < len(order):
            oid = order[i]
            if frappe.db.exists("Order Pick List", oid):
                frappe.db.set_value("Order Pick List", oid, "custom_schedule_number", i + 1)
                updated = updated + 1
            i = i + 1
        frappe.db.commit()
        frappe.response["message"] = {"success": True, "updated": updated}

except Exception as e:
    frappe.response["message"] = {"success": False, "error": str(e)}
