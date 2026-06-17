# Roses Sales Order — Field Usage Inventory

Source: live analysis of `kaitet-group.upande.com` via FAC HTTP endpoint (read-only).
Population: `custom_sales_order_type = "Roses"` → **8,611** Sales Orders total.
Sample: **40 SOs** spread evenly across the SO-2026 sequence (SO-2026-00149 … SO-2026-07792, mix of recent + older), 138 item rows.
Date of analysis: 2026-06-15.

Note: One sampled name resolved to a Client Script and was replaced with a valid Roses SO before aggregation. Percentages below are over the clean 40-doc / 138-row sample. "98% / 100%" differences are sampling artefacts (1 cancelled doc with stripped fields) — treat 98%+ as "always present".

---

## (a) HEADER field inventory

### USED — always present (~98–100% of orders) — REQUIRED form fields
| Field | Type | Example | Notes |
|---|---|---|---|
| `naming_series` | str | `SO-.YYYY.-` | fixed |
| `customer` / `customer_name` | str | `COMING UP ROSES` | link to Customer |
| `transaction_date` | str(date) | `2026-06-15` | order date |
| `delivery_date` | str(date) | `2026-06-17` | |
| `company` | str | `Karen Roses` | fixed |
| `order_type` | str | `Sales` | always "Sales" |
| `currency` | str | `USD` | distinct: USD, EUR, KES |
| `conversion_rate` | float | `129.65` | to KES |
| `selling_price_list` | str | `USD Price List` | |
| `price_list_currency` | str | `USD` | |
| `plc_conversion_rate` | float | `129.65` | |
| `party_account_currency` | str | `KES` | |
| `po_no` | str | `X` | often literal "X" placeholder |
| `letter_head` | str | `Karen Roses Letterhead` | |
| `language` | str | `en` | |
| `title` | str | `{customer_name}` | template |
| `total_qty` | float | `22.0` | computed (sum of item qty) |
| `apply_discount_on` | str | `Grand Total` | |
| **`custom_sales_order_type`** | str | `Roses` | the discriminator |
| **`custom_business_unit`** | str | `Roses` | always "Roses" |
| **`custom_farm`** | str | `Kapkolia` | link/select |
| **`custom_order_name`** | str | `33-MIR-1 -07792` | composed order label |
| **`custom_week`** | str | `25` | ISO week |
| **`custom_s_number`** | str | `X` | often "X" |
| **`custom_truck_details`** | str | `X` | often "X" |
| **`custom_daily_time`** | str(time) | `20:41:00` | |
| **`custom_packhouse_stage`** | str | `Upcoming` | workflow-ish (all "Upcoming" in sample) |
| `status` | str | `To Deliver and Bill` | std (also Cancelled) |
| `billing_status` / `delivery_status` | str | `Not Billed` / `Not Delivered` | std computed |
| `docstatus` | int | `1` | submitted |

### USED — by SOME orders (conditional / export-dependent) — SUPPORT but optional
| Field | Type | Example | % populated | Notes |
|---|---|---|---|---|
| `custom_consignee` | str | `TRUCK FANTAZIA (UKRAINE)` | 92% | |
| `custom_consignee_country` | str | `Ukraine` | 92% | |
| `custom_mode_of_transport` | str | `Air` | 82% | only "Air" seen |
| `custom_statescountry` | str | `Russia` | 82% | |
| `territory` | str | `Russia` | 82% | std |
| `customer_address` / `address_display` | str | billing address | 80% | |
| `custom_delivery_point` | str | `EXPOLANKA` | 75% | AIRFLO/DHL/EXPOLANKA/KUEHNE NAGEL/etc |
| `payment_terms_template` | str | `14 days` | 72% | drives payment_schedule |
| `total` / `net_total` / `grand_total` / `rounded_total` | float | `176.0` | 62% | only when items priced |
| `base_total` / `base_net_total` / `base_grand_total` / `base_rounded_total` | float | `22818.4` | 62% | KES equivalents |
| `amount_eligible_for_commission` | float | `22818.4` | 62% | |
| `custom_remote_truck_details` | str | `X` | 55% | |
| `custom_shipping_agent` | str | `AIRFLO LTD` | 45% | |
| `po_date` | str(date) | `2026-05-12` | 32% | |
| `customer_group` | str | `AOA VENTURES LTD` | 25% | |
| `custom_expected_delivery_date` | str(date) | | 22% | |
| `contact_person` / `contact_display` / `contact_email` | str | `Xpol` | 10–20% | |
| `contact_mobile` / `contact_phone` | str | `+998…` | 2–10% | |
| `shipping_address` / `shipping_address_name` | str | Tashkent addr | 10% | |
| `custom_event` | str | `Women's Day` | 2% | seasonal |
| `amended_from` | str | `SO-2026-07399` | 5% | amendments |
| `tax_id` | str | `N/A` | 2% | |
| `other_charges_calculation` / `rounding_adjustment` | | | 2–5% | tax docs only |

### UNUSED — always empty / default across the sample — DO NOT include in new form
`additional_discount_percentage`, `advance_paid`, `auto_repeat`, `base_discount_amount`,
`base_total_taxes_and_charges`, `campaign`, `commission_rate`, `company_address`,
`company_address_display`, `company_contact_person`, `cost_center` (header), `coupon_code`,
`custom_available_stock`, `custom_box_type` (header), `custom_comment`, `custom_company_flo_id`,
`custom_customer_flo_id`, `custom_day_of_month`, `custom_delivered`, `custom_frequency`,
`custom_ftnft`, `custom_incoterms`, `custom_is_standing_order`, `custom_line_code`,
`custom_material_transfer_created`, `custom_priority`, `custom_reason_for_rejected_sales_order`,
`custom_standing_order`, `custom_standing_order_ref`, `custom_stock_allocated`,
`custom_stock_available`, `custom_total_stock_qty`, `custom_weekly_day`, `disable_rounded_total`,
`discount_amount`, `dispatch_address`, `dispatch_address_name`, `farm` (std, the custom one is used),
`from_date`, `group_same_items`, `has_unit_price_items`, `ignore_default_payment_terms_template`,
`ignore_pricing_rule`, `incoterm`, `inter_company_order_reference`, `is_internal_customer`,
`last_scanned_warehouse`, `loyalty_amount`, `loyalty_points`, `named_place`, `per_billed`,
`per_delivered`, `per_picked`, `project`, `rejection_reason`, `represents_company`, `reserve_stock`,
`sales_partner`, `scan_barcode`, `select_print_heading`, `set_warehouse`, `shipping_rule`,
`shopify_order_id`, `shopify_order_number`, `shopify_order_status`, `skip_delivery_note`, `source`,
`tax_category`, `taxes_and_charges`, `tc_name`, `terms`, `to_date`, `total_commission`,
`total_net_weight`, `total_taxes_and_charges`, `workflow_state`.

---

## (b) ITEMS child table (`Sales Order Item`) — column inventory

### USED — always populated (100% of rows) — REQUIRED
| Column | Type | Example | Notes |
|---|---|---|---|
| `item_code` / `item_name` / `description` | str | `Giselle` | the rose variety |
| `item_group` | str | `Spray Roses` | distinct: Spray Roses, Standard Roses |
| `qty` | float | `22.0` | order qty in `uom` |
| `uom` | str | `Bunch (10)` | distinct: Bunch (10), Bunch (5), Stems |
| `stock_uom` | str | `Stems` | distinct: Stems, Nos |
| `conversion_factor` | float | `10.0` | uom → stock_uom |
| `stock_qty` | float | `220.0` | qty × conversion_factor |
| `custom_ordered_quantity` | float | `220.0` | ordered stems |
| `custom_length` | str | `62cm` | distinct: 42/52/62/72cm |
| `custom_reserve_status` | str | `Reserved` | only "Reserved" seen |
| `custom_truck` | str | `X` / truck name | per-line truck (many distinct names) |
| `custom_source_warehouse` | str | `Ravine Available for Sale - KR` | |
| `warehouse` | str | `Ravine Graded Sold - KR` | target |
| `company_total_stock` | float | `504514.0` | computed |
| `delivery_date` | str(date) | `2026-06-17` | |
| `is_stock_item` | int | `1` | |
| `grant_commission` | int | `1` | |
| `cost_center` | str | `Main - KR` | |
| `item_tax_rate` | str | `{}` | usually empty json |

### USED — by SOME rows — SUPPORT (conditional)
| Column | Type | Example | rows% | docs% | Notes |
|---|---|---|---|---|---|
| `custom_number_of_boxes` | int | `1` | 99% | 98% | effectively required |
| `projected_qty` | float | `-552716.43` | 97% | computed stock |
| `custom_box_type` | str | `Small` | 70% | 62% | Small/Large/Standard/Flower Pack Pro |
| `custom_packrate_mixed_box` | int | `20` | 52% | 38% | mixed-box stems/box |
| `custom_mixed_box` | int(0/1) | `1` | 52% | 38% | is this a mixed box |
| `custom_mix_group` | str | `1` | 52% | 38% | groups lines into one box (1/2/3) |
| `price_list_rate` / `rate` / `amount` | float | `8.0` / `176.0` | 47% | 65% | pricing (only when priced) |
| `base_price_list_rate` / `base_rate` / `base_amount` | float | `1037.2` | 47% | 65% | KES |
| `net_rate` / `net_amount` / `base_net_rate` / `base_net_amount` | float | | 47% | 65% | |
| `stock_uom_rate` | float | `0.8` | 47% | 65% | per-stem rate |
| `gross_profit` | float | `176.0` | 47% | 65% | |
| `custom_packrate` | str/num | `220` | 43% | 60% | stems per box (straight box) |
| `custom_fully_allocated` | int(0/1) | `1` | 33% | 48% | allocation flag |
| `custom_stock_available` | int(0/1) | `1` | 33% | 48% | |
| `custom_opl` | str | `OPL-STEADY MARKET B.V.-1239232` | 33% | 48% | order-pack-list link |
| `custom_mix_name` | str | `BARILE - MIX - AF L5 140` | 33% | 15% | named mix recipe |
| `actual_qty` | float | `1040.0` | 28% | 62% | live stock |
| `custom_available_quantity` | float | `1100.0` | 22% | 38% | |
| `custom_processing_location` | str | `Karen` | 6% | 8% | |
| `image` | str | `/files/giselle.jpg` | 5% | 18% | variety image |
| `custom_truck_details` | str | | 1% | 5% | rare |

### UNUSED item columns — always empty — DO NOT include
`additional_notes`, `against_blanket_order`, `base_rate_with_margin`, `billed_amt`, `blanket_order`,
`blanket_order_rate`, `bom_no`, `brand`, `custom_allocated_qty`, `custom_amount_stems`,
`custom_box_id`, `custom_box_label`, `custom_box_mix`, `custom_box_quantity`, `custom_bud_counts`,
`custom_certificate_of_origin`, `custom_confirmed_box_quantity`, `custom_consumables_charge`,
`custom_cut_stage`, `custom_defoliation_length`, `custom_delivery_point` (item), `custom_documentation_fee`,
`custom_farm` (item — header one is used), `custom_flower_food`, `custom_labels_description_on_sleeve`,
`custom_line`, `custom_line_code`, `custom_reserved_qty`, `custom_sleeve_description`,
`custom_total_stems`, `custom_with_flower_food`, `customer_item_code`, `delivered_by_supplier`,
`delivered_qty`, `discount_amount`, `discount_percentage`, `distributed_discount_amount`,
`ensure_delivery_based_on_produced_serial_no`, `farm`, `fg_item`, `fg_item_qty`, `is_free_item`,
`item_tax_template`, `margin_rate_or_amount`, `margin_type`, `material_request`,
`material_request_item`, `ordered_qty`, `page_break`, `picked_qty`, `planned_qty`, `prevdoc_docname`,
`pricing_rules`, `produced_qty`, `production_plan_qty`, `project`, `purchase_order`,
`purchase_order_item`, `quotation_item`, `rate_with_margin`, `requested_qty`, `reserve_stock`,
`returned_qty`, `shopify_item_discount`, `stock_reserved_qty`, `subcontracted_qty`,
`target_warehouse`, `total_weight`, `valuation_rate`, `weight_per_unit`, `weight_uom`, `work_order_qty`.

Notably empty even though the prompt listed them as candidates: **`custom_box_label`**,
**`custom_line`**, **`custom_consignee`** (item-level — consignee lives on the HEADER).

---

## (c) Other populated child tables

| Child table | Docs (of 40) | Used columns | Notes |
|---|---|---|---|
| `items` | 39/40* | (see section b) | core line table |
| `payment_schedule` | 39/40* | `due_date`, `invoice_portion` (100), `due_date_based_on`, `discount_date`, `discount_type`, `discount_validity_based_on`, `credit_days`, `payment_amount`, `outstanding`, `base_payment_amount`, `base_outstanding` | auto-generated from `payment_terms_template`; not hand-entered |
| `custom_confirmed_stems_table` | 9/40 | **`farm`**, **`stems`**, **`sales_order_item`** | post-confirmation actual stems per line+farm; populated on confirmed orders only |
| `taxes` | 2/40 | `charge_type`, `account_head`, `description`, `cost_center`, `account_currency`, `total`, `base_total`, `item_wise_tax_detail` | rare VAT lines; mostly export = no tax |

\* the one "missing" doc is the cancelled order with stripped child rows.

---

## Summary — field set the new form must support

**HEADER (entry/required):** customer, transaction_date, delivery_date, currency, conversion_rate,
selling_price_list, custom_farm, custom_order_name, custom_week, custom_sales_order_type (=Roses),
custom_business_unit (=Roses), custom_packhouse_stage, custom_s_number, custom_truck_details,
custom_daily_time, po_no, order_type, naming_series, letter_head.
**HEADER (conditional/export):** custom_consignee, custom_consignee_country, custom_statescountry,
territory, custom_mode_of_transport, custom_delivery_point, custom_shipping_agent,
custom_remote_truck_details, customer_address, payment_terms_template, custom_expected_delivery_date,
po_date, customer_group, contact_person, shipping_address, custom_event.

**ITEMS (required):** item_code, item_group, qty, uom, stock_uom, conversion_factor, stock_qty,
custom_ordered_quantity, custom_length, custom_truck, custom_source_warehouse, warehouse,
custom_reserve_status, delivery_date, custom_number_of_boxes.
**ITEMS (conditional):** custom_box_type, custom_packrate, custom_mixed_box, custom_mix_group,
custom_packrate_mixed_box, custom_mix_name, rate/amount (pricing), custom_opl,
custom_fully_allocated, custom_stock_available, custom_available_quantity, image,
custom_processing_location.

**OTHER CHILD TABLES:** `custom_confirmed_stems_table` (farm, stems, sales_order_item — confirmed
orders); `payment_schedule` (auto from payment terms); `taxes` (rare).
