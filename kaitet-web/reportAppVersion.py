# reportAppVersion
# Record one Mobile App Version Log row per authenticated user per day.
# Sandbox rules:
#   - no imports
#   - no return statements (set frappe.response instead)
#   - no augmented assignment, no in-place slicing
#   - no hasattr/isinstance, no os/file/exec
#   - use str() for date conversions

user = frappe.session.user

if user == "Guest":
    frappe.throw("Authentication required.")

data = frappe.form_dict or {}
app_version = data.get("app_version")
platform = data.get("platform")
device_model = data.get("device_model")

if not app_version:
    frappe.throw("app_version is required.")

today_str = str(frappe.utils.today())
now_str = str(frappe.utils.now())

existing = frappe.db.get_all(
    "Mobile App Version Log",
    filters={
        "user": user,
        "reported_on": [">=", today_str + " 00:00:00"],
    },
    fields=["name"],
    limit_page_length=1,
    order_by="reported_on desc",
)

if existing:
    log_name = existing[0]["name"]
    frappe.db.set_value(
        "Mobile App Version Log",
        log_name,
        {
            "app_version": app_version,
            "platform": platform,
            "device_model": device_model,
            "reported_on": now_str,
        },
    )
    action = "updated"
else:
    doc = frappe.get_doc({
        "doctype": "Mobile App Version Log",
        "user": user,
        "app_version": app_version,
        "platform": platform,
        "device_model": device_model,
        "reported_on": now_str,
    })
    doc.insert(ignore_permissions=True)
    log_name = doc.name
    action = "created"

frappe.response["message"] = {
    "ok": True,
    "name": log_name,
    "action": action,
    "user": user,
    "app_version": app_version,
}
