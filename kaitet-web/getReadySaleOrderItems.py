try:
    current_user = frappe.session.user

    # Determine user's farm location
    farm_filter = None
    employee = frappe.get_all(
        "Employee",
        filters={"user_id": current_user, "status": "Active"},
        fields=["custom_group_name"],
        limit=1
    )

    if employee:
        group_name = (employee[0].get("custom_group_name") or "").lower()
        if "ravine" in group_name:
            farm_filter = "Kapkolia"
        elif "karen" in group_name:
            farm_filter = "Karen"
        # If empty, farm_filter stays None -> returns all
    # If no employee found (developers/admins) -> returns all

    # Optional ?date=YYYY-MM-DD to view a past day's orders; defaults to today.
    requested_date = frappe.form_dict.get('date')
    day = requested_date if requested_date else frappe.utils.today()

    # Build filters — orders created on the selected day.
    opl_filters = {
        "docstatus": 1,
        "creation": ["like", f"{day}%"]
    }
    if farm_filter:
        opl_filters["custom_farm"] = farm_filter

    # Pull each ready OPL with its item group + team so the app can filter by them.
    ready_orders = frappe.get_all(
        "Order Pick List",
        filters=opl_filters,
        fields=["name", "custom_order_name", "custom_item_group", "custom_team"]
    )

    # Keep only OPLs that still have at least one UNISSUED bucket. This drops
    # orders that are fully issued or have no buckets allocated, so the app
    # never lists an order with nothing left to issue.
    opl_names = [o.name for o in ready_orders]
    opls_with_unissued = set()
    if opl_names:
        unissued_rows = frappe.get_all(
            "Pick List Item",
            filters={
                "parent": ["in", opl_names],
                "parenttype": "Order Pick List",
                "docstatus": 1,
                "custom_issued": 0
            },
            fields=["parent"],
            distinct=True
        )
        for r in unissued_rows:
            opls_with_unissued.add(r.parent)

    # Aggregate item group(s) + team(s) per order name (an order can span OPLs).
    order_groups = {}
    order_teams = {}
    for opl in ready_orders:
        if opl.name not in opls_with_unissued:
            continue
        order_name = opl.get("custom_order_name")
        if not order_name:
            continue
        groups = order_groups.setdefault(order_name, set())
        if opl.get("custom_item_group"):
            groups.add(opl.get("custom_item_group"))
        teams = order_teams.setdefault(order_name, set())
        if opl.get("custom_team"):
            teams.add(opl.get("custom_team"))

    orders = [
        {
            "name": name,
            "custom_item_group": sorted(groups),
            "custom_team": sorted(order_teams.get(name, set())),
        }
        for name, groups in sorted(order_groups.items())
    ]

    frappe.response["orders"] = orders
    frappe.response["message"] = f"Found {len(orders)} orders ready for packing"

except Exception as error:
    frappe.log_error(f"Fetch Ready Orders Error: {str(error)}")
    frappe.throw(f"Error fetching ready orders: {str(error)}")
