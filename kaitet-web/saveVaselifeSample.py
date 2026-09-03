# Server Script: saveVaselifeSample  (Type: API, Method: POST)
#
# Creates a "Vaselife Sample" document with a custom sample code:
#   Format: {Variety}{DDMMYY}{Letter}
#   e.g.    Marisa240826A  →  Marisa on 24 Aug 2026, first sample that day
#           Marisa240826B  →  second Marisa sample same day
#
# DocType "Vaselife Sample" must have autoname = "Prompt" (manual naming).
# See docs/server-scripts/vaselife_setup.md for full DocType definitions.

frappe.response["message"] = {"status": "error", "message": "Script failed"}


def extract_date_suffix(sampling_date):
    """Convert YYYY-MM-DD to DDMMYY for the sample code."""
    parts = (sampling_date or "").split("-")
    if len(parts) == 3:
        return parts[2] + parts[1] + parts[0][2:]
    return frappe.utils.nowdate().replace("-", "")[2:]  # fallback


def num_to_letters(n):
    """Convert 0-based index to A, B, …, Z, AA, AB, … for the sample suffix."""
    result = ""
    n = n + 1
    while n > 0:
        n -= 1
        result = chr(65 + (n % 26)) + result
        n //= 26
    return result


def generate_sample_code(variety, sampling_date):
    """Build the unique sample code and verify it doesn't already exist."""
    variety_slug = (variety or "").replace(" ", "")
    date_suffix = extract_date_suffix(sampling_date)
    prefix = variety_slug + date_suffix             # e.g. "Marisa240826"

    existing = frappe.get_all(
        "Vaselife Sample",
        filters=[["name", "like", prefix + "%"]],
        fields=["name"],
    )
    letter = num_to_letters(len(existing))
    return prefix + letter                          # e.g. "Marisa240826A"


def safe_link(doctype, value):
    """Return value only if a document with that name exists, else None."""
    if not value:
        return None
    return value if frappe.db.exists(doctype, value) else None


def to_float(v):
    try:
        return float(v) if v not in (None, "") else None
    except (ValueError, TypeError):
        return None


def to_int(v):
    try:
        return int(v) if v not in (None, "") else None
    except (ValueError, TypeError):
        return None


try:
    raw = frappe.request.get_json() or {}
    data = raw.get("data", raw)
    frappe.log_error(json.dumps(data, indent=2, default=str), "saveVaselifeSample Payload")

    sampling_date = (data.get("sampling_date") or "").strip()
    variety       = (data.get("variety") or "").strip()

    if not sampling_date:
        frappe.response["message"] = {"status": "error", "message": "sampling_date is required."}
    elif not variety:
        frappe.response["message"] = {"status": "error", "message": "variety is required."}
    elif not frappe.db.exists("Item", variety):
        frappe.response["message"] = {
            "status": "error",
            "message": "Variety '" + variety + "' not found.",
        }
    else:
        sample_code = generate_sample_code(variety, sampling_date)

        sample_doc = frappe.get_doc({
            "doctype":           "Vaselife Sample",
            "name":              sample_code,
            "sampling_date":     sampling_date,
            "consignment":       data.get("consignment") or "",
            "supermarket_date":  data.get("supermarket_date") or None,
            "due_date":          data.get("due_date") or None,
            "vase_date":         data.get("vase_date") or None,
            "variety":           variety,
            "breeder":           safe_link("Breeder", data.get("breeder") or ""),
            "commercial_status": safe_link("Vaselife Commercial Status", data.get("commercial_status") or ""),
            "crop":              safe_link("Vaselife Crop", data.get("crop") or ""),
            "harvest_date":      data.get("harvest_date") or None,
            "harvest_time":      data.get("harvest_time") or None,
            "line_code":         data.get("line_code") or "",
            "farm":              safe_link("Farm", data.get("farm") or ""),
            "gh":                data.get("gh") or "",
            "length":            to_float(data.get("length")),
            "no_of_stems":       to_int(data.get("no_of_stems")),
            "bud_height":        to_float(data.get("bud_height")),
            "bud_width":         to_float(data.get("bud_width")),
            "initial_cut_stage": safe_link("Vaselife Cut Stage", data.get("initial_cut_stage") or ""),
            "prepared_by":       frappe.session.user,
        })

        sample_doc.insert(ignore_permissions=True)
        frappe.db.commit()

        frappe.response["message"] = {
            "status":      "success",
            "name":        sample_doc.name,
            "sample_code": sample_doc.name,
            "message":     "Sample " + sample_doc.name + " saved successfully.",
        }

except Exception as e:
    frappe.log_error(frappe.get_traceback(), "saveVaselifeSample Error")
    frappe.response["message"] = {"status": "error", "message": str(e)}
