try:
    order_name = frappe.form_dict.get('custom_order_name')
    
    if not order_name:
        frappe.throw("Order name is required. Please provide 'custom_order_name' parameter.")
    
    order_name = ' '.join(order_name.split())
    
    # Search Order Pick Lists directly by custom_order_name
    all_opls = frappe.get_all(
        "Order Pick List",
        fields=["name", "custom_order_name", "sales_order"],
        filters={"docstatus": 1}
    )
    
    matching_opls = []
    for opl in all_opls:
        if opl.custom_order_name:
            normalized = ' '.join(opl.custom_order_name.split())
            if normalized == order_name:
                matching_opls.append(opl.name)
    
    if not matching_opls:
        frappe.response["packing_list"] = []
        frappe.response["message"] = f"No submitted Order Pick List found with order name: {order_name}"
    else:
        # Team each OPL is assigned to (shown to the issuer so they hand the
        # buckets to the right team).
        opl_team = {}
        for opl in frappe.get_all(
            "Order Pick List",
            filters={"name": ["in", matching_opls]},
            fields=["name", "custom_team"]
        ):
            opl_team[opl.name] = opl.custom_team or ""

        # Fetch ALL buckets for the order (issued + unissued) so the app can
        # show issuing progress; the app hides issued ones from the scan list.
        pick_list_items = frappe.get_all(
            "Pick List Item",
            filters={
                "parent": ["in", matching_opls],
                "docstatus": 1,
                "parenttype": "Order Pick List"
            },
            fields=[
                "name",
                "item_code",
                "custom_bucket",
                "custom_stem_length",
                "custom_shelf",
                "custom_sale_order_item",
                "stock_qty",
                "qty",
                "parent as opl_name",
                "custom_ready_for_packing",
                "custom_issued",
                "creation"
            ],
            order_by="creation desc"
        )
        
        if not pick_list_items:
            frappe.response["packing_list"] = []
            frappe.response["message"] = f"No pick list items found for order: {order_name}"
        else:
            packing_list = []
            
            for pli in pick_list_items:
                so_item_info = None
                try:
                    so_item_info = frappe.get_doc("Sales Order Item", pli.custom_sale_order_item)
                except:
                    continue
                
                downgrade_to = None
                if so_item_info and so_item_info.custom_length and pli.custom_stem_length:
                    try:
                        so_length = int(so_item_info.custom_length.replace('cm', '').strip())
                        pli_length = int(pli.custom_stem_length.replace('cm', '').strip())
                        if pli_length > so_length:
                            downgrade_to = so_item_info.custom_length
                    except:
                        pass
                
                qty_stems = pli.stock_qty or pli.qty or 0
                
                packing_item = {
                    "variety": pli.item_code,
                    "bucket": pli.custom_bucket,
                    "stem_length": pli.custom_stem_length,
                    "shelf": pli.custom_shelf,
                    "custom_sale_order_item": pli.custom_sale_order_item,
                    "opl_name": pli.opl_name,
                    "team": opl_team.get(pli.opl_name) or "Unassigned",
                    "qty": qty_stems,
                    "mixed": 1 if so_item_info and so_item_info.custom_mixed_box else 0,
                    "downgrade_to": downgrade_to,
                    "is_ready": True,
                    "is_issued": 1 if pli.custom_issued else 0,
                    "was_marked_ready": pli.custom_ready_for_packing or 0
                }
                
                packing_list.append(packing_item)
            
            frappe.response["packing_list"] = packing_list
            frappe.response["message"] = f"Found {len(packing_list)} buckets from submitted pick lists"
        
except Exception as error:
    frappe.log_error(f"Packing List Error: {str(error)}")
    frappe.response["packing_list"] = []
    frappe.response["message"] = f"Error generating packing list: {str(error)}"