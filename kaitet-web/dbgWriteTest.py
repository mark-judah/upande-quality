# TEMP diagnostic (Type: API), api_method = dbgWriteTest — self-reverting.
# Proves whether frappe.db.set_value persists on a Pick List Item that belongs
# to a SUBMITTED Order Pick List. Flips custom_loaded_in_trolley, reads it back,
# then restores the original value. Net change = zero.
# Payload: trolley_id = "2f884a"

frappe.response["message"] = {"status": "error", "message": "Script failed"}

try:
    tid = frappe.form_dict.get("trolley_id") or "2f884a"

    rows = frappe.get_all(
        "Pick List Item",
        filters=[["custom_trolley_id", "=", tid], ["custom_in_transit", "=", 0]],
        fields=["name", "parent", "custom_loaded_in_trolley"],
        limit_page_length=1,
    )

    if len(rows) == 0:
        frappe.response["message"] = {"status": "error", "message": "No not-in-transit row for " + tid}
    else:
        name = rows[0].name
        parent = rows[0].parent
        before = frappe.db.get_value("Pick List Item", name, "custom_loaded_in_trolley")
        parent_docstatus = frappe.db.get_value("Order Pick List", parent, "docstatus")

        # write 0
        frappe.db.set_value("Pick List Item", name, "custom_loaded_in_trolley", 0, update_modified=False)
        after = frappe.db.get_value("Pick List Item", name, "custom_loaded_in_trolley")

        # restore
        frappe.db.set_value("Pick List Item", name, "custom_loaded_in_trolley", before, update_modified=False)
        final = frappe.db.get_value("Pick List Item", name, "custom_loaded_in_trolley")

        frappe.response["message"] = {
            "status": "success",
            "row": name,
            "parent": parent,
            "parent_docstatus": parent_docstatus,
            "before": before,
            "after_set_0": after,
            "after_restore": final,
        }

except Exception as e:
    frappe.response["message"] = {"status": "error", "message": str(e)}
