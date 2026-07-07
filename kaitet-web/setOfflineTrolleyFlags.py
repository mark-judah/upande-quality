# Frappe Server Script (Type: API), api_method = setOfflineTrolleyFlags
# Additive-only sync for the offline Bucket Requests app. Marks specific
# Pick List Item rows as loaded-in-trolley or in-transit WITHOUT touching any
# other field and WITHOUT submitting the OPL (stays draft). Targets exact rows
# by their Pick List Item name (the app stored pick_list_item_id at download),
# so bucket-QR reuse can never hit the wrong OPL.
# Payload: { "data": { "pli_ids": ["<name>", ...], "flag": "loaded" | "transit" } }

frappe.response["message"] = {"status": "error", "message": "Script failed"}

try:
    data = frappe.request.get_json()
    if isinstance(data, dict) and "data" in data:
        data = data.get("data")
    data = data or {}

    pli_ids = data.get("pli_ids") or []
    flag = data.get("flag") or ""

    field = None
    if flag == "loaded":
        field = "custom_loaded_in_trolley"
    elif flag == "transit":
        field = "custom_in_transit"

    if not field:
        frappe.response["message"] = {"status": "error", "message": "Invalid flag (expected 'loaded' or 'transit')."}
    elif not pli_ids:
        frappe.response["message"] = {"status": "error", "message": "No pick list items supplied."}
    else:
        updated = 0
        missing = 0
        i = 0
        while i < len(pli_ids):
            name = pli_ids[i]
            if name and frappe.db.exists("Pick List Item", name):
                # Additive only: set the one flag to 1, leave everything else.
                frappe.db.set_value("Pick List Item", name, field, 1, update_modified=True)
                updated = updated + 1
            else:
                missing = missing + 1
            i = i + 1
        frappe.db.commit()
        frappe.response["message"] = {"status": "success", "updated": updated, "missing": missing, "flag": flag}

except Exception as e:
    frappe.response["message"] = {"status": "error", "message": str(e)}
