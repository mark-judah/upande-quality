# Frappe Server Script (Type: API), api_method = getDiscardRequestBuckets
# The discard work-list for a farm: every Discard Request Bucket child row of an
# APPROVED Discard Request for that farm. Powers the app's discard list — the
# operator "can only discard what's on the list". frappe.get_all ignores user
# permissions so any logged-in operator can read it.
# Payload: { "farm": "<Farm>" }  ->  { status, farm, buckets:[...], count }
frappe.response["message"] = {"status": "error", "buckets": []}
try:
    data = frappe.request.get_json() or {}
    farm = data.get("farm")
    if not farm:
        frappe.response["message"] = {"status": "error", "message": "farm is required.", "buckets": []}
    else:
        # The farm lives on the CHILD rows (Discard Request Bucket.farm), not the
        # parent request. So filter bucket rows by farm, keeping only those whose
        # parent Discard Request is Approved.
        approved = frappe.get_all(
            "Discard Request",
            filters={"workflow_state": "Approved"},
            fields=["name"],
            limit_page_length=0,
        )
        approved_names = {}
        i = 0
        while i < len(approved):
            approved_names[approved[i].name] = 1
            i = i + 1

        # Allocated buckets must never be discarded. The request's bucket list is
        # a fetch-time snapshot, so a bucket can get allocated AFTER the request
        # was built — filter against the live (always-fresh, cleared-nightly)
        # Bucket Allocation Status here so a stale request never shows one.
        alloc_rows = frappe.get_all(
            "Bucket Allocation Status",
            filters={},
            fields=["bucket_id"],
            limit_page_length=0,
        )
        allocated = {}
        k = 0
        while k < len(alloc_rows):
            bid = alloc_rows[k].get("bucket_id")
            if bid:
                allocated[bid] = 1
            k = k + 1

        rows = frappe.get_all(
            "Discard Request Bucket",
            filters={"farm": farm, "parenttype": "Discard Request"},
            fields=["bucket_id", "shelf", "variety", "stem_qty", "age_days",
                    "is_shelved", "greenhouse", "stem_length", "parent"],
            limit_page_length=0,
        )
        buckets = []
        j = 0
        while j < len(rows):
            r = rows[j]
            if r.get("bucket_id") and (r.get("parent") in approved_names) and (r.get("bucket_id") not in allocated):
                buckets = buckets + [{
                    "bucket_id": r.get("bucket_id"),
                    "shelf": r.get("shelf"),
                    "variety": r.get("variety"),
                    "stem_qty": r.get("stem_qty"),
                    "age_days": r.get("age_days"),
                    "is_shelved": 1 if r.get("is_shelved") else 0,
                    "greenhouse": r.get("greenhouse"),
                    "stem_length": r.get("stem_length"),
                    "discard_request": r.get("parent"),
                }]
            j = j + 1
        frappe.response["message"] = {"status": "success", "farm": farm, "buckets": buckets, "count": len(buckets)}
except Exception as e:
    frappe.response["message"] = {"status": "error", "message": str(e), "buckets": []}
