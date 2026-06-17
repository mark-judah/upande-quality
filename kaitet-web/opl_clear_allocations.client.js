// Client Script — DocType: Order Pick List, View: Form
// Name: OPL Clear Allocations
// Adds a red "Clear Allocations" button that wipes the Bucket Allocation Status
// for this order's sales order + pick-list varieties, then force-deletes the
// pick list. For cleaning up orders damaged by the mixed-box allocation bug.

frappe.ui.form.on('Order Pick List', {
    refresh(frm) {
        if (frm.is_new()) return;
        // Destructive — System Manager only.
        if (!frappe.user.has_role('System Manager')) return;
        frm.add_custom_button(__('Clear Allocations'), () => {
            frappe.confirm(
                __('This will <b>delete</b> all Bucket Allocation Status records for sales order <b>{0}</b> matching the varieties on this pick list, then <b>force-delete</b> this pick list <b>{1}</b>.<br><br>This bypasses permissions and the submit lock and <b>cannot be undone</b>. Continue?',
                   [frm.doc.sales_order || '(none)', frm.doc.name]),
                () => {
                    frappe.call({
                        method: 'clearOplAllocations',
                        args: { opl: frm.doc.name },
                        freeze: true,
                        freeze_message: __('Clearing allocations…'),
                        callback(r) {
                            const m = r.message || {};
                            if (m.success) {
                                frappe.show_alert({
                                    message: __('Deleted {0} allocation record(s), reset {1} order line(s), and removed the pick list.', [m.deleted_bas, m.reset_so_items]),
                                    indicator: 'green'
                                }, 6);
                                frappe.set_route('List', 'Order Pick List');
                            } else {
                                frappe.msgprint({ title: __('Clear failed'), message: m.error || 'Unknown error', indicator: 'red' });
                            }
                        }
                    });
                }
            );
        }).addClass('btn-danger');
    }
});
