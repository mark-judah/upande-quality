// Client Script — DocType: Sales Order, View: Form
// Name: Autofill Sales Order By Specification
//
// Single source of truth for spec-driven Sales Order population.
//   box_assortment = "Mono Box"  -> fills a STRAIGHT line per box item (no popup,
//                                   no mix group). The first box item fills the
//                                   triggering row; extra box items are added as
//                                   their own straight lines.
//   box_assortment = "Mixed Box" -> prompts for source warehouse / boxes, then
//                                   generates grouped mix rows sharing a mix group.
// Delivery (target) warehouse is resolved from SO Warehouse Mapping "Roses-MAP".
// Pricing + qty are left to the reactive scripts (packrate/boxes -> qty, price),
// so mono fields are set via frappe.model.set_value to fire those triggers.

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

/* ---------- helpers ---------- */

// Only show Specifications belonging to the selected customer in the spec
// (custom_line) picker on each item row.
function set_spec_query(frm) {
    frm.set_query('custom_line', 'items', () => {
        return frm.doc.customer ? { filters: { customer: frm.doc.customer } } : {};
    });
}

// Ordered quantity = packrate × number of boxes (mono uses custom_packrate,
// mixed uses custom_packrate_mixed_box). Replaces manual entry.
function set_ordered_qty(frm, cdt, cdn) {
    let row = locals[cdt][cdn];
    if (!row) return;
    let boxes = cint(row.custom_number_of_boxes);
    let per = row.custom_mixed_box ? flt(row.custom_packrate_mixed_box) : flt(row.custom_packrate);
    if (boxes && per) {
        frappe.model.set_value(cdt, cdn, 'custom_ordered_quantity', per * boxes);
    }
}

// Popup the running totals whenever a box count changes, so the packer can
// track progress toward the number of boxes the customer ordered.
// Stems are derived from packrate × boxes (timing-independent of the qty engine).
function show_box_tally(frm) {
    let total_boxes = 0, total_stems = 0;
    (frm.doc.items || []).forEach(it => {
        let boxes = cint(it.custom_number_of_boxes);
        if (!boxes) return;
        total_boxes += boxes;
        let per = it.custom_mixed_box ? flt(it.custom_packrate_mixed_box) : flt(it.custom_packrate);
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

/* ---------- main ---------- */

function apply_spec_to_order(frm, cdt, cdn, spec) {
    const cons = consumables_map(spec);
    const items = spec.box_items || [];
    if (!items.length) {
        frappe.msgprint(__('Specification {0} has no box items.', [spec.name]));
        return;
    }

    if (spec.ftnft) frm.set_value('custom_ftnft', spec.ftnft);

    // ONLY the assortment decides the path — a Mono Box with several box items
    // is still mono (one straight line each), NOT a mixed box.
    if (spec.box_assortment === 'Mixed Box') {
        prompt_and_apply_mixed(frm, cdt, cdn, spec, items, cons);
    } else {
        apply_mono_lines(frm, cdt, cdn, spec, items, cons);
    }
}

// Mono: one straight line per box item. First box item fills the triggering row;
// the rest are appended as their own straight lines.
function apply_mono_lines(frm, cdt, cdn, spec, items, cons) {
    const varieties = items.filter(bi => bi.variety);
    if (!varieties.length) {
        frappe.msgprint(__('Specification {0} has no varieties.', [spec.name]));
        return;
    }

    // Single variety -> fill straight away. Multiple -> let the user pick which
    // variety/varieties this order actually needs (multi-select).
    if (varieties.length === 1) {
        do_fill_mono(frm, cdt, cdn, spec, varieties, cons);
        return;
    }

    const options = varieties.map((bi, idx) => ({
        label: bi.variety + (bi.length ? ' · ' + bi.length : '') + (bi.box_type ? ' · ' + bi.box_type : ''),
        value: String(idx),
        checked: 1
    }));

    let d = new frappe.ui.Dialog({
        title: __('Select varieties — {0}', [spec.name]),
        fields: [
            {
                fieldtype: 'MultiCheck', fieldname: 'picks', columns: 1,
                label: __('Which varieties does this order need?'),
                options: options
            }
        ],
        primary_action_label: __('Add Selected'),
        primary_action(values) {
            let chosen = (values.picks || []).map(i => varieties[cint(i)]).filter(Boolean);
            if (!chosen.length) {
                frappe.msgprint(__('Select at least one variety.'));
                return;
            }
            d.hide();
            do_fill_mono(frm, cdt, cdn, spec, chosen, cons);
        }
    });
    d.show();
}

// Fill one straight (mono) line per chosen box item. First fills the triggering
// row; the rest are appended.
function do_fill_mono(frm, cdt, cdn, spec, chosen, cons) {
    Promise.all([fetch_item_names(chosen.map(bi => bi.variety)), load_roses_map()])
        .then(([names, map]) => {
            SPEC_AUTOFILL_BUSY = true;
            try {
                chosen.forEach((bi, i) => {
                    let rcdt, rcdn;
                    if (i === 0) {
                        rcdt = cdt; rcdn = cdn;            // triggering row
                    } else {
                        let r = frm.add_child('items');     // extra straight line
                        rcdt = r.doctype; rcdn = r.name;
                    }
                    fill_mono_row(rcdt, rcdn, spec, bi, cons, names, map);
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

function fill_mono_row(rcdt, rcdn, spec, bi, cons, names, map) {
    const set = (f, v) => frappe.model.set_value(rcdt, rcdn, f, v);
    const row = locals[rcdt][rcdn];

    // custom_line is the trigger field for this whole handler — assign it
    // DIRECTLY (never via set_value, which is async and would re-fire the
    // handler on a later tick and loop). Same for the mix flags.
    if (row) {
        row.custom_line = spec.name;
        row.custom_mixed_box = 0;
        row.custom_mix_group = '';
    }

    set('item_code', bi.variety);
    set('item_name', names[bi.variety] || bi.variety);
    if (bi.length) set('custom_length', bi.length);
    if (bi.box_type) set('custom_box_type', bi.box_type);
    let uom = uom_for(bi.stems_per_bunch);
    if (uom) set('uom', uom);

    // Packrate is a Link -> Packrate; set only if a matching record exists.
    let pr = String(cint(bi.pack_rate));
    frappe.db.exists('Packrate', pr).then(exists => {
        if (exists) set('custom_packrate', pr);
        else frappe.show_alert({ message: __('No Packrate record "{0}" — set boxes/packrate manually.', [pr]), indicator: 'orange' }, 6);
    });

    // Delivery warehouse from Roses-MAP when a source warehouse is already on the row.
    if (row && row.custom_source_warehouse) {
        let target = map[row.custom_source_warehouse];
        if (target) set('warehouse', target);
    }

    let p = detail_payload(spec, bi, cons);
    Object.keys(p).forEach(k => set(k, p[k]));
}

/* ---------- mixed ---------- */

function prompt_and_apply_mixed(frm, cdt, cdn, spec, items, cons) {
    load_roses_map().then(map => {
        let sources = Object.keys(map);
        let d = new frappe.ui.Dialog({
            title: __('Mixed Box from {0}', [spec.name]),
            fields: [
                { fieldtype: 'Data', fieldname: 'mix_name', label: __('Mix Name'), default: spec.spec_name, reqd: 1 },
                {
                    fieldtype: 'Select', fieldname: 'source_warehouse', label: __('Source Warehouse'),
                    options: sources.join('\n'), reqd: 1,
                    description: __('Delivery warehouse is set automatically from Roses-MAP.')
                },
                { fieldtype: 'Int', fieldname: 'number_of_boxes', label: __('Number of Boxes'), default: 1, reqd: 1 }
            ],
            primary_action_label: __('Generate Rows'),
            primary_action(values) {
                d.hide();
                generate_mixed_rows(frm, cdt, cdn, spec, items, cons, values, map);
            }
        });
        d.show();
    });
}

function generate_mixed_rows(frm, cdt, cdn, spec, items, cons, values, map) {
    const boxes = cint(values.number_of_boxes) || 1;
    const source = values.source_warehouse || '';
    const delivery = map[source] || '';
    const farm = derive_farm(source);
    const group = next_mix_group(frm);
    const varieties = items.filter(bi => bi.variety);

    fetch_item_names(varieties.map(bi => bi.variety)).then(names => {
        SPEC_AUTOFILL_BUSY = true;
        // Remove the triggering placeholder row.
        frm.doc.items = (frm.doc.items || []).filter(r => r.name !== cdn);

        varieties.forEach(bi => {
            let row = frm.add_child('items');
            let stems_per_box = cint(bi.pack_rate);
            let uom = uom_for(bi.stems_per_bunch);
            row.item_code = bi.variety;
            row.item_name = names[bi.variety] || bi.variety;
            row.uom = uom;
            row.custom_line = spec.name;
            row.custom_mixed_box = 1;
            row.custom_mix_group = group;
            row.custom_mix_name = (values.mix_name || spec.spec_name || '').trim();
            row.custom_packrate_mixed_box = stems_per_box;
            row.custom_number_of_boxes = boxes;
            row.custom_length = bi.length;
            row.custom_box_type = bi.box_type;
            row.custom_ordered_quantity = stems_per_box * boxes;
            row.custom_truck = 0;
            row.custom_farm = farm;
            row.custom_source_warehouse = source;
            row.warehouse = delivery;
            let total_stems = stems_per_box * boxes;
            row.stock_qty = total_stems;
            row.qty = total_stems / spec_uom_factor(uom);
            let p = detail_payload(spec, bi, cons);
            Object.assign(row, p);
        });

        SPEC_AUTOFILL_BUSY = false;
        frm.refresh_field('items');
        frappe.show_alert({
            message: __('Mix "{0}" added: {1} varieties × {2} boxes → {3}', [values.mix_name, varieties.length, boxes, delivery || '(no map)']),
            indicator: 'green'
        }, 4);
    });
}
