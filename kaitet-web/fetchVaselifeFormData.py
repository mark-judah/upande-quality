# Server Script: fetchVaselifeFormData  (Type: API, Method: GET)
#
# Returns all dropdown options for the Vaselife mobile app:
#   breeders, varieties (Items + their breeder link), crops,
#   commercial_statuses, cut_stages, failure_reasons.
#
# DocTypes required (create in Frappe before enabling this script):
#   - Breeder            — existing doctype; name = breeder label
#   - Item               — existing; needs custom_breeder (Link → Breeder)
#   - Vaselife Crop      — simple doctype; name = crop label
#   - Vaselife Commercial Status — simple doctype; name = status label
#   - Vaselife Cut Stage — simple doctype; name = stage label (e.g. "1", "2"…)
#   - Vaselife Failure Reason    — simple doctype; name = reason label

frappe.response["message"] = {"success": False, "error": "Script failed"}

try:
    breeders = frappe.get_all(
        "Breeder",
        fields=["name"],
        order_by="name asc",
    )

    # Varieties = Items in the rose item groups only (not the whole item master).
    # Select custom_breeder only if that Custom Field exists on this site, so the
    # query never crashes on an instance where it hasn't been created yet.
    item_fields = ["name", "item_name", "item_group"]
    if frappe.db.has_column("Item", "custom_breeder"):
        item_fields.append("custom_breeder")

    varieties_raw = frappe.get_all(
        "Item",
        filters={"disabled": 0, "item_group": ["in", ["Spray Roses", "Standard Roses"]]},
        fields=item_fields,
        order_by="item_name asc",
    )
    varieties = [
        {
            "name": v.get("name"),
            "variety": v.get("item_name") or v.get("name"),
            "item_group": v.get("item_group") or "",
            "breeder": v.get("custom_breeder") or "",
        }
        for v in varieties_raw
    ]

    crops = frappe.get_all(
        "Vaselife Crop",
        fields=["name"],
        order_by="name asc",
    )

    commercial_statuses = frappe.get_all(
        "Vaselife Commercial Status",
        fields=["name"],
        order_by="name asc",
    )

    cut_stages = frappe.get_all(
        "Vaselife Cut Stage",
        fields=["name"],
        order_by="name asc",
    )

    failure_reasons = frappe.get_all(
        "Vaselife Failure Reason",
        fields=["name"],
        order_by="name asc",
    )

    # Recent samples — powers the sample-code type-ahead on the observation form.
    samples_raw = frappe.get_all(
        "Vaselife Sample",
        fields=["name", "variety", "sampling_date"],
        order_by="creation desc",
        limit_page_length=300,
    )
    samples = [
        {
            "name": s.get("name"),
            "variety": s.get("variety") or "",
            "sampling_date": str(s.get("sampling_date")) if s.get("sampling_date") else "",
        }
        for s in samples_raw
    ]

    frappe.response["message"] = {
        "success": True,
        "breeders": breeders,
        "varieties": varieties,
        "crops": crops,
        "commercial_statuses": commercial_statuses,
        "cut_stages": cut_stages,
        "failure_reasons": failure_reasons,
        "samples": samples,
    }

except Exception as e:
    frappe.log_error(frappe.get_traceback(), "fetchVaselifeFormData")
    frappe.response["message"] = {"success": False, "error": str(e)}
