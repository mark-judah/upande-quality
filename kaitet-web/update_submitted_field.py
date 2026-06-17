# Frappe Server Script (Type: API), api_method = update_submitted_field
# Directly patches a single field on a (possibly submitted) document via
# frappe.db.set_value — bypasses the submit lock and doc validation.
# Scoped to the Avocado Proforma Invoice doctypes so it can't be used to
# rewrite arbitrary records.
# Payload: { target_doctype, docname, fieldname, value }
# Constraints: no import / def / += — keep it flat.

frappe.response["message"] = {"success": False, "error": "Script failed"}

try:
    dt = frappe.form_dict.get("target_doctype")
    dn = frappe.form_dict.get("docname")
    fieldname = frappe.form_dict.get("fieldname")
    value = frappe.form_dict.get("value")

    allowed = ["Avocado Proforma Invoice", "Avocado Proforma Invoice Item"]

    if dt not in allowed:
        frappe.response["message"] = {"success": False, "error": "Doctype not allowed: " + str(dt)}
    elif not dn or not fieldname:
        frappe.response["message"] = {"success": False, "error": "Missing docname or fieldname"}
    elif not frappe.db.exists(dt, dn):
        frappe.response["message"] = {"success": False, "error": str(dn) + " not found"}
    else:
        # Direct column write — no validate(), no on_update(), no submit guard.
        frappe.db.set_value(dt, dn, fieldname, value)
        frappe.db.commit()
        frappe.response["message"] = {"success": True, "fieldname": fieldname, "value": value}

except Exception as e:
    frappe.response["message"] = {"success": False, "error": str(e)}
