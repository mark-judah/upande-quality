// Client Script — DocType: Avocado Proforma Invoice, View: Form
// Adds an "Update Details" button that lets the user pick ANY field on the
// doctype and patch it directly in the database (bypassing the submit lock).
// The value input is DYNAMIC: it takes the shape of the selected field
// (Long Text -> textarea, Select -> dropdown, Date -> date picker,
// Check -> checkbox, Link -> link search, numbers -> numeric, etc.).

frappe.ui.form.on('Avocado Proforma Invoice', {
    refresh(frm) {
        frm.add_custom_button('Update Details', () => openUpdateDetails(frm));
    },
});

// Map a doctype fieldtype to a control type the dialog can render. Most pass
// straight through; a few unsupported ones fall back to a plain Data box.
function controlFieldtype(ft) {
    const passthrough = [
        'Data', 'Small Text', 'Text', 'Long Text', 'Text Editor', 'Code',
        'Select', 'Link', 'Date', 'Datetime', 'Time', 'Int', 'Float',
        'Currency', 'Percent', 'Check', 'Color', 'Phone', 'Duration', 'Rating',
    ];
    return passthrough.indexOf(ft) === -1 ? 'Data' : ft;
}

function openUpdateDetails(frm) {
    const SKIP = [
        'Section Break', 'Column Break', 'Tab Break', 'HTML', 'Button',
        'Table', 'Table MultiSelect', 'Heading', 'Image', 'Fold', 'Geolocation',
    ];

    const editable = (frm.meta.fields || []).filter(
        (df) => df.fieldname && SKIP.indexOf(df.fieldtype) === -1,
    );

    const byName = {};
    const optionList = editable.map((df) => {
        const label = (df.label || df.fieldname) + ' (' + df.fieldname + ')';
        byName[label] = df;
        return label;
    });

    let activeLabel = null; // currently picked option string

    function build(pickedLabel) {
        const df = pickedLabel ? byName[pickedLabel] : null;

        const valueField = df
            ? {
                  fieldname: 'new_value',
                  label: 'New value — ' + (df.label || df.fieldname),
                  fieldtype: controlFieldtype(df.fieldtype),
                  options: df.options || undefined,
              }
            : {
                  fieldname: 'new_value',
                  label: 'New value',
                  fieldtype: 'Data',
                  description: 'Select a field above first.',
              };

        const d = new frappe.ui.Dialog({
            title: 'Update Details',
            fields: [
                {
                    fieldname: 'picked',
                    label: 'Field to edit',
                    fieldtype: 'Select',
                    options: optionList,
                    default: pickedLabel || undefined,
                    reqd: 1,
                    onchange() {
                        const sel = d.get_value('picked');
                        if (sel && sel !== activeLabel) {
                            activeLabel = sel;
                            d.hide();
                            build(sel); // rebuild with the correctly-typed value control
                        }
                    },
                },
                valueField,
            ],
            primary_action_label: 'Update',
            primary_action() {
                if (!df) {
                    frappe.msgprint('Select a field to edit.');
                    return;
                }
                let value = d.get_value('new_value');
                if (df.fieldtype === 'Check') value = value ? 1 : 0;
                frappe.call({
                    method: 'update_submitted_field',
                    args: {
                        target_doctype: frm.doctype,
                        docname: frm.docname,
                        fieldname: df.fieldname,
                        value: value,
                    },
                    freeze: true,
                    freeze_message: 'Updating database…',
                    callback(r) {
                        const m = r.message || {};
                        if (m.success) {
                            frappe.show_alert({ message: 'Updated ' + df.fieldname, indicator: 'green' });
                            d.hide();
                            frm.reload_doc();
                        } else {
                            frappe.msgprint({
                                title: 'Update failed',
                                message: m.error || 'Unknown error',
                                indicator: 'red',
                            });
                        }
                    },
                });
            },
        });

        // Prefill the current stored value into the (correctly-typed) control.
        if (df) {
            const cur = frm.doc[df.fieldname];
            d.set_value('new_value', cur === undefined || cur === null ? '' : cur);
        }

        d.show();
    }

    build(null);
}
