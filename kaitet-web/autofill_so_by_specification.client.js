// Client Script — DocType: Sales Order, View: Form
// Name: Autofill Sales Order By Specification
//
// Spec-driven Sales Order population, split along TWO independent dimensions:
//   BOX   dimension  = spec.box_assortment      -> "Mixed Box" vs "Mono Box"/blank
//   BUNCH dimension  = box_items[].bunch_type    -> any "Mixed Bunch" vs "Mono Bunch"
//
// These give FOUR cases, each handled by its own isolated branch so a feature
// added to one never leaks into the others:
//   1. Mono Box  + Mono Bunch   -> straight line per variety   (mixed_box=0, mixed_bunch=0)
//   2. Mono Box  + Mixed Bunch  -> bouquet rows in a mono box   (mixed_box=0, mixed_bunch=1)
//   3. Mixed Box + Mono Bunch   -> one variety per colour       (mixed_box=1, mixed_bunch=0)
//   4. Mixed Box + Mixed Bunch  -> bouquet rows in a mixed box   (mixed_box=1, mixed_bunch=1)
//
// The two custom flags are ALWAYS set explicitly per case: custom_mixed_box
// reflects the box dimension, custom_mixed_bunch reflects the bunch dimension.
// Delivery (target) warehouse is resolved from SO Warehouse Mapping "Roses-MAP".
// Pricing + qty are left to the reactive scripts (packrate/boxes -> qty, price).

// Re-entrancy guard: while we are populating rows we set fields (incl.
// custom_line on appended rows) via set_value, which would otherwise re-fire
// the custom_line handler below and recurse forever.
let SPEC_AUTOFILL_BUSY = false;

frappe.ui.form.on('Sales Order Item', {
    custom_line(frm, cdt, cdn) {
        if (SPEC_AUTOFILL_BUSY) return;
        const row = locals[cdt][cdn];
        if (!row.custom_line) return;
        frappe.db.get_doc('Specifications', row.custom_line)
            .then(spec => apply_spec_to_order(frm, cdt, cdn, spec))
            .catch(() => frappe.msgprint(__('Could not load specification {0}', [row.custom_line])));
    },

    // Auto-fill ordered quantity (packrate × boxes) + show the running tally.
    custom_number_of_boxes(frm, cdt, cdn) {
        set_ordered_qty(frm, cdt, cdn);
        show_box_tally(frm);
    },
    custom_packrate(frm, cdt, cdn) {
        set_ordered_qty(frm, cdt, cdn);
    },
    custom_packrate_mixed_box(frm, cdt, cdn) {
        set_ordered_qty(frm, cdt, cdn);
    }
});

frappe.ui.form.on('Sales Order', {
    onload(frm) { set_spec_query(frm); },
    refresh(frm) { set_spec_query(frm); },
    customer(frm) { set_spec_query(frm); },

    validate(frm) {
        let missing = [];
        (frm.doc.items || []).forEach((it, idx) => {
            if (!it.custom_line && it.item_code) missing.push(idx + 1);
        });
        if (missing.length) {
            frappe.msgprint({
                title: __('Missing Specification'),
                message: __('Please select a Specification for row(s): {0}', [missing.join(', ')]),
                indicator: 'orange'
            });
        }
    }
});

/* ============================ shared leaf helpers ============================ */
/* Stable primitives used across cases. Case-specific row shaping lives INSIDE   */
/* each case handler, not here, so per-case features stay isolated.              */

// Only show Specifications belonging to the selected customer in the spec
// (custom_line) picker on each item row.
function set_spec_query(frm) {
    frm.set_query('custom_line', 'items', () => {
        return frm.doc.customer ? { filters: { customer: frm.doc.customer } } : {};
    });
}

// Ordered quantity = packrate × number of boxes. A row uses the mixed packrate
// field whenever EITHER flag is set (mixed box or mixed bunch); only a plain
// mono-box/mono-bunch row uses custom_packrate.
function set_ordered_qty(frm, cdt, cdn) {
    let row = locals[cdt][cdn];
    if (!row) return;
    let boxes = cint(row.custom_number_of_boxes);
    let per = (row.custom_mixed_box || row.custom_mixed_bunch) ? flt(row.custom_packrate_mixed_box) : flt(row.custom_packrate);
    if (boxes && per) {
        frappe.model.set_value(cdt, cdn, 'custom_ordered_quantity', per * boxes);
    }
}

// Popup the running totals whenever a box count changes, so the packer can
// track progress toward the number of boxes the customer ordered.
function show_box_tally(frm) {
    let total_boxes = 0, total_stems = 0;
    (frm.doc.items || []).forEach(it => {
        let boxes = cint(it.custom_number_of_boxes);
        if (!boxes) return;
        total_boxes += boxes;
        let per = (it.custom_mixed_box || it.custom_mixed_bunch) ? flt(it.custom_packrate_mixed_box) : flt(it.custom_packrate);
        total_stems += per * boxes;
    });
    frappe.show_alert({
        message: __('Boxes so far: <b>{0}</b>  ·  Total stems: <b>{1}</b>', [total_boxes, format_number(total_stems)]),
        indicator: 'blue'
    }, 7);
}

function spec_uom_factor(uom) {
    if (!uom) return 1;
    let m = uom.match(/\((\d+)\)/);
    return m ? cint(m[1]) : 1;
}

function uom_for(stems_per_bunch) {
    return stems_per_bunch ? `Bunch (${cint(stems_per_bunch)})` : '';
}

function next_mix_group(frm) {
    let max = 0;
    (frm.doc.items || []).forEach(r => {
        if (r.custom_mixed_box && r.custom_mix_group) max = Math.max(max, cint(r.custom_mix_group));
    });
    return max + 1;
}

// Bunch analogue of next_mix_group — groups a bouquet's colour lines together.
function next_bunch_group(frm) {
    let max = 0;
    (frm.doc.items || []).forEach(r => {
        if (r.custom_mixed_bunch && r.custom_bunch_group) max = Math.max(max, cint(r.custom_bunch_group));
    });
    return max + 1;
}

// ---- dimension detectors (the ONLY things the router keys off) ----
// BOX dimension: a "Mixed Box" assortment. Blank / "Mono Box" => not mixed.
function is_mixed_box(spec) {
    return spec && spec.box_assortment === 'Mixed Box';
}
// BUNCH dimension: any box_item declares bunch_type = "Mixed Bunch" (bouquet).
function is_mixed_bunch_spec(items) {
    return (items || []).some(bi => bi.bunch_type === 'Mixed Bunch');
}

// source_warehouse -> delivery_warehouse from SO Warehouse Mapping "Roses-MAP".
function load_roses_map() {
    return frappe.db.get_doc('SO Warehouse Mapping', 'Roses-MAP')
        .then(doc => {
            let map = {};
            (doc.items || []).forEach(it => {
                if (it.source_warehouse) map[it.source_warehouse] = it.delivery_warehouse;
            });
            return map;
        })
        .catch(() => ({}));
}

function derive_farm(source_warehouse) {
    let s = source_warehouse || '';
    if (s.includes('Karen') || s.startsWith('KARN')) return 'Karen';
    if (s.includes('Ravine') || s.includes('Kapkolia') || s.startsWith('KAPK')) return 'Kapkolia';
    return '';
}

function consumables_map(spec) {
    let m = {};
    (spec.consumables || []).forEach(c => { if (c.consumable_type) m[c.consumable_type] = c; });
    return m;
}

function match_sleeve(desc) {
    if (!desc) return '';
    let d = desc.toLowerCase();
    if (d.includes('karen')) return 'Karen Branded';
    if (d.includes('clear')) return 'Clear Sleeve';
    return '';
}

// Resolve item_name for one or many item codes -> Promise<{code: name}>.
function fetch_item_names(codes) {
    let unique = Array.from(new Set(codes.filter(Boolean)));
    return Promise.all(
        unique.map(code =>
            frappe.db.get_value('Item', code, 'item_name')
                .then(r => [code, (r.message && r.message.item_name) || code])
        )
    ).then(pairs => Object.fromEntries(pairs));
}

// Common spec-detail fields applied to any item row.
function detail_payload(spec, box_item, cons) {
    let p = {
        custom_cut_stage: spec.cut_stage || '',
        custom_defoliation_length: spec.defoliation_length || '',
        custom_bud_counts: (box_item && box_item.hz_bud_count_range) || '',
        custom_consumables_charge: spec.consumables_charge || 0,
        custom_documentation_fee: spec.documentation_charge || 0,
        custom_certificate_of_origin: spec.certificate_of_origin || 0,
        custom_with_flower_food: cons['Flower Food'] ? 1 : 0
    };
    if (cons['Sleeve']) {
        let s = match_sleeve(cons['Sleeve'].description);
        if (s) p.custom_sleeve_description = s;
    }
    if (cons['Label'] && cons['Label'].description) {
        p.custom_labels_description_on_sleeve = cons['Label'].description;
    }
    return p;
}

/* ================================= router ================================= */
// Reads BOTH dimensions every time and dispatches to exactly one of four
// isolated case handlers. This is the single decision point.

function apply_spec_to_order(frm, cdt, cdn, spec) {
    const cons = consumables_map(spec);
    const items = spec.box_items || [];
    if (!items.length) {
        frappe.msgprint(__('Specification {0} has no box items.', [spec.name]));
        return;
    }

    if (spec.ftnft) frm.set_value('custom_ftnft', spec.ftnft);

    const boxMixed = is_mixed_box(spec);
    const bunchMixed = is_mixed_bunch_spec(items);

    if (!boxMixed && !bunchMixed) {
        case_monobox_monobunch(frm, cdt, cdn, spec, items, cons);   // 1
    } else if (!boxMixed && bunchMixed) {
        case_monobox_mixedbunch(frm, cdt, cdn, spec, items, cons);  // 2
    } else if (boxMixed && !bunchMixed) {
        case_mixedbox_monobunch(frm, cdt, cdn, spec, items, cons);  // 3
    } else {
        case_mixedbox_mixedbunch(frm, cdt, cdn, spec, items, cons); // 4
    }
}

/* ==================== CASE 1 — Mono Box + Mono Bunch ====================== */
/* One straight line per chosen variety. Flags: mixed_box=0, mixed_bunch=0.   */
/* Packrate field: custom_packrate.                                           */

function case_monobox_monobunch(frm, cdt, cdn, spec, items, cons) {
    const varieties = items.filter(bi => bi.variety);
    if (!varieties.length) {
        frappe.msgprint(__('Specification {0} has no varieties.', [spec.name]));
        return;
    }

    const data = varieties.map((bi, idx) => ({
        idx: idx,
        include: 1,
        variety: bi.variety,
        length: bi.length || '',
        pack_rate: cint(bi.pack_rate),
        number_of_boxes: 1
    }));

    const d = new frappe.ui.Dialog({
        title: __('Select varieties & boxes — {0}', [spec.spec_name || spec.name]),
        size: 'large',
        fields: [
            { fieldtype: 'HTML', options: '<div style="font-size:12px;color:#6b6b6b;margin-bottom:6px">Tick the varieties this order needs and set the number of boxes. Ordered quantity (stems/box × boxes) is filled automatically.</div>' },
            { fieldtype: 'Table', fieldname: 'rows', cannot_add_rows: 1, cannot_delete_rows: 1,
              in_place_edit: 1, data: data, get_data: () => data,
              fields: [
                { fieldtype: 'Check', fieldname: 'include', label: __('Use'), in_list_view: 1, columns: 1 },
                { fieldtype: 'Data', fieldname: 'variety', label: __('Variety'), in_list_view: 1, read_only: 1, columns: 4 },
                { fieldtype: 'Data', fieldname: 'length', label: __('Length'), in_list_view: 1, read_only: 1, columns: 2 },
                { fieldtype: 'Int', fieldname: 'pack_rate', label: __('Stems/Box'), in_list_view: 1, read_only: 1, columns: 2 },
                { fieldtype: 'Int', fieldname: 'number_of_boxes', label: __('Boxes'), in_list_view: 1, columns: 2 },
                { fieldtype: 'Int', fieldname: 'idx', hidden: 1 }
              ]
            }
        ],
        primary_action_label: __('Add Selected'),
        primary_action() {
            const rows = d.fields_dict.rows.grid.get_data() || [];
            const chosen = rows.filter(r => r.include)
                .map(r => ({ bi: varieties[cint(r.idx)], boxes: cint(r.number_of_boxes) || 1 }))
                .filter(c => c.bi);
            if (!chosen.length) { frappe.msgprint(__('Tick at least one variety.')); return; }
            d.hide();
            fill_monobox_monobunch_rows(frm, cdt, cdn, spec, chosen, cons);
        }
    });
    d.show();
}

// Fill one straight (mono) line per chosen {bi, boxes}. First fills the
// triggering row; the rest are appended.
function fill_monobox_monobunch_rows(frm, cdt, cdn, spec, chosen, cons) {
    Promise.all([fetch_item_names(chosen.map(c => c.bi.variety)), load_roses_map()])
        .then(([names, map]) => {
            SPEC_AUTOFILL_BUSY = true;
            try {
                chosen.forEach((c, i) => {
                    let rcdt, rcdn;
                    if (i === 0) {
                        rcdt = cdt; rcdn = cdn;            // triggering row
                    } else {
                        let r = frm.add_child('items');     // extra straight line
                        rcdt = r.doctype; rcdn = r.name;
                    }
                    fill_monobox_monobunch_row(rcdt, rcdn, spec, c.bi, cons, names, map, c.boxes);
                });
            } finally {
                SPEC_AUTOFILL_BUSY = false;
            }
            frm.refresh_field('items');
            frappe.show_alert({
                message: __('Filled {0} straight line(s) from {1}', [chosen.length, spec.name]),
                indicator: 'green'
            }, 3);
        });
}

function fill_monobox_monobunch_row(rcdt, rcdn, spec, bi, cons, names, map, boxes) {
    const set = (f, v) => frappe.model.set_value(rcdt, rcdn, f, v);
    const row = locals[rcdt][rcdn];
    const boxesN = cint(boxes) || 1;
    const stems_per_box = cint(bi.pack_rate);

    // custom_line is the trigger field — assign it DIRECTLY (never via set_value,
    // which is async and would re-fire the handler on a later tick and loop).
    // Both flags cleared explicitly: this is the plain mono/mono line.
    if (row) {
        row.custom_line = spec.name;
        row.custom_mixed_box = 0;
        row.custom_mix_group = '';
        row.custom_mixed_bunch = 0;
        row.custom_bunch_group = '';
    }

    set('item_code', bi.variety);
    set('item_name', names[bi.variety] || bi.variety);
    if (bi.length) set('custom_length', bi.length);
    if (bi.box_type) set('custom_box_type', bi.box_type);
    let uom = uom_for(bi.stems_per_bunch);
    if (uom) set('uom', uom);

    set('custom_number_of_boxes', boxesN);
    set('custom_ordered_quantity', stems_per_box * boxesN);

    // Packrate is a Link -> Packrate; set only if a matching record exists.
    let pr = String(stems_per_box);
    frappe.db.exists('Packrate', pr).then(exists => {
        if (exists) set('custom_packrate', pr);
        else frappe.show_alert({ message: __('No Packrate record "{0}" — set packrate manually.', [pr]), indicator: 'orange' }, 6);
    });

    // Delivery warehouse from Roses-MAP when a source warehouse is already on the row.
    if (row && row.custom_source_warehouse) {
        let target = map[row.custom_source_warehouse];
        if (target) set('warehouse', target);
    }

    let p = detail_payload(spec, bi, cons);
    Object.keys(p).forEach(k => set(k, p[k]));
}

/* ==================== CASE 2 — Mono Box + Mixed Bunch ==================== */
/* A bouquet (several colour/variety components) packed in a MONO box.        */
/* One row per component sharing a custom_bunch_group.                        */
/* Flags: mixed_box=0, mixed_bunch=1.  Packrate field: custom_packrate_mixed_box. */

function case_monobox_mixedbunch(frm, cdt, cdn, spec, items, cons) {
    const comps = (items || []).filter(bi => bi.bunch_type === 'Mixed Bunch' && bi.variety);
    if (!comps.length) {
        frappe.msgprint(__('Specification {0} has no Mixed Bunch components.', [spec.name]));
        return;
    }

    load_roses_map().then(map => {
        const sources = Object.keys(map);
        const list_html = comps.map(bi =>
            `<div style="padding:2px 0"><b>${bi.colour || '—'}</b> · ${bi.variety}`
            + ` <span style="color:#6b6b6b">(${cint(bi.stems_per_bunch)} stems/bunch · ${cint(bi.pack_rate)}/box · ${bi.length || 'any'})</span></div>`
        ).join('');

        const d = new frappe.ui.Dialog({
            title: __('Mixed Bunch (mono box) from {0}', [spec.spec_name || spec.name]),
            size: 'large',
            fields: [
                { fieldtype: 'HTML', options: `<div style="font-size:12px;margin-bottom:6px"><div style="font-weight:600;margin-bottom:2px">Bouquet components — one line per colour:</div>${list_html}</div>` },
                { fieldtype: 'Data', fieldname: 'mix_name', label: __('Bunch Name'), default: spec.spec_name, reqd: 1 },
                { fieldtype: 'Select', fieldname: 'source_warehouse', label: __('Source Warehouse'),
                  options: sources.join('\n'), reqd: 1,
                  description: __('Delivery warehouse is set automatically from Roses-MAP.') },
                { fieldtype: 'Int', fieldname: 'number_of_boxes', label: __('Number of Boxes'), default: 1, reqd: 1 }
            ],
            primary_action_label: __('Generate Rows'),
            primary_action(values) {
                d.hide();
                fill_monobox_mixedbunch_rows(frm, cdt, cdn, spec, cons, values, map, comps);
            }
        });
        d.show();
    });
}

function fill_monobox_mixedbunch_rows(frm, cdt, cdn, spec, cons, values, map, comps) {
    const boxes = cint(values.number_of_boxes) || 1;
    const source = values.source_warehouse || '';
    const delivery = map[source] || '';
    const group = next_bunch_group(frm);

    fetch_item_names(comps.map(bi => bi.variety)).then(names => {
        SPEC_AUTOFILL_BUSY = true;
        frm.doc.items = (frm.doc.items || []).filter(r => r.name !== cdn);

        comps.forEach(bi => {
            const stems_per_box = cint(bi.pack_rate);
            const uom = uom_for(bi.stems_per_bunch);
            let row = frm.add_child('items');
            row.item_code = bi.variety;
            row.item_name = names[bi.variety] || bi.variety;
            row.uom = uom;
            row.custom_line = spec.name;
            row.custom_mixed_box = 0;          // MONO box
            row.custom_mix_group = '';
            row.custom_mixed_bunch = 1;        // MIXED bunch
            row.custom_bunch_group = group;
            row.custom_mix_name = (values.mix_name || spec.spec_name || '').trim();
            row.custom_packrate_mixed_box = stems_per_box;
            row.custom_number_of_boxes = boxes;
            row.custom_length = bi.length;
            row.custom_box_type = bi.box_type;
            row.custom_ordered_quantity = stems_per_box * boxes;
            row.custom_truck = 0;
            row.custom_source_warehouse = source;
            row.warehouse = delivery;
            let total_stems = stems_per_box * boxes;
            row.stock_qty = total_stems;
            row.qty = total_stems / spec_uom_factor(uom);
            row.conversion_factor = spec_uom_factor(uom) || 1;   // rows built directly (no set_value) never fetch the UOM factor -> set it to avoid "UOM Conversion Factor is required" on save
            let p = detail_payload(spec, bi, cons);
            Object.assign(row, p);
        });

        SPEC_AUTOFILL_BUSY = false;
        frm.refresh_field('items');
        frappe.show_alert({
            message: __('Mixed bunch (mono box) "{0}" added: {1} colour(s) × {2} box(es) → {3}',
                [values.mix_name, comps.length, boxes, delivery || '(no map)']),
            indicator: 'green'
        }, 4);
    });
}

/* ==================== CASE 3 — Mixed Box + Mono Bunch ==================== */
/* One variety per COLOUR (interchangeable within a colour); operator picks   */
/* one, informed by live shelf availability per farm. Rows share a mix group. */
/* Flags: mixed_box=1, mixed_bunch=0.  Packrate field: custom_packrate_mixed_box. */

function case_mixedbox_monobunch(frm, cdt, cdn, spec, items, cons) {
    const varieties = items.filter(bi => bi.variety);
    if (!varieties.length) {
        frappe.msgprint(__('Specification {0} has no varieties.', [spec.name]));
        return;
    }

    // Group box items by colour (fall back to the variety itself if blank).
    const groups = {};
    const order = [];
    varieties.forEach(bi => {
        const key = bi.colour || ('__' + bi.variety);
        if (!groups[key]) { groups[key] = []; order.push(key); }
        groups[key].push(bi);
    });

    // Fetch shelf availability per stem length present in the spec.
    const lengths = Array.from(new Set(varieties.map(bi => bi.length).filter(Boolean)));
    const availCalls = (lengths.length ? lengths : [null]).map(L =>
        frappe.call({
            method: 'getShelfAvailability',
            args: {
                varieties: varieties.filter(bi => !L || bi.length === L).map(bi => bi.variety),
                stem_length: L || ''
            }
        }).then(r => (r.message && r.message.availability) || {}).catch(() => ({}))
    );

    Promise.all([load_roses_map(), Promise.all(availCalls)]).then(([map, availList]) => {
        const avail = Object.assign({}, ...availList);   // { variety: { farm: stems } }
        const sources = Object.keys(map);

        const total_for = (v) => Object.values(avail[v] || {}).reduce((a, b) => a + b, 0);
        const avail_html = (grp) => grp.map(bi => {
            const farms = avail[bi.variety] || {};
            const parts = Object.keys(farms).sort((a, b) => farms[b] - farms[a])
                .map(f => `${f}: ${format_number(farms[f])}`);
            const total = total_for(bi.variety);
            return `<div style="padding:2px 0"><b>${bi.variety}</b> — ${format_number(total)} stems`
                + (parts.length ? ` <span style="color:#6b6b6b">(${parts.join(', ')})</span>` : ' <span style="color:#b45309">(no shelf stock)</span>')
                + `</div>`;
        }).join('');

        const fields = [
            { fieldtype: 'Data', fieldname: 'mix_name', label: __('Mix Name'), default: spec.spec_name, reqd: 1 },
            { fieldtype: 'Select', fieldname: 'source_warehouse', label: __('Source Warehouse'),
              options: sources.join('\n'), reqd: 1,
              description: __('Delivery warehouse is set automatically from Roses-MAP.') },
            { fieldtype: 'Int', fieldname: 'number_of_boxes', label: __('Number of Boxes'), default: 1, reqd: 1 },
            { fieldtype: 'Section Break', label: __('Box contents — one variety per colour') }
        ];

        order.forEach((key, i) => {
            const grp = groups[key];
            const colour = grp[0].colour || grp[0].variety;
            const defStems = Math.max.apply(null, grp.map(bi => cint(bi.pack_rate)).concat([0]));
            // Default to the variety with the most shelf stock.
            let best = grp[0].variety, bestQty = -1;
            grp.forEach(bi => { const q = total_for(bi.variety); if (q > bestQty) { bestQty = q; best = bi.variety; } });

            fields.push({ fieldtype: 'HTML', fieldname: 'avail_' + i,
                options: `<div style="font-size:12px;margin-bottom:4px"><div style="font-weight:600;margin-bottom:2px">${colour} — shelf availability @ ${grp[0].length || 'any'}</div>${avail_html(grp)}</div>` });
            fields.push({ fieldtype: 'Select', fieldname: 'variety_' + i, label: __('{0} variety', [colour]),
                options: grp.map(bi => bi.variety).join('\n'), default: best, reqd: 1 });
            fields.push({ fieldtype: 'Int', fieldname: 'stems_' + i, label: __('{0} stems per box', [colour]), default: defStems, reqd: 1 });
        });

        const d = new frappe.ui.Dialog({
            title: __('Mixed Box from {0}', [spec.spec_name || spec.name]),
            size: 'large',
            fields: fields,
            primary_action_label: __('Generate Rows'),
            primary_action(values) {
                const selections = order.map((key, i) => {
                    const grp = groups[key];
                    const chosen = values['variety_' + i];
                    const bi = grp.find(b => b.variety === chosen) || grp[0];
                    return { bi: bi, stems: cint(values['stems_' + i]) };
                }).filter(s => s.bi && s.stems > 0);
                if (!selections.length) { frappe.msgprint(__('Enter stems for at least one colour.')); return; }
                d.hide();
                fill_mixedbox_monobunch_rows(frm, cdt, cdn, spec, cons, values, map, selections);
            }
        });
        d.show();
    });
}

// One row per chosen colour/variety, sharing a mix group. (custom_farm left
// blank — the SO header carries the farm.)
function fill_mixedbox_monobunch_rows(frm, cdt, cdn, spec, cons, values, map, selections) {
    const boxes = cint(values.number_of_boxes) || 1;
    const source = values.source_warehouse || '';
    const delivery = map[source] || '';
    const group = next_mix_group(frm);

    fetch_item_names(selections.map(s => s.bi.variety)).then(names => {
        SPEC_AUTOFILL_BUSY = true;
        frm.doc.items = (frm.doc.items || []).filter(r => r.name !== cdn);

        selections.forEach(sel => {
            const bi = sel.bi;
            const stems_per_box = cint(sel.stems);
            const uom = uom_for(bi.stems_per_bunch);
            let row = frm.add_child('items');
            row.item_code = bi.variety;
            row.item_name = names[bi.variety] || bi.variety;
            row.uom = uom;
            row.custom_line = spec.name;
            row.custom_mixed_box = 1;          // MIXED box
            row.custom_mix_group = group;
            row.custom_mixed_bunch = 0;        // MONO bunch
            row.custom_bunch_group = '';
            row.custom_mix_name = (values.mix_name || spec.spec_name || '').trim();
            row.custom_packrate_mixed_box = stems_per_box;
            row.custom_number_of_boxes = boxes;
            row.custom_length = bi.length;
            row.custom_box_type = bi.box_type;
            row.custom_ordered_quantity = stems_per_box * boxes;
            row.custom_truck = 0;
            row.custom_source_warehouse = source;
            row.warehouse = delivery;
            let total_stems = stems_per_box * boxes;
            row.stock_qty = total_stems;
            row.qty = total_stems / spec_uom_factor(uom);
            row.conversion_factor = spec_uom_factor(uom) || 1;   // rows built directly (no set_value) never fetch the UOM factor -> set it to avoid "UOM Conversion Factor is required" on save
            let p = detail_payload(spec, bi, cons);
            Object.assign(row, p);
        });

        SPEC_AUTOFILL_BUSY = false;
        frm.refresh_field('items');
        frappe.show_alert({
            message: __('Mix "{0}" added: {1} colour(s) × {2} box(es) → {3}',
                [values.mix_name, selections.length, boxes, delivery || '(no map)']),
            indicator: 'green'
        }, 4);
    });
}

/* ==================== CASE 4 — Mixed Box + Mixed Bunch =================== */
/* A bouquet (several colour/variety components) packed in a MIXED box.       */
/* One row per component sharing a custom_bunch_group.                        */
/* Flags: mixed_box=1, mixed_bunch=1.  Packrate field: custom_packrate_mixed_box. */

function case_mixedbox_mixedbunch(frm, cdt, cdn, spec, items, cons) {
    const comps = (items || []).filter(bi => bi.bunch_type === 'Mixed Bunch' && bi.variety);
    if (!comps.length) {
        frappe.msgprint(__('Specification {0} has no Mixed Bunch components.', [spec.name]));
        return;
    }

    load_roses_map().then(map => {
        const sources = Object.keys(map);
        const list_html = comps.map(bi =>
            `<div style="padding:2px 0"><b>${bi.colour || '—'}</b> · ${bi.variety}`
            + ` <span style="color:#6b6b6b">(${cint(bi.stems_per_bunch)} stems/bunch · ${cint(bi.pack_rate)}/box · ${bi.length || 'any'})</span></div>`
        ).join('');

        const d = new frappe.ui.Dialog({
            title: __('Mixed Bunch (mixed box) from {0}', [spec.spec_name || spec.name]),
            size: 'large',
            fields: [
                { fieldtype: 'HTML', options: `<div style="font-size:12px;margin-bottom:6px"><div style="font-weight:600;margin-bottom:2px">Bouquet components — one line per colour:</div>${list_html}</div>` },
                { fieldtype: 'Data', fieldname: 'mix_name', label: __('Bunch Name'), default: spec.spec_name, reqd: 1 },
                { fieldtype: 'Select', fieldname: 'source_warehouse', label: __('Source Warehouse'),
                  options: sources.join('\n'), reqd: 1,
                  description: __('Delivery warehouse is set automatically from Roses-MAP.') },
                { fieldtype: 'Int', fieldname: 'number_of_boxes', label: __('Number of Boxes'), default: 1, reqd: 1 }
            ],
            primary_action_label: __('Generate Rows'),
            primary_action(values) {
                d.hide();
                fill_mixedbox_mixedbunch_rows(frm, cdt, cdn, spec, cons, values, map, comps);
            }
        });
        d.show();
    });
}

function fill_mixedbox_mixedbunch_rows(frm, cdt, cdn, spec, cons, values, map, comps) {
    const boxes = cint(values.number_of_boxes) || 1;
    const source = values.source_warehouse || '';
    const delivery = map[source] || '';
    const group = next_bunch_group(frm);

    fetch_item_names(comps.map(bi => bi.variety)).then(names => {
        SPEC_AUTOFILL_BUSY = true;
        frm.doc.items = (frm.doc.items || []).filter(r => r.name !== cdn);

        comps.forEach(bi => {
            const stems_per_box = cint(bi.pack_rate);
            const uom = uom_for(bi.stems_per_bunch);
            let row = frm.add_child('items');
            row.item_code = bi.variety;
            row.item_name = names[bi.variety] || bi.variety;
            row.uom = uom;
            row.custom_line = spec.name;
            row.custom_mixed_box = 1;          // MIXED box
            row.custom_mix_group = '';
            row.custom_mixed_bunch = 1;        // MIXED bunch
            row.custom_bunch_group = group;
            row.custom_mix_name = (values.mix_name || spec.spec_name || '').trim();
            row.custom_packrate_mixed_box = stems_per_box;
            row.custom_number_of_boxes = boxes;
            row.custom_length = bi.length;
            row.custom_box_type = bi.box_type;
            row.custom_ordered_quantity = stems_per_box * boxes;
            row.custom_truck = 0;
            row.custom_source_warehouse = source;
            row.warehouse = delivery;
            let total_stems = stems_per_box * boxes;
            row.stock_qty = total_stems;
            row.qty = total_stems / spec_uom_factor(uom);
            row.conversion_factor = spec_uom_factor(uom) || 1;   // rows built directly (no set_value) never fetch the UOM factor -> set it to avoid "UOM Conversion Factor is required" on save
            let p = detail_payload(spec, bi, cons);
            Object.assign(row, p);
        });

        SPEC_AUTOFILL_BUSY = false;
        frm.refresh_field('items');
        frappe.show_alert({
            message: __('Mixed bunch (mixed box) "{0}" added: {1} colour(s) × {2} box(es) → {3}',
                [values.mix_name, comps.length, boxes, delivery || '(no map)']),
            indicator: 'green'
        }, 4);
    });
}
