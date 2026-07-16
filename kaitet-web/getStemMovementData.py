# Stem Movement Data
# API: getStemMovementData
# Throughput funnel of stems across stages, grouped by (canonical) farm + variety:
#   Harvested / Received  -> Stock Entry (posting_date window)   [matches production-dashboard]
#   Shelved               -> Shelf Item (LIVE snapshot, not window-scoped)
#   Issued / Packed / Staged / Dispatched -> demand side, scoped to Sales Orders
#         whose delivery_date is in the window (dispatched by Dispatch Form custom_date).
# Warehouse-style farm strings (cold stores) are normalised to a Farm via resolve_farm.
try:
    from_date = frappe.form_dict.get('from_date') or frappe.utils.today()
    to_date   = frappe.form_dict.get('to_date') or frappe.utils.today()
    farm_param = (frappe.form_dict.get('farm') or '').strip()

    farm_names = [r["name"] for r in frappe.get_all("Farm", fields=["name"])]
    farm_names_sorted = sorted(farm_names, key=lambda n: -len(n))
    farm_set = set(farm_names)

    def resolve_farm(raw):
        val = (raw or "").strip()
        if val in farm_set:
            return val
        for f in farm_names_sorted:
            if val == f or val.startswith(f + " ") or val.startswith(f + "-"):
                return f
        return val or "Unknown"

    STAGES = ['harvested', 'received', 'shelved', 'issued', 'packed', 'staged', 'loaded', 'dispatched']
    farm_map = {}

    def ensure(farm):
        if farm not in farm_map:
            rec = {'farm': farm, 'varieties': {}}
            for s in STAGES:
                rec[s] = 0
            farm_map[farm] = rec
        return farm_map[farm]

    def ensure_var(rec, variety):
        vs = rec['varieties']
        if variety not in vs:
            vrec = {'variety': variety}
            for s in STAGES:
                vrec[s] = 0
            vs[variety] = vrec
        return vs[variety]

    def add(raw_farm, variety, stage, stems):
        farm = resolve_farm(raw_farm)
        if farm_param and farm != farm_param:
            return
        stems = stems or 0
        rec = ensure(farm)
        rec[stage] = rec[stage] + stems
        v = ensure_var(rec, variety or 'Unknown')
        v[stage] = v[stage] + stems

    params = {'f': from_date, 't': to_date}

    # ── Supply: Stock Entry (Harvesting / Receiving+Late Receipt) ──
    supply = frappe.db.sql("""
        SELECT se.custom_farm AS farm, se.stock_entry_type AS t, sed.item_code AS variety,
               COALESCE(SUM(sed.qty), 0) AS stems
        FROM `tabStock Entry` se
        INNER JOIN `tabStock Entry Detail` sed ON sed.parent = se.name
        WHERE se.docstatus = 1
          AND se.posting_date BETWEEN %(f)s AND %(t)s
          AND se.stock_entry_type IN ('Harvesting', 'Receiving', 'Late Receipt')
        GROUP BY se.custom_farm, se.stock_entry_type, sed.item_code
    """, params, as_dict=True)
    for r in supply:
        add(r.farm, r.variety, 'harvested' if r.t == 'Harvesting' else 'received', r.stems)

    # ── Shelved: stems shelved IN the window, by Shelf Item.date_added ──
    # (existing/older shelf stock is excluded — only what was placed on a shelf
    #  on the filtered date counts, so it flows against today's receipts.)
    shelf = frappe.db.sql("""
        SELECT s.farm AS farm, si.variety AS variety, COALESCE(SUM(si.stem_qty), 0) AS stems
        FROM `tabShelf` s
        INNER JOIN `tabShelf Item` si ON si.parent = s.name
        WHERE si.variety IS NOT NULL AND TRIM(si.variety) != ''
          AND DATE(si.date_added) BETWEEN %(f)s AND %(t)s
        GROUP BY s.farm, si.variety
    """, params, as_dict=True)
    for r in shelf:
        add(r.farm, r.variety, 'shelved', r.stems)

    # ── Issued: Pick List Item custom_issued=1 on an OPL created in the window.
    #    Issuing is an OPL-lifecycle event, so it's scoped by the OPL's own
    #    date_created (like the Loaded transfer stage), NOT Sales Order
    #    delivery_date — it must reflect issuing activity on the selected date. ──
    issued = frappe.db.sql("""
        SELECT pli.warehouse AS wh, pli.item_code AS variety, COALESCE(SUM(pli.stock_qty), 0) AS stems
        FROM `tabPick List Item` pli
        INNER JOIN `tabOrder Pick List` opl
            ON pli.parent = opl.name AND pli.parenttype = 'Order Pick List'
        WHERE pli.custom_issued = 1
          AND opl.date_created BETWEEN %(f)s AND %(t)s
        GROUP BY pli.warehouse, pli.item_code
    """, params, as_dict=True)
    for r in issued:
        add(r.wh, r.variety, 'issued', r.stems)

    # ── Packed: Farm Pack List -> pack_list_item rows (Dispatch Form Item child),
    #    stems from custom_number_of_stems. Scoped by the FPL's pack date
    #    (fpl.creation; Farm Pack List has no date field of its own), NOT Sales
    #    Order delivery_date — so it counts what was actually packed on the
    #    selected date (verified to match the packhouse dashboard's figure). ──
    packed = frappe.db.sql("""
        SELECT pli.source_warehouse AS wh, pli.item_code AS variety,
               COALESCE(SUM(pli.custom_number_of_stems), 0) AS stems
        FROM `tabFarm Pack List` fpl
        INNER JOIN `tabDispatch Form Item` pli
            ON pli.parent = fpl.name AND pli.parenttype = 'Farm Pack List' AND pli.parentfield = 'pack_list_item'
        WHERE fpl.docstatus != 2
          AND DATE(fpl.creation) BETWEEN %(f)s AND %(t)s
        GROUP BY pli.source_warehouse, pli.item_code
    """, params, as_dict=True)
    for r in packed:
        add(r.wh, r.variety, 'packed', r.stems)

    # ── Staged: Box Label staged=1, dated in the window by the Box Label's own
    #    `date` (staging activity), NOT Sales Order delivery_date. Stems from box
    #    items; SO join kept only to drop cancelled/closed orders. ──
    staged = frappe.db.sql("""
        SELECT bl.farm AS wh, bi.variety AS variety, COALESCE(SUM(bi.qty), 0) AS stems
        FROM `tabBox Label` bl
        INNER JOIN `tabBox Label Item` bi ON bi.parent = bl.name
        INNER JOIN `tabSales Order` so ON so.name = bl.customer_purchase_order
        WHERE bl.staged = 1 AND so.docstatus = 1
          AND DATE(bl.date) BETWEEN %(f)s AND %(t)s
          AND so.status NOT IN ('Cancelled', 'Closed')
        GROUP BY bl.farm, bi.variety
    """, params, as_dict=True)
    for r in staged:
        add(r.wh, r.variety, 'staged', r.stems)

    # ── Loaded: OPL transfer — Pick List Item rows loaded onto a trolley/truck
    #    (custom_loaded_in_trolley = 1), stems by stock_qty, scoped by the OPL's
    #    creation date (transfers happen the day the OPL is created). This tracks
    #    the farm→central transfer, NOT Box Label dispatch loading, so a day with
    #    no OPL transfers shows zero. ──
    loaded = frappe.db.sql("""
        SELECT opl.custom_farm AS wh, pli.item_code AS variety,
               COALESCE(SUM(pli.stock_qty), 0) AS stems
        FROM `tabPick List Item` pli
        INNER JOIN `tabOrder Pick List` opl
            ON pli.parent = opl.name AND pli.parenttype = 'Order Pick List'
        WHERE pli.custom_loaded_in_trolley = 1
          AND opl.date_created BETWEEN %(f)s AND %(t)s
        GROUP BY opl.custom_farm, pli.item_code
    """, params, as_dict=True)
    for r in loaded:
        add(r.wh, r.variety, 'loaded', r.stems)

    # ── Dispatched: Dispatch Form Item (own child), by Dispatch Form custom_date ──
    dispatched = frappe.db.sql("""
        SELECT df.custom_farm AS farm, dfi.item_code AS variety,
               COALESCE(SUM(dfi.custom_number_of_stems), 0) AS stems
        FROM `tabDispatch Form` df
        INNER JOIN `tabDispatch Form Item` dfi
            ON dfi.parent = df.name AND dfi.parenttype = 'Dispatch Form' AND dfi.parentfield = 'dispatch_form_item'
        WHERE df.docstatus != 2 AND df.custom_date BETWEEN %(f)s AND %(t)s
        GROUP BY df.custom_farm, dfi.item_code
    """, params, as_dict=True)
    for r in dispatched:
        add(r.farm, r.variety, 'dispatched', r.stems)

    farms = list(farm_map.values())
    for rec in farms:
        # Received but not shelved = received-in-window minus shelved-in-window (floored at 0).
        for v in rec['varieties'].values():
            v['received_not_shelved'] = max(0, (v.get('received', 0) or 0) - (v.get('shelved', 0) or 0))
        rec['received_not_shelved'] = max(0, (rec.get('received', 0) or 0) - (rec.get('shelved', 0) or 0))
        rec['varieties'] = sorted(rec['varieties'].values(),
                                  key=lambda v: (v.get('harvested', 0) + v.get('dispatched', 0)), reverse=True)
    farms = sorted(farms, key=lambda x: (x['harvested'] or x['dispatched'] or x['shelved']), reverse=True)

    totals = {}
    for s in STAGES:
        totals[s] = sum(r[s] for r in farms)
    # Sum the per-farm (already floored) backlogs so the total matches the table
    # column and reflects real unshelved receipts even when other farms over-shelved.
    totals['received_not_shelved'] = sum(r['received_not_shelved'] for r in farms)

    frappe.response['message'] = {
        'success': True,
        'from_date': from_date,
        'to_date': to_date,
        'farm': farm_param,
        'stages': STAGES,
        'farms': farms,
        'totals': totals
    }
except Exception as e:
    frappe.log_error('getStemMovementData error: ' + str(e))
    frappe.response['message'] = {'success': False, 'error': str(e), 'farms': [], 'totals': {}}
