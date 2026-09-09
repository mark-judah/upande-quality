# Auto Discard Request  (Scheduler Event, Cron 0 0 * * * = midnight)
# For every shelved bucket whose age (harvest -> now) >= Production Settings
# `discard_age` days, create a Discard Request PER FARM and auto-approve it by
# walking the "Discard Request Approval" workflow one edge at a time — Draft ->
# Pending Approval -> Approved — via plain save()/submit(). Jumping straight
# from Draft to Approved fails workflow-graph validation ("Workflow State
# transition not allowed from Draft to Approved"), since the workflow only
# defines Draft->Pending Approval and Pending Approval->Approved as valid
# edges; that check runs on every save/submit regardless of how the field is
# set, so each edge must be applied as its own save. (Note:
# frappe.model.workflow.apply_workflow is NOT usable here — it resolves to
# None in the Server Script sandbox.) Reuses the same bucket-by-age logic as
# the manual "Fetch Buckets" (get_shelf_items_for_discard): age from the
# bucket's Harvesting Stock Entry posting_date, falling back to Shelf
# Item.date_added.
#
# Idempotency is PER BUCKET, not per farm: a bucket already sitting on an OPEN
# (non-cancelled, non-rejected) Discard Request is skipped, so a still-shelved
# aged bucket is not re-listed on a fresh request every night. Only buckets not
# yet on any open request get a new request. (Discarded buckets are already off
# the shelf, so they never re-enter the age scan.)
try:
    discard_age = frappe.db.get_single_value('Production Settings', 'discard_age')
    if not discard_age:
        discard_age = 5.0
    threshold_days = float(discard_age)

    today = frappe.utils.today()
    run_user = frappe.session.user

    # ── Buckets already on an OPEN discard request (skip these) ───────────────
    #    Open = not cancelled (docstatus != 2) and not Rejected. A bucket only on
    #    rejected/cancelled requests may be re-listed. Keyed case-insensitively.
    open_reqs = frappe.get_all(
        "Discard Request",
        filters={"docstatus": ["!=", 2], "workflow_state": ["!=", "Rejected"]},
        fields=["name"], limit_page_length=0,
    )
    open_names = [o["name"] for o in open_reqs]
    already_listed = {}
    if open_names:
        exrows = frappe.get_all(
            "Discard Request Bucket",
            filters={"parent": ["in", open_names], "parenttype": "Discard Request"},
            fields=["bucket_id"], limit_page_length=0,
        )
        for er in exrows:
            b = er.get("bucket_id")
            if b:
                already_listed[str(b).lower()] = 1

    rows = frappe.db.sql("""
        SELECT si.bucket_id, si.parent AS shelf, si.date_added, si.variety,
               si.stem_qty, si.stem_length, si.greenhouse,
               sh.farm AS farm,
               se_h.harvest_date AS harvest_date
        FROM `tabShelf Item` si
        INNER JOIN `tabShelf` sh ON sh.name = si.parent
        LEFT JOIN (
            SELECT custom_bucket_id, MAX(posting_date) AS harvest_date
            FROM `tabStock Entry`
            WHERE stock_entry_type = 'Harvesting'
              AND custom_bucket_id IS NOT NULL AND custom_bucket_id != ''
            GROUP BY custom_bucket_id
        ) se_h ON se_h.custom_bucket_id = si.bucket_id
        WHERE si.bucket_id IS NOT NULL AND si.bucket_id != ''
        LIMIT 20000
    """, as_dict=True)

    now = frappe.utils.now_datetime()
    by_farm = {}
    for r in rows:
        bid = r.get("bucket_id")
        # Skip buckets already on an open request (and de-dupe within this run).
        if str(bid).lower() in already_listed:
            continue

        hd = r.get("harvest_date")
        if hd:
            age_days = (now.date() - frappe.utils.getdate(hd)).days + 0.0
        elif r.get("date_added"):
            age_days = (now - frappe.utils.get_datetime(r["date_added"])).total_seconds() / 86400.0
        else:
            continue
        if age_days < threshold_days:
            continue

        farm = r.get("farm") or "Unknown"
        row = {
            "bucket_id": bid,
            "farm": farm,
            "greenhouse": r.get("greenhouse"),
            "shelf": r.get("shelf"),
            "is_shelved": 1,
            "harvest_date": r.get("date_added"),
            "age_days": round(age_days, 2),
            "age_hours": round(age_days * 24, 1),
            "variety": r.get("variety"),
            "stem_qty": r.get("stem_qty"),
            "stem_length": r.get("stem_length"),
        }
        if farm not in by_farm:
            by_farm[farm] = []
        by_farm[farm].append(row)
        # Mark as listed so the same bucket can't be added twice within this run.
        already_listed[str(bid).lower()] = 1

    created = []
    failed = []
    for farm in by_farm:
        buckets = by_farm[farm]
        if not buckets:
            continue
        try:
            doc = frappe.get_doc({
                "doctype": "Discard Request",
                "age_threshold": discard_age,
                "age_unit": "Days",
                "requested_by": run_user,
                "requested_date": today,
                "company": "Karen Roses",
                "workflow_state": "Draft",
                "buckets": buckets,
            })
            doc.insert(ignore_permissions=True)

            # frappe.model.workflow.apply_workflow isn't reachable from the
            # Server Script sandbox (resolves to None there). Walk the same
            # two edges the workflow defines directly via save()/submit()
            # instead — each individual state change is still validated
            # against the workflow's transition graph, so jumping straight
            # Draft -> Approved would still fail; one edge at a time doesn't.
            doc.workflow_state = "Pending Approval"
            doc.save(ignore_permissions=True)

            doc.workflow_state = "Approved"
            doc.approved_by = run_user
            doc.approval_date = today
            doc.submit()

            created.append(doc.name + " (" + farm + ": " + str(len(buckets)) + ")")
            # Commit per farm — a later farm's failure must only roll back
            # that farm's own partial writes, not every farm already done.
            frappe.db.commit()
        except Exception as fe:
            frappe.db.rollback()
            failed.append(farm + ": " + str(fe))

    if created:
        frappe.log_error(title="Auto Discard Request", message="Auto-approved: " + ", ".join(created))
    if failed:
        frappe.log_error(title="Auto Discard Request FAILED (per-farm)", message="; ".join(failed))
except Exception as e:
    frappe.log_error(title="Auto Discard Request FAILED", message=str(e))
