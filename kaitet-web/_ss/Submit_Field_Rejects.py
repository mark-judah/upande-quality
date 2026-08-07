variety = frappe.form_dict.get("variety")
no_of_stems = frappe.form_dict.get("no_of_stems")
rejection_reason = frappe.form_dict.get("rejection_reason")
farm = frappe.form_dict.get("farm")
greenhouse = frappe.form_dict.get("greenhouse")

if not variety or not no_of_stems or not rejection_reason or not farm or not greenhouse:
    frappe.throw("Missing required fields: variety, no_of_stems, rejection_reason, farm, greenhouse")

qty = frappe.utils.cint(no_of_stems)
if qty <= 0:
    frappe.throw("Number of stems must be greater than 0")

doc = frappe.get_doc({
    "doctype": "Stock Entry",
    "stock_entry_type": "Field Rejects",
    "posting_date": frappe.utils.today(),
    "posting_time": frappe.utils.nowtime(),
    "company": "Karen Roses",
    "custom_farm": farm,
    "items": [
        {
            "s_warehouse": greenhouse,
            "t_warehouse": "Rejects - KR",
            "item_code": variety,
            "qty": qty,
            "custom_rejection_reason": rejection_reason,
        }
    ]
})

doc.insert()
doc.submit()

frappe.response["message"] = {
    "status": "success",
    "name": doc.name,
    "message": "Field rejection recorded successfully"
}