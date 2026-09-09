# Frappe Server Script (Type: API), api_method = getShelvingDemand
# Shelving target board: for TOMORROW's delivery date (what is processed today),
# aggregate demand per variety from Sales Orders and compare to what is already
# covered — reserved (Bucket Allocation Status) and physically on the shelf
# (Shelf Item) — so the shelving person sees how much of each variety still
# needs to be brought in, and can avoid over-shelving slow movers.
#
# Non-double-count rule: an allocated bucket is normally still on its shelf
# (allocated stems are a subset of shelf stems), but once transferred it leaves
# the shelf. So coverage per variety = MAX(on_shelf, allocated) — the greater of
# what is physically present or what is reserved — which credits allocated stems
# that already left the shelf without counting an allocated-still-on-shelf bucket
# twice. target_to_shelve = max(0, demand - coverage).
# Payload: optional { "date": "YYYY-MM-DD", "farm": "<Farm>" }.
#   date  -> defaults to tomorrow.
#   farm  -> when supplied, ON-SHELF and ALLOCATED are scoped to that farm's
#            shelves (the station's farm), so the shelver sees THIS farm's
#            coverage of tomorrow's demand. Demand stays the full tomorrow total
#            (the target to fill). Blank farm = company-wide (all farms).
frappe.response["message"] = {"status": "error", "rows": []}
try:
    data = frappe.request.get_json() or {}
    target_date = data.get("date")
    if not target_date:
        target_date = str(frappe.utils.add_days(frappe.utils.today(), 1))
    farm = (data.get("farm") or "").strip()

    # Sales farms are the ones flagged sales_shelf=1 in Production Settings'
    # shelf_locations child table. The shelving guide is only relevant to a
    # sales farm (that is where allocation picks from). A non-sales farm gets a
    # clear "not applicable" so the app can hide the guide for it.
    sales_farms = {}
    ps = frappe.get_doc("Production Settings", "Production Settings")
    for loc in (ps.get("shelf_locations") or []):
        if loc.get("sales_shelf"):
            sales_farms[loc.get("farm")] = 1
    is_sales_farm = 1 if (farm and farm in sales_farms) else 0
    not_applicable = bool(farm) and not is_sales_farm

    # ── Demand: tomorrow's delivery, stems per variety (stock_qty = stems) ─────
    demand_rows = frappe.db.sql(
        """
        SELECT soi.item_code AS variety, COALESCE(SUM(soi.stock_qty), 0) AS stems
        FROM `tabSales Order Item` soi
        INNER JOIN `tabSales Order` so ON so.name = soi.parent
        WHERE so.docstatus = 1
          AND so.delivery_date = %(d)s
          AND so.company = 'Karen Roses'
          AND so.status NOT IN ('Cancelled', 'Closed')
        GROUP BY soi.item_code
        """,
        {"d": target_date}, as_dict=True,
    )

    # ── Allocated (reserved) stems per variety, from the live allocation table.
    #    Scoped to the station's farm (shelf_farm) when a farm is supplied. ─────
    alloc_params = {}
    alloc_farm_cond = ""
    if farm:
        alloc_farm_cond = " AND shelf_farm = %(farm)s"
        alloc_params["farm"] = farm
    alloc_rows = frappe.db.sql(
        """
        SELECT item_code AS variety, COALESCE(SUM(allocated_quantity), 0) AS stems
        FROM `tabBucket Allocation Status`
        WHERE item_code IS NOT NULL AND item_code != ''
        """ + alloc_farm_cond + """
        GROUP BY item_code
        """, alloc_params, as_dict=True,
    )

    # ── On-shelf stems per variety. Scoped to the station's farm when supplied,
    #    else all Karen Roses farms. ────────────────────────────────────────────
    shelf_params = {}
    shelf_farm_cond = ""
    if farm:
        shelf_farm_cond = " AND sh.farm = %(farm)s"
        shelf_params["farm"] = farm
    shelf_rows = frappe.db.sql(
        """
        SELECT si.variety AS variety, COALESCE(SUM(si.stem_qty), 0) AS stems,
               COUNT(DISTINCT si.bucket_id) AS buckets
        FROM `tabShelf Item` si
        INNER JOIN `tabShelf` sh ON sh.name = si.parent
        INNER JOIN `tabFarm` f ON f.name = sh.farm
        WHERE si.variety IS NOT NULL AND si.variety != ''
          AND si.stem_qty > 0
          AND f.company = 'Karen Roses'
        """ + shelf_farm_cond + """
        GROUP BY si.variety
        """, shelf_params, as_dict=True,
    )

    demand = {}
    for r in demand_rows:
        demand[r["variety"]] = float(r["stems"] or 0)
    allocated = {}
    for r in alloc_rows:
        allocated[r["variety"]] = float(r["stems"] or 0)
    shelf = {}
    shelf_buckets = {}
    for r in shelf_rows:
        shelf[r["variety"]] = float(r["stems"] or 0)
        shelf_buckets[r["variety"]] = int(r["buckets"] or 0)

    # Union of varieties that have demand (the board is demand-driven; a variety
    # with stock but no demand for tomorrow is a slow mover -> target 0, shown so
    # the shelver can SEE it is over-stocked).
    varieties = {}
    for v in demand:
        varieties[v] = 1
    for v in allocated:
        varieties[v] = 1
    for v in shelf:
        varieties[v] = 1

    rows = []
    total_demand = 0.0
    total_target = 0.0
    for v in varieties:
        dem = demand.get(v, 0.0)
        alc = allocated.get(v, 0.0)
        shf = shelf.get(v, 0.0)
        coverage = shf if shf > alc else alc   # max(shelf, allocated)
        target = dem - coverage
        if target < 0:
            target = 0.0
        rows.append({
            "variety": v,
            "demand": dem,
            "allocated": alc,
            "on_shelf": shf,
            "shelf_buckets": shelf_buckets.get(v, 0),
            "coverage": coverage,
            "target_to_shelve": target,
        })
        total_demand = total_demand + dem
        total_target = total_target + target

    # Biggest shelving gaps first; ties broken by demand.
    rows = sorted(rows, key=lambda x: (x["target_to_shelve"], x["demand"]), reverse=True)

    if not_applicable:
        frappe.response["message"] = {
            "status": "not_applicable",
            "date": target_date,
            "farm": farm,
            "is_sales_farm": 0,
            "rows": [],
            "totals": {"demand": 0, "target_to_shelve": 0, "varieties": 0},
        }
    else:
        frappe.response["message"] = {
            "status": "success",
            "date": target_date,
            "farm": farm,
            "is_sales_farm": is_sales_farm,
            "rows": rows,
            "totals": {
                "demand": total_demand,
                "target_to_shelve": total_target,
                "varieties": len(rows),
            },
        }
except Exception as e:
    frappe.response["message"] = {"status": "error", "message": str(e), "rows": []}
