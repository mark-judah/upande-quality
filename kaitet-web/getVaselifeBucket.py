# Server Script: getVaselifeBucket  (Type: API, Method: POST)
#
# Independent bucket lookup for the Vaselife app.
# Queries the Harvesting Stock Entry for the given bucket_id and returns
# harvest_date, harvest_time, farm, greenhouse, and stem length.
#
# Request body: { "bucket_id": "BKT-001" }
# Response:     { success, bucket_id, harvest_date, harvest_time, farm, greenhouse, length }

frappe.response["message"] = {"success": False, "error": "Script failed"}


def extract_time_string(pt_val):
    """Convert Frappe posting_time (timedelta or string) to HH:MM:SS."""
    if not pt_val:
        return ""
    try:
        raw = str(pt_val)
        if "," in raw:
            raw = raw.split(",")[1].strip()
        if "." in raw:
            raw = raw.split(".")[0]
        parts = raw.strip().split(":")
        if len(parts) == 3:
            return str(parts[0]).zfill(2) + ":" + str(parts[1]).zfill(2) + ":" + str(parts[2]).zfill(2)
        if len(parts) == 2:
            return str(parts[0]).zfill(2) + ":" + str(parts[1]).zfill(2) + ":00"
        return ""
    except Exception:
        return ""


try:
    data = frappe.request.get_json() or {}
    bucket_id = (data.get("bucket_id") or "").strip()

    if not bucket_id:
        frappe.response["message"] = {"success": False, "error": "bucket_id is required."}
    else:
        entry = frappe.db.sql("""
            SELECT posting_date, posting_time,
                   custom_farm, custom_greenhouse, custom_stem_length
            FROM `tabStock Entry`
            WHERE custom_bucket_id = %s
              AND stock_entry_type = 'Harvesting'
              AND docstatus = 1
            ORDER BY creation DESC
            LIMIT 1
        """, (bucket_id,), as_dict=1)

        if not entry:
            frappe.response["message"] = {
                "success": False,
                "error": "No harvest record found for bucket " + bucket_id + ".",
            }
        else:
            e = entry[0]
            frappe.response["message"] = {
                "success": True,
                "bucket_id": bucket_id,
                "harvest_date": str(e.posting_date) if e.posting_date else "",
                "harvest_time": extract_time_string(e.posting_time),
                "farm": e.custom_farm or "",
                "greenhouse": e.custom_greenhouse or "",
                "length": str(e.custom_stem_length) if e.custom_stem_length else "",
            }

except Exception as e:
    frappe.log_error(frappe.get_traceback(), "getVaselifeBucket Error")
    frappe.response["message"] = {"success": False, "error": str(e)}
