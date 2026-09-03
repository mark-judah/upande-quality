# Server Script: saveVaselifeObservation  (Type: API, Method: POST)
#
# Creates a "Vaselife Observation" document linked to a Vaselife Sample.
#
# DocType "Vaselife Observation" must exist with naming series: VO-.YYYY.-.####
# Fields (field_name → Frappe field type):
#   sample              Link → Vaselife Sample   required
#   date                Date                      required
#   stems_failed        Int
#   failure_reasons     Long Text  (JSON array of reason strings)
#   notes               Text       (QC remarks)
#   prepared_by         Data
#
# failure_reasons is stored as a JSON-encoded list, e.g.:
#   '["Botrytis", "Bent Neck"]'

frappe.response["message"] = {"status": "error", "message": "Script failed"}

try:
    raw = frappe.request.get_json() or {}
    data = raw.get("data", raw)
    frappe.log_error(json.dumps(data, indent=2, default=str), "saveVaselifeObservation Payload")

    sample_code  = (data.get("sample_code") or "").strip()
    obs_date     = (data.get("date") or "").strip()

    if not sample_code:
        frappe.response["message"] = {"status": "error", "message": "sample_code is required."}
    elif not obs_date:
        frappe.response["message"] = {"status": "error", "message": "date is required."}
    elif not frappe.db.exists("Vaselife Sample", sample_code):
        frappe.response["message"] = {
            "status": "error",
            "message": "Sample '" + sample_code + "' not found.",
        }
    else:
        stems_failed = data.get("stems_failed")
        try:
            stems_failed = int(stems_failed) if stems_failed not in (None, "") else 0
        except (ValueError, TypeError):
            stems_failed = 0

        # failure_reasons arrives as a list of strings; persist as JSON.
        reasons_raw = data.get("failure_reasons") or []
        if not isinstance(reasons_raw, list):
            reasons_raw = []
        reasons_json = json.dumps(reasons_raw)

        obs_doc = frappe.get_doc({
            "doctype":          "Vaselife Observation",
            "sample":           sample_code,
            "date":             obs_date,
            "stems_failed":     stems_failed,
            "failure_reasons":  reasons_json,
            "notes":            data.get("notes") or "",
            "prepared_by":      frappe.session.user,
        })

        obs_doc.insert(ignore_permissions=True)
        frappe.db.commit()

        frappe.response["message"] = {
            "status":  "success",
            "name":    obs_doc.name,
            "message": "Observation " + obs_doc.name + " saved for sample " + sample_code + ".",
        }

except Exception as e:
    frappe.log_error(frappe.get_traceback(), "saveVaselifeObservation Error")
    frappe.response["message"] = {"status": "error", "message": str(e)}
