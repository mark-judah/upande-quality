# Server Script (API), api_method = getDeviceTelemetry — latest row per device_id.
# Reads via frappe.get_all (bypasses the doctype read-permission check) so an
# IT User Admin can view telemetry without System Manager. Gated to
# IT User Admin / System Manager.
frappe.response["message"] = {"status": "error", "devices": []}
try:
    my = frappe.get_all(
        "Has Role",
        filters={"parent": frappe.session.user, "parenttype": "User"},
        fields=["role"],
        limit_page_length=0,
    )
    roles = {}
    i = 0
    while i < len(my):
        roles[my[i].role] = 1
        i = i + 1
    if ("IT User Admin" not in roles) and ("System Manager" not in roles):
        frappe.response["message"] = {"status": "forbidden", "devices": []}
    else:
        rows = frappe.get_all(
            "Device Telemetry",
            fields=["device_id", "device_name", "model", "brand", "os", "os_version",
                    "app_version", "build", "ota_update_id", "ota_channel", "battery_level",
                    "battery_state", "network_type", "cellular_generation", "is_connected",
                    "captured_at", "creation"],
            order_by="creation desc",
            limit_page_length=2000,
        )
        seen = {}
        out = []
        j = 0
        while j < len(rows):
            r = rows[j]
            key = r.get("device_id") or str(r.get("creation"))
            if key not in seen:
                seen[key] = 1
                row = dict(r)
                row["creation"] = str(r.get("creation"))
                row["captured_at"] = str(r.get("captured_at"))
                out = out + [row]
            j = j + 1
        frappe.response["message"] = {"status": "success", "devices": out, "count": len(out)}
except Exception as e:
    frappe.response["message"] = {"status": "error", "message": str(e), "devices": []}
