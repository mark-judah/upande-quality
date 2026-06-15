# Frappe Server Script (Type: API), api_method = soMgrExpandSpec
# Expand a Specifications doc into SO item rows.
# Params: spec, customer (optional).
# Spec Box Item child fields (introspected live): variety, length, box_type,
#   bunches_per_box, pack_rate, colour, bunch_type, stems_per_bunch.
# Each box_items row = one box. custom_ordered_quantity = pack_rate * boxes(1).
# For Mixed Box assortment: custom_mixed_box=1, mix group/name = spec name.
# safe_exec: no import / def / += / list.append / sql. Flat while-loops only.

frappe.response["message"] = {"success": False, "error": "Script failed"}
try:
    spec = frappe.form_dict.get("spec")
    if not spec:
        frappe.response["message"] = {"success": False, "error": "spec is required"}
    else:
        doc = frappe.get_doc("Specifications", spec)
        assortment = doc.get("box_assortment")
        is_mixed = (assortment == "Mixed Box")
        spec_name = doc.get("spec_name") or doc.name

        rows = []
        bi = doc.get("box_items") or []
        i = 0
        while i < len(bi):
            b = bi[i]
            pr = b.get("pack_rate") or 0
            boxes = 1
            row = {
                "item_code": b.get("variety"),
                "custom_length": b.get("length"),
                "custom_box_type": b.get("box_type"),
                "custom_packrate": pr,
                "custom_number_of_boxes": boxes,
                "custom_ordered_quantity": pr * boxes,
            }
            if is_mixed:
                row["custom_mixed_box"] = 1
                row["custom_packrate_mixed_box"] = pr
                row["custom_mix_group"] = spec_name
                row["custom_mix_name"] = spec_name
            else:
                row["custom_mixed_box"] = 0
            rows = rows + [row]
            i = i + 1

        frappe.response["message"] = {"success": True, "data": {
            "assortment": assortment, "rows": rows}}
except Exception as e:
    frappe.response["message"] = {"success": False, "error": str(e)}
