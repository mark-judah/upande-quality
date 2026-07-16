
data = frappe.form_dict


def to_number(val, field_label):
    if val in (None, ""):
        return None
    try:
        return float(val)
    except (TypeError, ValueError):
        frappe.throw(field_label + " must be a number, got: " + repr(val))


def check_exists(doctype, value, label):
    if value and not frappe.db.exists(doctype, value):
        frappe.throw(label + " " + repr(value) + " was not found in " + doctype + ".")


def location_prefix(text):
    if not text:
        return ""
    t = text
    if " - " in t:
        t = t.rsplit(" - ", 1)[0]
    for clip in ["GH", "Receiving", "Cold"]:
        if clip in t:
            t = t.split(clip)[0].strip()
            break
    return t.strip()


age_threshold = to_number(data.get("age_threshold"), "Age Threshold")
if age_threshold is None:
    age_threshold = 5.0

age_unit = (data.get("age_unit") or "Days").strip()
if age_unit not in ("Hours", "Days"):
    frappe.throw("Age Unit must be 'Hours' or 'Days', got: " + repr(age_unit))

threshold_days = age_threshold / 24.0 if age_unit == "Hours" else age_threshold

variety    = (data.get("variety") or "").strip()
item_group = (data.get("item_group") or "").strip()
farm       = (data.get("farm") or "").strip()
company    = (data.get("company") or "").strip()
length     = (data.get("length") or "").strip()
coldroom   = (data.get("coldroom") or "").strip()

check_exists("Item", variety, "Variety")
check_exists("Item Group", item_group, "Item Group")
check_exists("Farm", farm, "Farm")
check_exists("Company", company, "Company")
check_exists("Stem Length", length, "Length")
check_exists("Warehouse", coldroom, "Cold Room")

coldroom_location = location_prefix(coldroom) if coldroom else ""

# Build WHERE clause
conditions = []
params = {}

if variety:
    conditions.append("si.variety = %(variety)s")
    params["variety"] = variety
if length:
    conditions.append("si.stem_length = %(length)s")
    params["length"] = length
if farm:
    conditions.append("sh.farm = %(farm)s")
    params["farm"] = farm
if company:
    conditions.append("fm.company = %(company)s")
    params["company"] = company
if item_group:
    conditions.append("it.item_group = %(item_group)s")
    params["item_group"] = item_group

where_clause = ("WHERE " + " AND ".join(conditions)) if conditions else ""

# ---------------------------------------------------------------
# Join Stock Entry (Harvesting) to get the true harvest date for
# each bucket. MAX(posting_date) = the most recent harvest which
# is when the CURRENT flowers were cut and placed in the bucket.
# date_added in tabShelf Item gets overwritten on every re-shelving
# event and is NOT reliable for age calculation.
# ---------------------------------------------------------------
rows = frappe.db.sql(
    "SELECT si.bucket_id, si.parent AS shelf, si.date_added, si.variety,"
    " si.stem_qty, si.stem_length, si.greenhouse,"
    " sh.farm AS farm, fm.company AS company, it.item_group AS item_group,"
    " se_h.harvest_date AS harvest_date"
    " FROM `tabShelf Item` si"
    " INNER JOIN `tabShelf` sh ON sh.name = si.parent"
    " LEFT JOIN `tabFarm` fm ON fm.name = sh.farm"
    " LEFT JOIN `tabItem` it ON it.name = si.variety"
    " LEFT JOIN ("
    "   SELECT custom_bucket_id, MAX(posting_date) AS harvest_date"
    "   FROM `tabStock Entry`"
    "   WHERE stock_entry_type = 'Harvesting'"
    "   AND custom_bucket_id IS NOT NULL"
    "   AND custom_bucket_id != ''"
    "   GROUP BY custom_bucket_id"
    " ) se_h ON se_h.custom_bucket_id = si.bucket_id"
    " " + where_clause +
    " LIMIT 5000",
    params, as_dict=True
)

# ---------------------------------------------------------------
# Allocated buckets must NOT be discarded. Any bucket that appears in
# Bucket Allocation Status is currently allocated to an order and is skipped.
# The table is cleared every midnight, so the whole (always-fresh) list is
# used — no date/status filtering needed.
# ---------------------------------------------------------------
allocated_rows = frappe.db.sql(
    "SELECT DISTINCT bucket_id AS bid FROM `tabBucket Allocation Status`"
    " WHERE bucket_id IS NOT NULL AND bucket_id != ''",
    as_dict=True
)
allocated = {}
for a in allocated_rows:
    allocated[a.get("bid")] = 1

# ---------------------------------------------------------------
# Per-bucket age + coldroom filtering.
# Age is based on harvest_date (from Stock Entry) when available;
# falls back to date_added only when no harvest record exists.
# ---------------------------------------------------------------
now = frappe.utils.now_datetime()
qualifying = []
no_harvest_count = 0
allocated_skipped = 0

for r in rows:
    # Skip buckets that are allocated to an order (present in Bucket Allocation Status).
    if r.get("bucket_id") in allocated:
        allocated_skipped += 1
        continue

    harvest_date = r.get("harvest_date")

    if harvest_date:
        # posting_date comes back as a Python date object from MySQL
        hd = frappe.utils.getdate(harvest_date)
        age_days = (now.date() - hd).days + 0.0
        date_source = "harvest"
    elif r.get("date_added"):
        # Fallback: use shelf date_added (less reliable — resets on re-shelving)
        added = frappe.utils.get_datetime(r["date_added"])
        age_days = (now - added).total_seconds() / 86400.0
        date_source = "shelved"
    else:
        continue

    if age_days < threshold_days:
        continue

    if coldroom_location and location_prefix(r.get("greenhouse")) != coldroom_location:
        continue

    if date_source == "shelved":
        no_harvest_count += 1

    r["age_days"]    = round(age_days, 2)
    r["age_hours"]   = round(age_days * 24, 1)
    r["date_source"] = date_source
    qualifying.append(r)

qualifying.sort(key=lambda r: -r["age_days"])

frappe.response["message"] = {
    "success": True,
    "shelf_items": qualifying,
    "total_scanned": len(rows),
    "total_qualifying": len(qualifying),
    "buckets_without_harvest_entry": no_harvest_count,
    "allocated_skipped": allocated_skipped,
    "applied_filters": {
        "age_threshold": age_threshold,
        "age_unit": age_unit,
        "variety": variety,
        "item_group": item_group,
        "farm": farm,
        "company": company,
        "length": length,
        "coldroom": coldroom,
    },
}
