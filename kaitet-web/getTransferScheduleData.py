# Transfer Scheduling — read feed for the sales team's trip planner
# (Web Page `transfer-control`). Returns, for a delivery window:
#   orders   — every pick list that still has buckets to transfer, broken down
#              BY FARM and BY VARIETY (buckets + stems). "order" = one Order Pick
#              List (a mixed pick list may carry several varieties from several
#              farms; they must arrive together).
#   vehicles — vehicles with a capacity set (trolleys x buckets/trolley = buckets).
#   trips    — existing Bucket Request Trip records + their order rows.
# Kapkolia is the packhouse; buckets already shelved there are done and excluded.
PACK = 'Kapkolia'
fd = frappe.form_dict
from_date = fd.get('from_date') or frappe.utils.add_days(frappe.utils.today(), 1)
to_date = fd.get('to_date') or frappe.utils.add_days(frappe.utils.today(), 1)

# ── Schedule gate: only orders that are ON a Packhouse Schedule are transfer-
#    plannable. NOTE the schedule is created on the PROCESSING day (the day before
#    delivery), so its schedule_date does NOT equal the delivery date — we must NOT
#    tie the gate to the delivery window (that was the bug: an order delivering the
#    7th is scheduled on the 6th, so a schedule_date-in-[7th] gate missed it). Gate on
#    membership only, bounded to recent schedules; the delivery window + transfer
#    flags below do the actual scoping. Latest schedule wins for a duplicated OPL. ──
lo = frappe.utils.add_days(from_date, -14)
sched_rows = frappe.db.sql("""
    SELECT pso.order_pick_list AS opl, pso.sequence AS seq, ps.team AS team
    FROM `tabPackhouse Schedule Order` pso
    JOIN `tabPackhouse Schedule` ps ON ps.name = pso.parent
    WHERE ps.schedule_date >= %(lo)s
    ORDER BY ps.schedule_date DESC
""", {'lo': lo}, as_dict=True)
sched_map = {}
for s in sched_rows:
    op = s.get('opl')
    if op and op not in sched_map:
        sched_map[op] = {'seq': int(s.get('seq') or 0), 'team': s.get('team') or ''}

rows = frappe.db.sql("""
    SELECT pli.parent AS opl, o.custom_order_name AS order_name, so.customer AS customer,
           o.sales_order AS so, so.delivery_date AS delivery_date,
           o.custom_truck_details AS truck, o.custom_is_mixed_box_pick_list AS mixed,
           o.custom_schedule_number AS schedule, o.custom_team AS team,
           pli.custom_bucket AS bucket, pli.item_code AS variety, pli.stock_qty AS stems,
           SUBSTRING_INDEX(COALESCE(NULLIF(pli.custom_source_warehouse, ''), pli.warehouse), ' ', 1) AS farm,
           pli.custom_awaiting_transfer AS aw, pli.custom_loaded_in_trolley AS ld, pli.custom_in_transit AS tr
    FROM `tabPick List Item` pli
    JOIN `tabOrder Pick List` o ON o.name = pli.parent
    LEFT JOIN `tabSales Order` so ON so.name = o.sales_order
    WHERE pli.parenttype = 'Order Pick List' AND o.docstatus < 2
      AND so.delivery_date BETWEEN %(f)s AND %(t)s
      AND (pli.custom_awaiting_transfer = 1 OR pli.custom_loaded_in_trolley = 1 OR pli.custom_in_transit = 1)
      AND pli.custom_shelved = 0
      AND o.name IN (
          SELECT pso2.order_pick_list FROM `tabPackhouse Schedule Order` pso2
          JOIN `tabPackhouse Schedule` ps2 ON ps2.name = pso2.parent
          WHERE ps2.schedule_date >= %(lo)s
      )
    ORDER BY so.delivery_date, pli.parent
""", {'f': from_date, 't': to_date, 'lo': lo}, as_dict=True)

# Aggregate per OPL -> farm -> variety, de-duping physical buckets (one bucket can
# appear on several box lines of a mixed order but is one physical unit). Helper
# maps are kept SEPARATE from the returned dicts — the sandbox forbids dict keys
# starting with "_", so nothing internal leaks into the payload.
orders = {}          # opl -> returned meta dict
farm_agg = {}        # opl -> { farm -> { buckets, stems, var -> {variety -> {buckets, stems}} } }
order_of = []
seen = {}
for r in rows:
    opl = r['opl']
    farm = r.get('farm') or '?'
    if farm == PACK:
        continue
    bkt = r.get('bucket') or ''
    dk = opl + '|' + str(bkt)
    if bkt and (dk in seen):
        continue
    if bkt:
        seen[dk] = 1
    if opl not in orders:
        sm = sched_map.get(opl) or {}
        orders[opl] = {
            'opl': opl, 'order_name': r.get('order_name') or opl, 'customer': r.get('customer') or '',
            'so': r.get('so') or '', 'delivery_date': str(r.get('delivery_date') or ''),
            'truck': (r.get('truck') or '').strip(), 'mixed': 1 if int(r.get('mixed') or 0) else 0,
            'schedule': sm.get('seq') or 0, 'team': sm.get('team') or (r.get('team') or ''),
            'total_buckets': 0, 'total_stems': 0,
        }
        farm_agg[opl] = {}
        order_of.append(opl)
    o = orders[opl]
    stems = int(r.get('stems') or 0)
    variety = r.get('variety') or '?'
    o['total_buckets'] = o['total_buckets'] + 1
    o['total_stems'] = o['total_stems'] + stems
    fa = farm_agg[opl]
    if farm not in fa:
        fa[farm] = {'buckets': 0, 'stems': 0, 'var': {}}
    fm = fa[farm]
    fm['buckets'] = fm['buckets'] + 1
    fm['stems'] = fm['stems'] + stems
    if variety not in fm['var']:
        fm['var'][variety] = {'buckets': 0, 'stems': 0}
    vv = fm['var'][variety]
    vv['buckets'] = vv['buckets'] + 1
    vv['stems'] = vv['stems'] + stems

order_list = []
for opl in order_of:
    o = orders[opl]
    fa = farm_agg[opl]
    farms = []
    fnames = sorted(fa.keys())
    for fn in fnames:
        fm = fa[fn]
        vs = []
        for vn in fm['var']:
            vv = fm['var'][vn]
            vs.append({'variety': vn, 'buckets': vv['buckets'], 'stems': vv['stems']})
        farms.append({'farm': fn, 'buckets': fm['buckets'], 'stems': fm['stems'], 'varieties': vs})
    o['farms'] = farms
    order_list.append(o)

# Order the plan by team then schedule sequence (the packhouse schedule order).
pairs = []
i = 0
while i < len(order_list):
    o = order_list[i]
    pairs.append((o.get('team') or '', int(o.get('schedule') or 0), i))
    i = i + 1
pairs.sort()
sorted_list = []
j = 0
while j < len(pairs):
    sorted_list.append(order_list[pairs[j][2]])
    j = j + 1
order_list = sorted_list

# Vehicles with a capacity set, restricted to the INTERNAL LOGISTICS fleet (the ones
# actually used for farm-to-packhouse bucket transfers) — excludes contracted/other
# vehicles that happen to have a capacity set for unrelated reasons.
veh = frappe.db.sql("""
    SELECT name, custom_trolley_capacity AS trolleys, custom_buckets_per_trolley AS bpt
    FROM `tabVehicle`
    WHERE COALESCE(custom_trolley_capacity, 0) > 0 AND COALESCE(custom_buckets_per_trolley, 0) > 0
      AND COALESCE(custom_is_internal_logistics_truck, 0) = 1
    ORDER BY name
""", as_dict=True)
vehicles = []
for v in veh:
    t = int(v.get('trolleys') or 0)
    b = int(v.get('bpt') or 0)
    vehicles.append({'name': v['name'], 'trolleys': t, 'buckets_per_trolley': b, 'capacity_buckets': t * b})

# Existing trips + their order rows
trip_rows = frappe.get_all(
    "Bucket Request Trip",
    fields=["name", "vehicle", "trip_date", "status", "notes", "collection_order", "farm", "total_buckets", "total_stems", "capacity_buckets"],
    order_by="trip_date desc, creation desc", limit_page_length=0,
)
trips = []
for t in trip_rows:
    items = frappe.get_all(
        "Bucket Request Trip Order",
        filters={"parent": t["name"], "parenttype": "Bucket Request Trip"},
        fields=["order_pick_list", "order_name", "customer", "farm", "varieties", "buckets", "stems"],
        limit_page_length=0,
    )
    trips.append({
        'name': t['name'], 'vehicle': t.get('vehicle') or '', 'trip_date': str(t.get('trip_date') or ''),
        'status': t.get('status') or 'Draft', 'notes': t.get('notes') or '',
        'collection_order': t.get('collection_order') or '', 'farm': t.get('farm') or '',
        'total_buckets': int(t.get('total_buckets') or 0), 'total_stems': int(t.get('total_stems') or 0),
        'capacity_buckets': int(t.get('capacity_buckets') or 0), 'orders': items,
    })

# ── Truck physical status: where is each truck NOW, from its Pick List Item buckets
#    (custom_transit_truck). Per bucket take the most-advanced phase; the latest-modified
#    bucket places the truck. shelved = arrived at Kapkolia; in_transit = on the way;
#    loaded/awaiting = loading at the farm. loading_pct = loaded/(loaded+awaiting). ──
tk_rows = frappe.db.sql("""
    SELECT pli.custom_transit_truck AS truck,
           pli.custom_awaiting_transfer AS aw, pli.custom_loaded_in_trolley AS ld,
           pli.custom_in_transit AS tr, pli.custom_shelved AS sh,
           SUBSTRING_INDEX(COALESCE(NULLIF(pli.custom_source_warehouse,''),pli.warehouse),' ',1) AS farm,
           pli.modified AS modified
    FROM `tabPick List Item` pli
    JOIN `tabOrder Pick List` o ON o.name = pli.parent
    LEFT JOIN `tabSales Order` so ON so.name = o.sales_order
    WHERE pli.parenttype = 'Order Pick List' AND o.docstatus < 2
      AND pli.custom_transit_truck IS NOT NULL AND pli.custom_transit_truck != ''
      AND so.delivery_date BETWEEN %(f)s AND %(t)s
""", {'f': from_date, 't': to_date}, as_dict=True)
tmap = {}
for r in tk_rows:
    tk = r.get('truck') or ''
    if not tk:
        continue
    st = tmap.get(tk)
    if not st:
        st = {'truck': tk, 'total': 0, 'awaiting': 0, 'loaded': 0, 'in_transit': 0, 'shelved': 0, 'last': '', 'last_phase': '', 'farm': ''}
        tmap[tk] = st
    sh = int(r.get('sh') or 0)
    tr = int(r.get('tr') or 0)
    ld = int(r.get('ld') or 0)
    aw = int(r.get('aw') or 0)
    phase = ''
    if sh:
        phase = 'shelved'
    elif tr:
        phase = 'in_transit'
    elif ld:
        phase = 'loaded'
    elif aw:
        phase = 'awaiting'
    st['total'] = st['total'] + 1
    if phase == 'shelved':
        st['shelved'] = st['shelved'] + 1
    elif phase == 'in_transit':
        st['in_transit'] = st['in_transit'] + 1
    elif phase == 'loaded':
        st['loaded'] = st['loaded'] + 1
    elif phase == 'awaiting':
        st['awaiting'] = st['awaiting'] + 1
    md = str(r.get('modified') or '')
    if md > st['last']:
        st['last'] = md
        st['last_phase'] = phase
        st['farm'] = r.get('farm') or ''
truck_status = []
for tk in tmap:
    st = tmap[tk]
    loadtot = st['loaded'] + st['awaiting']
    loading_pct = 100
    if loadtot > 0:
        loading_pct = int(round(st['loaded'] * 100.0 / loadtot))
    lp = st['last_phase']
    loc = 'unknown'
    if lp == 'shelved':
        loc = 'arrived'
    elif lp == 'in_transit':
        loc = 'in_transit'
    elif lp == 'loaded' or lp == 'awaiting':
        loc = 'loading'
    truck_status.append({
        'truck': st['truck'], 'total': st['total'], 'awaiting': st['awaiting'],
        'loaded': st['loaded'], 'in_transit': st['in_transit'], 'shelved': st['shelved'],
        'location': loc, 'farm': st['farm'], 'loading_pct': loading_pct, 'last': st['last'],
    })

# Inter-farm road distances (Farm Distance doctype) — for collection-route optimisation
# on the client. Symmetric, so one direction per pair is enough.
dist_rows = frappe.get_all("Farm Distance", fields=["from_farm", "to_farm", "distance_km"], limit_page_length=0)
distances = []
for d in dist_rows:
    distances.append({'a': d.get('from_farm') or '', 'b': d.get('to_farm') or '', 'km': float(d.get('distance_km') or 0)})

frappe.response['orders'] = order_list
frappe.response['vehicles'] = vehicles
frappe.response['trips'] = trips
frappe.response['truck_status'] = truck_status
frappe.response['distances'] = distances
frappe.response['packhouse'] = PACK
frappe.response['window'] = {'from': str(from_date), 'to': str(to_date)}
frappe.response['generated_at'] = str(frappe.utils.now())
