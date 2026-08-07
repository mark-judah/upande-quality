# Bucket Trace — the complete, chronological life story of one physical bucket,
# for the bucket-tracker (Bucket Journey) page. Buckets are REUSED across many
# harvest→issue cycles, so this returns every event that ever touched the id.
#
# The persistent backbone is the **Shelving Log** (NOT `Shelf`/`Shelf Item`,
# which is cleared on issue and can't be used for history). Each Shelving Log
# row is one shelving episode: on `shelved_on` the bucket landed on `shelf` at
# `farm`; on `removed_on` it left, and `reason` says why —
#   Shelved · Transferred (Trolley/Truck) · Issued to Sales Order · Discarded ·
#   Shelf Cleared.
# We also fold in Harvesting / Receiving / Discard stock entries, order
# allocation (Order Pick List + transfer flags + transit truck), and Bucket
# Reuse Anomalies. Result: one time-ordered event list + a live current status
# (incl. "being transferred"). bucket_id case is inconsistent across tables, so
# every match is UPPER()-folded.
fd = frappe.form_dict
bid = (fd.get('bucket_id') or fd.get('bucket') or '').strip()
resp = {'bucket_id': bid, 'events': [], 'status': '', 'status_kind': '', 'summary': {}}

if bid:
    P = {'b': bid}
    events = []

    def add(ts, kind, title, farm, shelf, detail, ref, actor):
        if not ts:
            return
        try:
            dt = frappe.utils.get_datetime(str(ts))
        except Exception:
            return
        events.append((dt, {
            'ts': str(dt), 'kind': kind, 'title': title,
            'farm': farm or '', 'shelf': shelf or '', 'detail': detail or '',
            'ref': ref or '', 'actor': actor or ''
        }))

    # 1) Harvesting
    for r in frappe.db.sql("""
        SELECT name, CONCAT(posting_date,' ',posting_time) AS ts, custom_farm, custom_greenhouse,
               custom_stem_length, custom_harvester
        FROM `tabStock Entry`
        WHERE stock_entry_type='Harvesting' AND UPPER(custom_bucket_id)=UPPER(%(b)s)
    """, P, as_dict=True):
        det = []
        if r.get('custom_greenhouse'): det.append(r['custom_greenhouse'])
        if r.get('custom_stem_length'): det.append(str(r['custom_stem_length']))
        add(r['ts'], 'harvest', 'Harvested', r.get('custom_farm'), '', ' · '.join(det), r['name'], r.get('custom_harvester'))

    # 2) Received & graded
    for r in frappe.db.sql("""
        SELECT name, CONCAT(posting_date,' ',posting_time) AS ts, custom_farm, stock_entry_type, custom_stem_length
        FROM `tabStock Entry`
        WHERE stock_entry_type IN ('Receiving','Late Receipt') AND UPPER(custom_received_bucket_id)=UPPER(%(b)s)
    """, P, as_dict=True):
        title = 'Received & graded' if r['stock_entry_type'] == 'Receiving' else 'Late receipt'
        add(r['ts'], 'received', title, r.get('custom_farm'), '', r.get('custom_stem_length') or '', r['name'], '')

    # 3) Shelving Log — the persistent shelf/transfer/issue/discard history
    for r in frappe.db.sql("""
        SELECT name, shelf, farm, variety, stem_qty, shelved_on, removed_on, reason, shelved_by
        FROM `tabShelving Log`
        WHERE UPPER(bucket_id)=UPPER(%(b)s)
    """, P, as_dict=True):
        loc = (r.get('shelf') or '') + ((' · ' + str(int(r['stem_qty'])) + ' stems') if r.get('stem_qty') else '')
        vy = r.get('variety') or ''
        # arrival on the shelf
        add(r.get('shelved_on'), 'shelved', 'Shelved on ' + (r.get('shelf') or '?'),
            r.get('farm'), r.get('shelf'), vy, r['name'], r.get('shelved_by'))
        # departure from the shelf, typed by reason
        reason = (r.get('reason') or '').strip()
        if r.get('removed_on') and reason and reason != 'Shelved':
            if reason == 'Transferred (Trolley/Truck)':
                add(r['removed_on'], 'transferred', 'Transferred off ' + (r.get('shelf') or '?'), r.get('farm'), r.get('shelf'), vy, r['name'], '')
            elif reason == 'Issued to Sales Order':
                add(r['removed_on'], 'issued', 'Issued to sales order', r.get('farm'), r.get('shelf'), vy, r['name'], '')
            elif reason == 'Discarded':
                add(r['removed_on'], 'discarded', 'Discarded off ' + (r.get('shelf') or '?'), r.get('farm'), r.get('shelf'), vy, r['name'], '')
            else:
                add(r['removed_on'], 'cleared', 'Removed from ' + (r.get('shelf') or '?'), r.get('farm'), r.get('shelf'), reason, r['name'], '')

    # 4) Discard stock entries (the accounting side of a discard)
    for r in frappe.db.sql("""
        SELECT name, CONCAT(posting_date,' ',posting_time) AS ts, custom_farm
        FROM `tabStock Entry`
        WHERE stock_entry_type='Discard' AND docstatus=1 AND UPPER(custom_received_bucket_id)=UPPER(%(b)s)
    """, P, as_dict=True):
        add(r['ts'], 'discard_entry', 'Discard stock entry', r.get('custom_farm'), '', '', r['name'], '')

    # 5) Order allocation (Order Pick List rows this bucket serves) + transfer state
    opls = frappe.db.sql("""
        SELECT o.name AS opl, o.creation AS ts, o.custom_order_name, so.customer, so.delivery_date,
               pli.custom_shelf, pli.custom_transit_truck,
               pli.custom_awaiting_transfer aw, pli.custom_loaded_in_trolley ld,
               pli.custom_in_transit tr, pli.custom_shelved sh
        FROM `tabPick List Item` pli
        JOIN `tabOrder Pick List` o ON o.name = pli.parent
        LEFT JOIN `tabSales Order` so ON so.name = o.sales_order
        WHERE pli.parenttype='Order Pick List' AND UPPER(pli.custom_bucket)=UPPER(%(b)s)
        GROUP BY o.name
    """, P, as_dict=True)
    for r in opls:
        det = []
        if r.get('customer'): det.append(r['customer'])
        if r.get('delivery_date'): det.append('deliver ' + str(r['delivery_date']))
        if r.get('custom_transit_truck'): det.append('truck ' + r['custom_transit_truck'])
        add(r['ts'], 'allocated', 'Allocated to ' + (r.get('custom_order_name') or r['opl']),
            '', r.get('custom_shelf'), ' · '.join(det), r['opl'], '')

    # 6) Reuse anomalies
    for r in frappe.db.sql("""
        SELECT name, detected_on, skipped_step, farm, previous_shelf, discard_request
        FROM `tabBucket Reuse Anomaly` WHERE UPPER(bucket_id)=UPPER(%(b)s)
    """, P, as_dict=True):
        det = []
        if r.get('previous_shelf'): det.append('was on ' + r['previous_shelf'])
        if r.get('discard_request'): det.append(r['discard_request'])
        add(r.get('detected_on'), 'anomaly', 'Reuse anomaly: ' + (r.get('skipped_step') or '?'),
            r.get('farm'), '', ' · '.join(det), r['name'], '')

    # ── order newest-first (sort (dt, event) tuples; sandbox forbids '_'-keys) ──
    events.sort(key=lambda x: x[0], reverse=True)
    ordered = [x[1] for x in events]

    # ── live current status (transfer state wins; then latest shelving episode) ──
    status = ''
    kind = ''
    live = frappe.db.sql("""
        SELECT pli.custom_awaiting_transfer aw, pli.custom_loaded_in_trolley ld, pli.custom_in_transit tr,
               pli.custom_shelved sh, pli.custom_shelf, pli.custom_transit_truck,
               SUBSTRING_INDEX(COALESCE(NULLIF(pli.custom_source_warehouse,''), pli.warehouse), ' ', 1) AS src
        FROM `tabPick List Item` pli
        JOIN `tabOrder Pick List` o ON o.name = pli.parent
        WHERE pli.parenttype='Order Pick List' AND o.docstatus < 2 AND UPPER(pli.custom_bucket)=UPPER(%(b)s)
          AND (pli.custom_awaiting_transfer=1 OR pli.custom_loaded_in_trolley=1 OR pli.custom_in_transit=1)
        ORDER BY o.creation DESC LIMIT 1
    """, P, as_dict=True)
    if live:
        lv = live[0]
        if int(lv.get('tr') or 0):
            status = 'In transit' + ((' on ' + lv['custom_transit_truck']) if lv.get('custom_transit_truck') else '') + ' from ' + (lv.get('src') or '?'); kind = 'transferred'
        elif int(lv.get('ld') or 0):
            status = 'Loading on trolley at ' + (lv.get('src') or '?'); kind = 'transferred'
        elif int(lv.get('aw') or 0):
            status = 'Awaiting transfer from ' + (lv.get('src') or '?'); kind = 'transferred'

    if not status:
        # latest shelving episode still open (removed_on NULL) => currently on a shelf
        cur = frappe.db.sql("""
            SELECT shelf, farm FROM `tabShelving Log`
            WHERE UPPER(bucket_id)=UPPER(%(b)s) AND removed_on IS NULL
            ORDER BY shelved_on DESC LIMIT 1
        """, P, as_dict=True)
        if cur:
            where = 'at the packhouse' if (cur[0].get('farm') == 'Kapkolia') else ('at ' + (cur[0].get('farm') or '?'))
            status = 'On shelf ' + (cur[0].get('shelf') or '?') + ' ' + where; kind = 'shelved'

    if not status and ordered:
        e0 = ordered[0]
        m = {'issued': 'Issued to sales order', 'discarded': 'Discarded', 'discard_entry': 'Discarded',
             'transferred': 'Transferred out', 'cleared': 'Off shelf', 'harvest': 'Harvested (not yet received)',
             'received': 'Received, not yet shelved', 'allocated': 'Allocated, awaiting movement'}
        status = m.get(e0['kind'], e0['title']); kind = e0['kind']
    if not status:
        status = 'No history found'; kind = 'none'

    # summary counts
    def cnt(k): return len([e for e in ordered if e['kind'] == k])
    resp['events'] = ordered
    resp['status'] = status
    resp['status_kind'] = kind
    resp['summary'] = {
        'total': len(ordered), 'harvests': cnt('harvest'), 'receipts': cnt('received'),
        'shelvings': cnt('shelved'), 'transfers': cnt('transferred'), 'issues': cnt('issued'),
        'discards': cnt('discarded') + cnt('discard_entry'), 'allocations': cnt('allocated'),
        'anomalies': cnt('anomaly'),
    }

frappe.response['trace'] = resp
