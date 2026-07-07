# Server Script (API), api_method = reportDeviceTelemetry
# Inserts one Device Telemetry record from the posted payload. Fail-safe, no submit.
# Payload: { "data": { device_id, model, os, app_version, ... , captured_at, is_connected } }
frappe.response["message"] = {"status": "error", "message": "Script failed"}
try:
    data = frappe.request.get_json()
    if isinstance(data, dict) and "data" in data:
        data = data.get("data")
    data = data or {}

    fields = [
        "device_id", "device_name", "model", "brand", "os", "os_version",
        "app_name", "app_version", "build", "ota_update_id", "ota_channel", "battery_level",
        "battery_state", "network_type", "cellular_generation", "captured_at",
    ]
    doc = {"doctype": "Device Telemetry"}
    i = 0
    while i < len(fields):
        f = fields[i]
        doc[f] = data.get(f)
        i = i + 1
    doc["is_connected"] = 1 if data.get("is_connected") else 0
    # Device sends ISO-8601 with a 'Z'/'T' which MySQL Datetime rejects — normalise
    # to 'YYYY-MM-DD HH:MM:SS.ffffff'.
    ts = data.get("captured_at")
    doc["captured_at"] = str(ts).replace("T", " ").replace("Z", "")[:26] if ts else None
    doc["raw_json"] = json.dumps(data)

    d = frappe.get_doc(doc)
    d.insert(ignore_permissions=True)
    frappe.db.commit()
    frappe.response["message"] = {"status": "success", "name": d.name}
except Exception as e:
    frappe.response["message"] = {"status": "error", "message": str(e)}
