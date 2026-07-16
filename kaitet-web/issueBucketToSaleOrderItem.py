try:
    # Get payload from request
    payload = frappe.request.json
    frappe.log_error("Issuing from coldstore payload", payload)

    bucket_id = payload.get('bucket')
    sale_order_item = payload.get('sale_order_item')
    opl_name = payload.get('opl_name')

    # ----------------------------------------------------------------------
    # SCHEDULER ENFORCEMENT (optional, per-farm + per-TEAM, per delivery date)
    # ----------------------------------------------------------------------
    # Flip allow_scheduler_validation to 1 to enforce the packhouse schedule:
    # a bucket for an OPL with a higher custom_schedule_number cannot be issued
    # until every lower-numbered OPL of the SAME FARM, SAME TEAM and SAME delivery
    # date has reached scheduler_issue_threshold % issued (issued Pick List Item
    # rows / total rows). e.g. 50 => once a line is 50% issued the team may start
    # its next line. Set to 100 to require a line be fully issued before moving on.
    #
    # Each TEAM has its own queue, so several lines (one per team) can be the
    # "next" line at once and teams never wait on each other. A team's own earlier
    # line still gates its later lines: e.g. with line 1 -> team W and line 6 -> team W,
    # team W cannot start #6 until #1 is at/above the threshold; meanwhile lines
    # 2,3,4 for teams X,Y,Z are all issuable in parallel.
    # Numbering is global per-day but compared only within (farm, team), so
    # Kapkolia's #9 never blocks Karen's #10, and team X's #2 never blocks team W.
    # 0 = skip entirely and issue as usual (no behaviour change).
    allow_scheduler_validation = 0
    scheduler_issue_threshold = 50
    schedule_blocked = False
    if allow_scheduler_validation and opl_name:
        cur_opl = frappe.db.get_value(
            'Order Pick List', opl_name,
            ['custom_schedule_number', 'custom_farm', 'custom_team', 'sales_order'],
            as_dict=True
        )
        cur_num = 0
        if cur_opl:
            try:
                cur_num = int(float(cur_opl.custom_schedule_number or 0))
            except Exception:
                cur_num = 0

        cur_dd = None
        if cur_opl and cur_opl.sales_order:
            cur_dd = frappe.db.get_value('Sales Order', cur_opl.sales_order, 'delivery_date')

        # Only enforce when this OPL is scheduled and we know its farm + team + delivery date
        if cur_opl and cur_num > 0 and cur_opl.custom_farm and cur_opl.custom_team and cur_dd:
            so_rows = frappe.get_all(
                'Sales Order',
                filters=[['delivery_date', '=', cur_dd]],
                fields=['name']
            )
            so_list = []
            for so in so_rows:
                so_list.append(so.name)

            lower_opls = []
            if so_list:
                sibs = frappe.get_all(
                    'Order Pick List',
                    filters=[
                        ['docstatus', '=', 1],
                        ['custom_farm', '=', cur_opl.custom_farm],
                        ['custom_team', '=', cur_opl.custom_team],
                        ['sales_order', 'in', so_list]
                    ],
                    fields=['name', 'custom_schedule_number']
                )
                for sib in sibs:
                    snum = 0
                    try:
                        snum = int(float(sib.custom_schedule_number or 0))
                    except Exception:
                        snum = 0
                    if snum > 0 and snum < cur_num:
                        lower_opls.append({'name': sib.name, 'num': snum})

            # A lower-numbered OPL is "done" only when ALL its Pick List Item rows are issued
            blockers = []
            if lower_opls:
                lower_names = []
                for lo in lower_opls:
                    lower_names.append(lo['name'])
                plis = frappe.get_all(
                    'Pick List Item',
                    filters=[['parent', 'in', lower_names]],
                    fields=['parent', 'custom_issued']
                )
                total_by = {}
                issued_by = {}
                for pli in plis:
                    total_by[pli.parent] = total_by.get(pli.parent, 0) + 1
                    if pli.custom_issued:
                        issued_by[pli.parent] = issued_by.get(pli.parent, 0) + 1
                for lo in lower_opls:
                    t = total_by.get(lo['name'], 0)
                    done = issued_by.get(lo['name'], 0)
                    # A line with no buckets to issue (t == 0) can never reach the
                    # threshold, so treat it as satisfied to avoid a permanent deadlock.
                    pct = (100.0 * done / t) if t else 100.0
                    if pct < scheduler_issue_threshold:
                        blockers.append(lo['num'])

            if blockers:
                start_from = min(blockers)
                schedule_blocked = True
                frappe.response.message = (
                    f"Schedule order for team {cur_opl.custom_team} ({cur_opl.custom_farm}): start from #{start_from}. "
                    f"Order #{start_from} is below {scheduler_issue_threshold}% issued, so #{cur_num} cannot be issued before it."
                )
                frappe.response.http_status_code = 409
                frappe.response.data = {
                    'status': 'schedule_blocked',
                    'farm': cur_opl.custom_farm,
                    'team': cur_opl.custom_team,
                    'attempted_schedule_number': cur_num,
                    'start_from': start_from,
                    'threshold_percent': scheduler_issue_threshold,
                    'pending_lower_numbers': sorted(blockers)
                }

    # -------------------------------
    # Validation
    # -------------------------------
    if schedule_blocked:
        pass
    elif not bucket_id:
        frappe.response.message = "Error: Bucket ID is required"
        frappe.response.http_status_code = 400
    elif not sale_order_item:
        frappe.response.message = "Error: Sale Order Item is required"
        frappe.response.http_status_code = 400
    else:
        # -------------------------------
        # Get latest Stock Entry for bucket
        # -------------------------------
        stock_entries = frappe.db.get_list(
            'Stock Entry',
            filters={
                'custom_bucket_id': bucket_id,
                'docstatus': 1
            },
            fields=['name', 'creation', 'custom_issued_to'],
            order_by='creation desc',
            limit=1
        )

        if not stock_entries:
            frappe.response.message = f"No stock entry found with bucket ID: {bucket_id}"
            frappe.response.http_status_code = 404
        else:
            latest_stock_entry = stock_entries[0]
            stock_entry_name = latest_stock_entry['name']
            current_issued_to = latest_stock_entry.get('custom_issued_to')

            # -------------------------------
            # Already issued check
            # -------------------------------
            if current_issued_to == sale_order_item:
                frappe.response.message = (
                    f"Stock Entry {stock_entry_name} is already issued "
                    f"to sale order item {sale_order_item}"
                )
                frappe.response.http_status_code = 409
                frappe.response.data = {
                    'stock_entry': stock_entry_name,
                    'bucket_id': bucket_id,
                    'current_issued_to': current_issued_to,
                    'requested_issued_to': sale_order_item,
                    'status': 'already_issued'
                }
            else:
                # -------------------------------
                # Issue bucket (update Stock Entry)
                # -------------------------------
                frappe.db.set_value(
                    'Stock Entry',
                    stock_entry_name,
                    'custom_issued_to',
                    sale_order_item
                )

                # -------------------------------
                # UPDATE ONLY THE TARGET OPL'S CHILD ROW (Pick List Item)
                # -------------------------------
                # Scope to the exact (bucket, sale_order_item) being issued. A
                # bucket can be allocated to MORE THAN ONE order, each with a
                # DIFFERENT custom_sale_order_item; filtering by bucket alone
                # would mark it issued on every order that shares the QR ("issued
                # itself" / phantom % on orders nobody started). The sale order
                # item is the key: only the row whose custom_sale_order_item
                # matches what we just issued to should be flagged. opl_name (when
                # sent) further scopes to the specific OPL.
                pli_filters = {
                    'custom_bucket': bucket_id,
                    'custom_sale_order_item': sale_order_item,
                }
                if opl_name:
                    pli_filters['parent'] = opl_name
                pick_list_items = frappe.db.get_all(
                    'Pick List Item',
                    filters=pli_filters,
                    fields=['name', 'parent']
                )

                updated_opls = set()
                for item in pick_list_items:
                    # Mark this child location as issued
                    frappe.db.set_value(
                        'Pick List Item',
                        item.name,
                        'custom_issued',
                        1
                    )
                    updated_opls.add(item.parent)

                # -------------------------------
                # DO NOT UPDATE PARENT OPL FIELDS
                # (custom_issued and custom_issuing_percentage remain untouched)
                # -------------------------------

                # -------------------------------
                # REMOVE BUCKET FROM SHELF
                # -------------------------------
                shelf_items = frappe.db.get_all(
                    'Shelf Item',
                    filters={'bucket_id': bucket_id},
                    fields=['name', 'parent']
                )

                removed_from_shelf = []
                for item in shelf_items:
                    frappe.delete_doc('Shelf Item', item.name, force=1)
                    removed_from_shelf.append(item.parent)
                    # Touch parent shelf to refresh UI/modified time
                    frappe.db.set_value('Shelf', item.parent, 'modified', frappe.utils.now())

                # -------------------------------
                # Commit all changes
                # -------------------------------
                frappe.db.commit()

                frappe.response.message = (
                    f"Bucket {bucket_id} successfully issued to {sale_order_item}, "
                    f"and removed from shelf"
                )
                frappe.response.http_status_code = 200
                frappe.response.data = {
                    'stock_entry': stock_entry_name,
                    'bucket_id': bucket_id,
                    'previous_issued_to': current_issued_to,
                    'new_issued_to': sale_order_item,
                    'updated_child_rows': len(pick_list_items),
                    'affected_opls': list(updated_opls),
                    'removed_from_shelf_count': len(removed_from_shelf),
                    'shelves_affected': list(set(removed_from_shelf)),
                    'updated_at': frappe.utils.now(),
                    'status': 'issued_and_child_updated'
                }

except Exception as e:
    frappe.db.rollback()
    frappe.log_error("Coldstore Issue Error",e)
    frappe.response.message = f"Error issuing bucket: {str(e)}"
    frappe.response.http_status_code = 500
    frappe.response.data = {
        'error': str(e)
    }