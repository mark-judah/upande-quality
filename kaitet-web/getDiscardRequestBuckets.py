# Frappe Server Script (Type: API), api_method = getDiscardRequestBuckets
# The discard work-list for a farm: Discard Request Bucket child rows of an
# APPROVED Discard Request whose bucket is STILL PHYSICALLY ON A SHELF AT THAT
# FARM. The operator "can only discard what's on the list", and can only discard
# what's actually on the shelf in front of them. frappe.get_all ignores user
# permissions so any logged-in operator can read it.
# Payload: { "farm": "<Farm>" }  ->  { status, farm, buckets:[...], count }
#
# Why "currently on a shelf at the farm" is the right filter (not "ever
# discarded"): buckets are REUSED across many harvest cycles. A bucket discarded
# in a PRIOR cycle can be re-harvested, re-shelved, re-aged and legitimately
# re-listed — the old "ever-discarded" exclusion wrongly hid all of those, badly
# under-reporting the list. The live `Shelf Item` is the physical truth: a bucket
# that has been discarded / issued / transferred away has NO Shelf Item at this
# farm, while a re-shelved bucket has a fresh one. Allocated buckets are also
# excluded (reserved for an order, must not be discarded).
frappe.response["message"] = {"status": "error", "buckets": []}
try:
    data = frappe.request.get_json() or {}
    farm = data.get("farm")
    if not farm:
        frappe.response["message"] = {"status": "error", "message": "farm is required.", "buckets": []}
    else:
        # Approved requests: name -> creation, so a bucket listed on several
        # requests resolves to the LATEST one (max creation).
        approved = frappe.get_all(
            "Discard Request",
            filters={"workflow_state": "Approved"},
            fields=["name", "creation"],
            limit_page_length=0,
        )
        approved_names = {}
        i = 0
        while i < len(approved):
            approved_names[approved[i].name] = str(approved[i].creation or "")
            i = i + 1

        # Live shelf state at THIS farm — the physical set of buckets currently on
        # a shelf whose farm = the requested farm AND that have been sitting there
        # long enough to be discardable. Discarded / issued / transferred buckets
        # aren't here; a re-shelved (reused) bucket IS here but only qualifies once
        # its CURRENT occupancy has aged past `discard_age` — so a bucket that was
        # discarded in a prior cycle and freshly re-shelved with new flowers is not
        # flagged for discard while those flowers are still fresh. Age = now minus
        # Shelf Item.date_added (how long the current flowers have sat on the shelf,
        # matching how the nightly Auto Discard Request selects). UPPER()-folded
        # because bucket_id casing is inconsistent across tables.
        # Age basis = the bucket's LATEST Harvesting Stock Entry (falling back to
        # when the current flowers were shelved), exactly as the nightly Auto
        # Discard Request selects. Using the latest harvest makes reuse correct: a
        # re-harvested bucket is measured on its NEW flowers, so it only qualifies
        # once those have aged past discard_age.
        discard_age = frappe.db.get_single_value('Production Settings', 'discard_age')
        if not discard_age:
            discard_age = 5.0
        cutoff = frappe.utils.add_days(frappe.utils.nowdate(), -int(float(discard_age)))
        shelf_rows = frappe.db.sql(
            """SELECT DISTINCT UPPER(si.bucket_id) AS b
               FROM `tabShelf Item` si
               JOIN `tabShelf` sh ON sh.name = si.parent
               LEFT JOIN (
                   SELECT custom_bucket_id, MAX(posting_date) AS hd
                   FROM `tabStock Entry`
                   WHERE stock_entry_type = 'Harvesting'
                     AND custom_bucket_id IS NOT NULL AND custom_bucket_id != ''
                   GROUP BY custom_bucket_id
               ) h ON UPPER(h.custom_bucket_id) = UPPER(si.bucket_id)
               WHERE sh.farm = %s AND si.bucket_id IS NOT NULL AND si.bucket_id != ''
                 AND COALESCE(h.hd, DATE(si.date_added)) <= %s""",
            (farm, cutoff), as_dict=True,
        )
        on_shelf = {}
        s = 0
        while s < len(shelf_rows):
            b = shelf_rows[s].get("b")
            if b:
                on_shelf[b] = 1
            s = s + 1

        # Allocated buckets must never be discarded — checked against the live
        # (cleared-nightly) Bucket Allocation Status. UPPER()-folded.
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
                allocated[str(bid).upper()] = 1
            k = k + 1

        rows = frappe.get_all(
            "Discard Request Bucket",
            filters={"farm": farm, "parenttype": "Discard Request"},
            fields=["bucket_id", "shelf", "variety", "stem_qty", "age_days",
                    "is_shelved", "greenhouse", "stem_length", "parent"],
            limit_page_length=0,
        )
        # De-duplicate: a bucket can appear on several Approved requests (nightly
        # re-lists + manual). Keep only the row from the LATEST request (max
        # creation), keyed case-insensitively by bucket id.
        best = {}
        best_created = {}
        j = 0
        while j < len(rows):
            r = rows[j]
            bid = r.get("bucket_id")
            parent = r.get("parent")
            created = approved_names.get(parent) or ""
            up = str(bid).upper() if bid else ""
            # parent Approved (created truthy) AND currently on a shelf at this
            # farm AND not allocated.
            if bid and created and (up in on_shelf) and (up not in allocated):
                key = str(bid).lower()
                if (key not in best) or (created > best_created.get(key, "")):
                    best[key] = {
                        "bucket_id": bid,
                        "shelf": r.get("shelf"),
                        "variety": r.get("variety"),
                        "stem_qty": r.get("stem_qty"),
                        "age_days": r.get("age_days"),
                        "is_shelved": 1 if r.get("is_shelved") else 0,
                        "greenhouse": r.get("greenhouse"),
                        "stem_length": r.get("stem_length"),
                        "discard_request": parent,
                    }
                    best_created[key] = created
            j = j + 1
        buckets = list(best.values())
        frappe.response["message"] = {"status": "success", "farm": farm, "buckets": buckets, "count": len(buckets)}
except Exception as e:
    frappe.response["message"] = {"status": "error", "message": str(e), "buckets": []}
