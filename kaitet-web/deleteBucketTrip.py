# Delete a Bucket Request Trip. Called via frappe.call -> args in form_dict.
name = frappe.form_dict.get("name")
if name and frappe.db.exists("Bucket Request Trip", name):
    frappe.delete_doc("Bucket Request Trip", name, ignore_permissions=True, force=1)
    frappe.db.commit()
    frappe.response["message"] = {"status": "success"}
else:
    frappe.response["message"] = {"status": "error", "message": "Trip not found."}
