/* =====================================================
   STRAIGHT BOX LOGIC (UNCHANGED)
   ===================================================== */

frappe.ui.form.on('Sales Order Item', {
    custom_packrate(frm, cdt, cdn) {
        calculate_qty(frm, cdt, cdn);
    },

    custom_number_of_boxes(frm, cdt, cdn) {
        calculate_qty(frm, cdt, cdn);
    },

    uom(frm, cdt, cdn) {
        calculate_qty(frm, cdt, cdn);
    },

    item_code(frm, cdt, cdn) {
        let row = locals[cdt][cdn];
        if (!row.item_code) return;

        frappe.db.get_value(
            'Item',
            row.item_code,
            ['stock_uom', 'item_name', 'item_group'],
            r => {
                if (r?.message) {
                    frappe.model.set_value(cdt, cdn, 'item_name', r.message.item_name);

                    // Only override uom for Sprays — for other groups
                    // the Line script sets uom from bunch_rate
                    if (r.message.item_group === 'Spray Roses') {
                        frappe.model.set_value(cdt, cdn, 'uom', r.message.stock_uom);
                    }
                }
            }
        );
    }
});

function calculate_qty(frm, cdt, cdn) {
    let row = locals[cdt][cdn];

    if (row.custom_mixed_box) return;

    if (row.custom_packrate && row.custom_number_of_boxes && row.uom) {
        let stems = flt(row.custom_packrate) * flt(row.custom_number_of_boxes);
        let factor = extract_uom_factor(row.uom);
        let qty = stems / factor;

        frappe.model.set_value(cdt, cdn, 'qty', qty);
        frappe.model.set_value(cdt, cdn, 'stock_qty', stems);

        frappe.show_alert({
            message: __('Calculated: {0} {1} ({2} stems)', [qty.toFixed(2), row.uom, stems]),
            indicator: 'green'
        }, 3);
    }
}

/* =====================================================
   UTILITIES
   ===================================================== */

function extract_uom_factor(uom) {
    if (!uom) return 1;
    let match = uom.match(/\((\d+)\)/);
    return match ? cint(match[1]) : 1;
}

function generate_mix_group_number(frm) {
    let max = 0;
    frm.doc.items.forEach(r => {
        if (r.custom_mixed_box && r.custom_mix_group) {
            max = Math.max(max, cint(r.custom_mix_group));
        }
    });
    return max + 1;
}

function get_warehouses(farm) {
    if (!farm) return { source: '', warehouse: '' };

    if (farm === 'Karen') {
        return {
            source: 'Karen Available for Sale - KR',
            warehouse: 'Karen Graded Sold - KR'
        };
    }

    if (farm === 'Kapkolia') {
        return {
            source: 'Ravine Available for Sale - KR',
            warehouse: 'Ravine Graded Sold - KR'
        };
    }

    return { source: '', warehouse: '' };
}

/* =====================================================
   REVERSE: read mixed box rows back into wizard format
   ===================================================== */

function extract_mixes_from_items(frm) {
    // Group rows by custom_mix_group number
    let group_map = {};
    frm.doc.items.forEach(row => {
        if (!row.custom_mixed_box || !row.item_code) return;
        let g = cint(row.custom_mix_group);
        if (!group_map[g]) group_map[g] = [];
        group_map[g].push(row);
    });

    // Sort groups by group number so navigation order matches original
    let group_numbers = Object.keys(group_map).map(Number).sort((a, b) => a - b);
    if (!group_numbers.length) return null;

    return group_numbers.map(g => {
        let rows = group_map[g];

        // Derive farm from source warehouse
        let farm = '';
        let source = rows[0].custom_source_warehouse || '';
        if (source.includes('Karen')) farm = 'Karen';
        else if (source.includes('Ravine')) farm = 'Kapkolia';

        // Derive packrate from the box total
        // custom_packrate_mixed_box is stems per variety per box
        // we need the total stems per box across all varieties
        let total_stems_per_box = rows.reduce(
            (sum, r) => sum + cint(r.custom_packrate_mixed_box || 0),
            0
        );

        // number_of_boxes is the group-level box count — take from first row
        let number_of_boxes = cint(rows[0].custom_number_of_boxes || 1);

        return {
            farm,
            // User-defined mix name — take from first row, fallback empty
            mix_name: rows[0].custom_mix_name || '',
            packrate: String(total_stems_per_box),
            number_of_boxes,
            box_type: rows[0].custom_box_type || '',
            // Original group number — used to replace only these rows on save
            original_group: g,
            varieties: rows.map(r => ({
                item_code: r.item_code || '',
                item_name: r.item_name || '',
                custom_length: r.custom_length || '',
                stems_per_box: cint(r.custom_packrate_mixed_box || 0),
                number_of_boxes: cint(r.custom_number_of_boxes || 1),
                ordered_quantity: cint(r.custom_ordered_quantity || 0),
                uom: r.uom || ''
            }))
        };
    });
}

/* =====================================================
   MEMORY & DRAFT (localStorage)
   ===================================================== */

const MIXED_BOX_STORAGE_KEY = 'mixed_box_wizard_state_v3';

function get_last_mixed_state() {
    try {
        const json = localStorage.getItem(MIXED_BOX_STORAGE_KEY);
        return json ? JSON.parse(json) : null;
    } catch (e) {
        console.error('Failed to parse mixed box storage:', e);
        return null;
    }
}

function save_mixed_state(mixes_array) {
    if (!mixes_array || mixes_array.length === 0) return;

    try {
        localStorage.setItem(MIXED_BOX_STORAGE_KEY, JSON.stringify(mixes_array));
        console.log('[MixedBox] Saved to storage:', mixes_array.length, 'groups');
    } catch (e) {
        console.error('Failed to save mixed box state:', e);
    }
}

/* =====================================================
   MIXED BOX BUTTON & NAVIGABLE WIZARD DIALOG
   ===================================================== */

frappe.ui.form.on('Sales Order', {
    refresh(frm) {
        frm.add_custom_button(__('Add Mixed Boxes'), () => {
            open_multi_mix_wizard(frm, false);
        }, __('Actions'));

        // Only show Edit if there are mixed box rows on the order
        let has_mixed = (frm.doc.items || []).some(r => r.custom_mixed_box);
        if (has_mixed) {
            frm.add_custom_button(__('Edit Mixed Boxes'), () => {
                open_multi_mix_wizard(frm, true);
            }, __('Actions'));
        }
    }
});

function open_multi_mix_wizard(frm, edit_mode) {
    let current_index = 0;
    let mixes = [];

    if (edit_mode) {
        // Reverse-populate from the child table
        let extracted = extract_mixes_from_items(frm);
        if (!extracted || !extracted.length) {
            frappe.msgprint(__('No mixed box rows found on this order.'));
            return;
        }
        mixes = extracted;
        frappe.show_alert({
            message: __('Loaded {0} mix group(s) for editing', [mixes.length]),
            indicator: 'blue'
        }, 5);
    } else {
        const last_session = get_last_mixed_state();
        if (last_session && Array.isArray(last_session) && last_session.length > 0) {
            mixes = last_session;
            frappe.show_alert({
                message: __('Restored previous session (' + mixes.length + ' groups)'),
                indicator: 'blue'
            }, 5);
        } else {
            mixes = [{}];
        }
    }

    let dialog = new frappe.ui.Dialog({
        title: edit_mode ? __('Edit Mixed Boxes – Group 1') : __('Mixed Boxes – Group 1'),
        size: 'large',
        fields: [
            {
                fieldtype: 'Data',
                fieldname: 'mix_name',
                label: 'Mix Name',
                reqd: 1
            },
            {
                fieldtype: 'Column Break'
            },
            {
                fieldtype: 'Link',
                fieldname: 'farm',
                label: 'Farm',
                options: 'Farm',
                reqd: 1,
                get_query() {
                    return {
                        filters: { custom_handles_sales: 1 }
                    };
                }
            },
            {
                fieldtype: 'Section Break'
            },
            {
                fieldtype: 'Link',
                fieldname: 'packrate',
                label: 'Packrate',
                options: 'Packrate',
                reqd: 1
            },
            {
                fieldtype: 'Int',
                fieldname: 'number_of_boxes',
                label: 'Number of Boxes',
                default: 1,
                reqd: 1
            },
            {
                fieldtype: 'Link',
                fieldname: 'box_type',
                label: 'Box Type',
                options: 'Box Type',
                reqd: 1
            },
            {
                fieldtype: 'HTML',
                fieldname: 'nav_status',
                options: `
                    <div style="
                        display: flex;
                        align-items: center;
                        justify-content: space-between;
                        background: #f0f5ff;
                        border: 1px solid #d0e0ff;
                        border-radius: 8px;
                        padding: 10px 16px;
                        margin: 12px 0 4px;
                    ">
                        <div style="font-size: 0.88em; color: #555; font-weight: 500; letter-spacing: 0.01em;">
                            GROUP
                            <span style="
                                font-size: 1.2em;
                                font-weight: 700;
                                color: #2563eb;
                                margin: 0 2px;
                            " id="current-group-num">1</span>
                            <span style="color:#aaa;">of</span>
                            <span style="
                                font-size: 1.2em;
                                font-weight: 700;
                                color: #2563eb;
                                margin: 0 2px;
                            " id="total-groups">1</span>
                        </div>
                        <div style="
                            background: #2563eb;
                            color: white;
                            border-radius: 20px;
                            padding: 4px 14px;
                            font-size: 0.82em;
                            font-weight: 600;
                            letter-spacing: 0.02em;
                        ">
                            <span id="stem-total">0</span> stems / box
                        </div>
                        <a href="#" id="clear-session-link" style="
                            font-size: 0.8em;
                            color: #e74c3c;
                            text-decoration: none;
                            font-weight: 500;
                            border: 1px solid #f5c6c6;
                            border-radius: 4px;
                            padding: 3px 10px;
                        "
                            onmouseover="this.style.background='#fff0f0'"
                            onmouseout="this.style.background='transparent'"
                        >Clear all groups</a>
                    </div>`
            },
            {
                fieldtype: 'Table',
                fieldname: 'varieties',
                label: 'Varieties per Box',
                cannot_add_rows: false,
                cannot_delete_rows: false,
                fields: [
                    {
                        fieldtype: 'Link',
                        fieldname: 'item_code',
                        label: 'Variety',
                        options: 'Item',
                        in_list_view: 1,
                        reqd: 1,
                        columns: 2,
                        onchange() {
                            save_current_group();
                        }
                    },
                    {
                        fieldtype: 'Link',
                        fieldname: 'custom_length',
                        label: 'Length',
                        options: 'Stem Length',
                        in_list_view: 1,
                        reqd: 1,
                        columns: 1,
                        onchange() {
                            update_stem_counter(dialog);
                            save_current_group();
                        }
                    },
                    {
                        fieldtype: 'Int',
                        fieldname: 'stems_per_box',
                        label: 'Stems / Box',
                        in_list_view: 1,
                        reqd: 1,
                        columns: 1,
                        onchange() {
                            update_stem_counter(dialog);
                            save_current_group();
                        }
                    },
                    {
                        fieldtype: 'Int',
                        fieldname: 'number_of_boxes',
                        label: 'Appears in # boxes',
                        in_list_view: 1,
                        reqd: 1,
                        default: 1,
                        columns: 1,
                        description: 'How many boxes in this mix contain this variety'
                    },
                    {
                        fieldtype: 'Int',
                        fieldname: 'ordered_quantity',
                        label: 'Ordered Qty',
                        in_list_view: 1,
                        reqd: 1,
                        columns: 1,
                        onchange() {
                            save_current_group();
                        }
                    },
                    {
                        fieldtype: 'Link',
                        fieldname: 'uom',
                        label: 'UOM',
                        options: 'UOM',
                        read_only: 1,
                        in_list_view: 1,
                        columns: 1
                    }
                ]
            }
        ],
        primary_action_label: __('Finish & Save All Groups'),
        primary_action() {
            save_current_group();

            if (mixes.every(m => !m.packrate || !m.varieties?.length)) {
                frappe.throw(__('At least one valid mix group is required'));
                return;
            }

            // Collect all unique item_codes to batch-fetch UOMs
            let items_needing_uom = new Set();
            mixes.forEach(values => {
                (values.varieties || []).forEach(v => {
                    if (v.item_code) items_needing_uom.add(v.item_code);
                });
            });

            let item_list = [...items_needing_uom];
            if (item_list.length === 0) {
                validate_and_submit();
                return;
            }

            frappe.call({
                method: 'frappe.client.get_list',
                args: {
                    doctype: 'Item',
                    filters: [['name', 'in', item_list]],
                    fields: ['name', 'sales_uom', 'item_name'],
                    limit: item_list.length
                },
                callback(r) {
                    if (r?.message) {
                        let uom_map = {};
                        r.message.forEach(item => {
                            uom_map[item.name] = {
                                uom: item.sales_uom || '',
                                item_name: item.item_name || ''
                            };
                        });

                        mixes.forEach(values => {
                            (values.varieties || []).forEach(v => {
                                if (v.item_code && uom_map[v.item_code]) {
                                    v.uom = uom_map[v.item_code].uom;
                                    v.item_name = uom_map[v.item_code].item_name;
                                }
                            });
                        });
                    }
                    validate_and_submit();
                }
            });
        }
    });

    // Validate and submit
    function validate_and_submit() {
        // Check duplicate mix names across groups
        let name_counts = {};
        mixes.forEach(m => {
            if (m.mix_name && m.varieties?.length) {
                let key = String(m.mix_name).trim().toLowerCase();
                name_counts[key] = (name_counts[key] || 0) + 1;
            }
        });
        let duplicate = Object.entries(name_counts).find(([, c]) => c > 1);
        if (duplicate) {
            frappe.throw(__('Mix Name "{0}" is used by more than one group. Each group must have a unique name.', [duplicate[0]]));
            return;
        }

        for (let i = 0; i < mixes.length; i++) {
            let values = mixes[i];
            if (!values.packrate || !values.varieties?.length) continue;

            if (!values.mix_name || !String(values.mix_name).trim()) {
                frappe.throw(__('Group {0}: Mix Name is required', [i + 1]));
                return;
            }

            if (!values.farm) {
                frappe.throw(__('Group {0}: Farm is required', [i + 1]));
                return;
            }

            if (!values.box_type) {
                frappe.throw(__('Group {0}: Box Type is required', [i + 1]));
                return;
            }

            if (!values.number_of_boxes || cint(values.number_of_boxes) < 1) {
                frappe.throw(__('Group {0}: Number of Boxes is required', [i + 1]));
                return;
            }

            let packrate_val = flt(values.packrate);
            let total_per_box = values.varieties.reduce(
                (sum, v) => sum + cint(v.stems_per_box || 0),
                0
            );

            if (total_per_box !== packrate_val) {
                frappe.throw(__(
                    'Group {0}: Packrate mismatch – expected {1} stems, got {2}',
                    [i + 1, packrate_val, total_per_box]
                ));
                return;
            }

            for (let v of values.varieties) {
                if (!v.item_code) continue;

                if (!v.custom_length) {
                    frappe.throw(__(
                        'Group {0}: Length is required for {1}',
                        [i + 1, v.item_code]
                    ));
                    return;
                }

                if (!v.stems_per_box || cint(v.stems_per_box) < 1) {
                    frappe.throw(__(
                        'Group {0}: Stems / Box is required for {1}',
                        [i + 1, v.item_code]
                    ));
                    return;
                }

                let nob = cint(v.number_of_boxes);
                if (nob < 1 || nob > cint(values.number_of_boxes)) {
                    frappe.throw(__(
                        'Group {0}: Invalid # boxes for {1} – must be between 1 and {2}',
                        [i + 1, v.item_code, values.number_of_boxes]
                    ));
                    return;
                }

                if (!v.ordered_quantity || cint(v.ordered_quantity) < 1) {
                    frappe.throw(__(
                        'Group {0}: Ordered Qty must be greater than 0 for {1}',
                        [i + 1, v.item_code]
                    ));
                    return;
                }
            }
        }

        if (edit_mode) {
            // Edit mode: remove only the groups that were loaded into the wizard,
            // identified by their original_group number, then re-add them
            let edited_group_numbers = new Set(
                mixes.filter(m => m.original_group).map(m => m.original_group)
            );

            frm.doc.items = frm.doc.items.filter(r => {
                if (!r.custom_mixed_box) return true; // Keep non-mixed rows
                return !edited_group_numbers.has(cint(r.custom_mix_group)); // Keep other mix groups
            });

            frm.refresh_field('items');

            mixes.forEach(values => {
                if (values.packrate && values.varieties?.length > 0) {
                    // In edit mode, preserve the original group number
                    apply_mixed_boxes_aggregated(frm, values, values.original_group);
                }
            });
        } else {
            // Add mode: clear all mixed rows and re-add
            frm.doc.items = frm.doc.items.filter(r => !r.custom_mixed_box);
            frm.refresh_field('items');

            mixes.forEach(values => {
                if (values.packrate && values.varieties?.length > 0) {
                    apply_mixed_boxes_aggregated(frm, values, null);
                }
            });
        }

        localStorage.removeItem(MIXED_BOX_STORAGE_KEY);
        dialog.$wrapper.modal('hide');

        frappe.show_alert({
            message: edit_mode
                ? __('Mixed boxes updated successfully')
                : __('All mix groups added successfully'),
            indicator: 'green'
        }, 5);
    }

    // Catch ESC, backdrop click, and X button via Bootstrap modal event
    dialog.$wrapper.on('hide.bs.modal', () => {
        save_current_group();
        if (!edit_mode) save_mixed_state(mixes);
    });

    // Navigation buttons
    let $footer = dialog.$wrapper.find('.modal-footer');
    $footer.prepend(`
        <div style="margin-right: auto; display: flex; gap: 8px;">
            <button class="btn btn-default btn-sm" id="btn-prev-group" style="min-width: 130px;">
                &#8592; Previous Group
            </button>
            <button class="btn btn-default btn-sm" id="btn-next-group" style="min-width: 130px;">
                Next Group &#8594;
            </button>
        </div>
    `);

    dialog.$wrapper.find('#btn-prev-group').on('click', () => {
        save_current_group();
        if (current_index > 0) {
            current_index--;
            load_group(current_index);
        }
    });

    dialog.$wrapper.find('#btn-next-group').on('click', () => {
        save_current_group();
        if (current_index < mixes.length - 1) {
            current_index++;
            load_group(current_index);
        } else {
            // In edit mode don't allow adding new groups
            if (!edit_mode) {
                mixes.push({});
                current_index = mixes.length - 1;
                load_group(current_index);
            }
        }
    });

    // Bind post-render elements after modal is visible
    dialog.$wrapper.on('shown.bs.modal', () => {
        dialog.fields_dict.mix_name.$input.on('change', () => save_current_group());
        dialog.fields_dict.farm.$input.on('change', () => save_current_group());
        dialog.fields_dict.packrate.$input.on('change', () => save_current_group());
        dialog.fields_dict.number_of_boxes.$input.on('change', () => save_current_group());
        dialog.fields_dict.box_type.$input.on('change', () => save_current_group());

        dialog.$wrapper.find('#clear-session-link').on('click', (e) => {
            e.preventDefault();
            if (edit_mode) return; // Don't allow clear in edit mode

            if (confirm(__('Clear ALL groups in this session?'))) {
                mixes = [{}];
                current_index = 0;
                localStorage.removeItem(MIXED_BOX_STORAGE_KEY);
                load_group(0);
                frappe.show_alert({
                    message: __('Session cleared'),
                    indicator: 'orange'
                }, 3);
            }
        });

        // Hide clear link in edit mode
        if (edit_mode) {
            dialog.$wrapper.find('#clear-session-link').hide();
        }

        // Hide next group button in edit mode when on last group
        if (edit_mode) {
            dialog.$wrapper.find('#btn-next-group').toggle(mixes.length > 1);
        }
    });

    // Safe save that never throws
    function save_current_group() {
        try {
            let mix_name = dialog.fields_dict.mix_name.get_value();
            let farm = dialog.fields_dict.farm.get_value();
            let packrate = dialog.fields_dict.packrate.get_value();
            let number_of_boxes = dialog.fields_dict.number_of_boxes.get_value();
            let box_type = dialog.fields_dict.box_type.get_value();
            let varieties = [];

            let grid = dialog.fields_dict.varieties.grid;
            if (grid && grid.get_data) {
                grid.get_data().forEach(row => {
                    if (!row.item_code) return;
                    varieties.push({
                        item_code: row.item_code || '',
                        item_name: row.item_name || '',
                        custom_length: row.custom_length || '',
                        stems_per_box: cint(row.stems_per_box || 0),
                        number_of_boxes: cint(row.number_of_boxes || 1),
                        ordered_quantity: row.ordered_quantity !== undefined ? row.ordered_quantity : '',
                        uom: row.uom || ''
                    });
                });
            }

            // Preserve original_group when saving in edit mode
            let existing = mixes[current_index] || {};
            mixes[current_index] = {
                mix_name,
                farm,
                packrate,
                number_of_boxes,
                box_type,
                varieties,
                original_group: existing.original_group || null
            };
        } catch (e) {
            console.warn('[MixedBox] save_current_group failed silently:', e);
        }
    }

    // Restore grid rows properly
    function load_group(idx) {
        let data = mixes[idx] || {};

        dialog.set_value('mix_name', data.mix_name || '');
        dialog.set_value('farm', data.farm || '');
        dialog.set_value('packrate', data.packrate || '');
        dialog.set_value('number_of_boxes', data.number_of_boxes || 1);
        dialog.set_value('box_type', data.box_type || '');

        let grid = dialog.fields_dict.varieties.grid;
        grid.df.data = [];
        grid.grid_rows = [];
        grid.wrapper.find('.grid-body .rows').empty();
        grid.refresh();

        (data.varieties || []).forEach(v => {
            if (!v.item_code) return;

            grid.add_new_row(null, null, true);
            let rows = grid.get_data();
            let doc = rows[rows.length - 1];
            if (!doc) return;

            doc.item_code = v.item_code || '';
            doc.item_name = v.item_name || '';
            doc.custom_length = v.custom_length || '';
            doc.stems_per_box = cint(v.stems_per_box || 0);
            doc.number_of_boxes = cint(v.number_of_boxes || 1);
            doc.ordered_quantity = v.ordered_quantity !== undefined ? v.ordered_quantity : '';
            doc.uom = v.uom || '';
        });

        grid.refresh();

        // Title shows the user-defined mix name (if set), else fall back to group index
        let title_prefix = edit_mode ? 'Edit Mixed Boxes' : 'Mixed Boxes';
        let title_suffix = data.mix_name && String(data.mix_name).trim()
            ? `– ${data.mix_name}`
            : `– Group ${idx + 1}`;
        dialog.set_title(__(title_prefix + ' ' + title_suffix));

        dialog.fields_dict.nav_status.$wrapper.find('#current-group-num').text(idx + 1);
        dialog.fields_dict.nav_status.$wrapper.find('#total-groups').text(mixes.length);

        dialog.$wrapper.find('#btn-prev-group').prop('disabled', idx === 0);

        // In edit mode, disable next when on last group (no adding new groups)
        if (edit_mode) {
            dialog.$wrapper.find('#btn-next-group').prop('disabled', idx === mixes.length - 1);
            dialog.$wrapper.find('#btn-next-group').text('Next Group →');
        } else {
            dialog.$wrapper.find('#btn-next-group').text(
                idx === mixes.length - 1 ? 'Add New Group →' : 'Next Group →'
            );
        }

        update_stem_counter(dialog);
    }

    function update_stem_counter(dlg) {
        let total = 0;
        let grid = dlg.fields_dict.varieties.grid;
        if (grid && grid.get_data) {
            grid.get_data().forEach(r => {
                total += cint(r.stems_per_box || 0);
            });
        }
        dlg.$wrapper.find('#stem-total').text(total);
    }

    load_group(current_index);
    dialog.show();
}

/* =====================================================
   APPLY MIXED BOXES
   ===================================================== */

function apply_mixed_boxes_aggregated(frm, values, force_group_number) {
    // In edit mode use the original group number, otherwise generate a new one
    let mix_group = force_group_number || generate_mix_group_number(frm);
    let warehouses = get_warehouses(values.farm);
    let mix_name = values.mix_name ? String(values.mix_name).trim() : '';

    // Strip phantom empty rows
    frm.doc.items = frm.doc.items.filter(r => r.item_code);
    frm.refresh_field('items');

    for (let v of values.varieties) {
        let row = frm.add_child('items');
        row.item_code = v.item_code;
        row.item_name = v.item_name;
        row.uom = v.uom;
        row.custom_mixed_box = 1;
        row.custom_mix_group = mix_group;
        row.custom_mix_name = mix_name;
        row.custom_packrate_mixed_box = v.stems_per_box;
        row.custom_number_of_boxes = v.number_of_boxes;
        row.custom_length = v.custom_length;
        row.custom_box_type = values.box_type;
        row.custom_ordered_quantity = cint(v.ordered_quantity);
        row.custom_truck = 0;
        row.custom_source_warehouse = warehouses.source;
        row.warehouse = warehouses.warehouse;

        let total_stems = v.stems_per_box * v.number_of_boxes;
        row.stock_qty = total_stems;
        row.qty = total_stems / extract_uom_factor(row.uom);
        row.conversion_factor = extract_uom_factor(row.uom) || 1;   // mixed-box rows are built directly (no item_code fetch), so set the UOM factor to avoid the standard "UOM Conversion Factor is required" save error
    }

    frm.refresh_field('items');

    frappe.show_alert({
        message: __('Mix "{0}" saved ({1} varieties, {2} boxes)', [
            mix_name || `Group ${mix_group}`,
            values.varieties.length,
            values.number_of_boxes
        ]),
        indicator: 'green'
    }, 4);
}
