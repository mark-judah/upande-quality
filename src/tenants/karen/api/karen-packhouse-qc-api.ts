import { api } from '@/src/core/api/client';

// ── fetchPackhouseQCFormData ────────────────────────────────────────────────

export type RawControlPoint = {
  name?: string;
  control_point?: string;
  control_area?: string;
};

/** Despite the key name, this is an Order Pick List — the backend kept the
 *  `order_specs` response key from an earlier Order Spec attempt that's no
 *  longer used. */
export type RawOrderPickList = {
  name?: string;
  order_name?: string;
  customer?: string;
  team?: string;
  farm?: string;
  total_stems?: number | string;
  status?: string;
  schedule_number?: string;
  /** Order Pick List docstatus: 0 = Draft, 1 = Submitted. */
  docstatus?: number;
};

export type RawItemLocation = {
  idx?: number;
  item_code?: string;
  item_name?: string;
  warehouse?: string;
  qty?: number;
  stock_qty?: number;
  uom?: string;
  conversion_factor?: number;
};

export type RawQcParameter = {
  name?: string;
  parameter?: string;
  tolerance_thresholds?: number;
};

export type RawBoxLabel = {
  name?: string;
  box_number?: number;
  box_total_count?: number;
  pack_rate?: number;
};

export type RawQcIncharge = {
  name?: string;
  full_name?: string;
};

export type RawReason = {
  name?: string;
  reason?: string;
};

export type RawSpecBoxItem = {
  bunch_type?: string;
  colour?: string;
  variety?: string;
  hz_bud_count_range?: string;
  stems_per_bunch?: number;
  length?: string;
  box_type?: string;
  bunches_per_box?: number;
  pack_rate?: number;
};

export type RawSpecConsumable = {
  consumable_type?: string;
  description?: string;
  qty_per_bunch?: number;
  qty_per_box?: number;
  price_inclusive?: number;
};

/** Resolved via the real FK chain — OPL's Pick List Item.custom_sale_order_item
 *  -> Sales Order Item.custom_line -> Specifications.name — so Final QC and
 *  Online QC can compare the physical pack against exactly what was ordered. */
export type RawSpecification = {
  spec_name?: string;
  customer?: string;
  category_code?: string;
  ftnft?: string;
  spec_type?: string;
  status?: string;
  valid_from?: string;
  expiry_date?: string;
  cut_stage?: string;
  defoliation_length?: string;
  rubber_band_type?: string;
  rubber_band_distance_1?: string;
  rubber_band_distance_2?: string;
  box_assortment?: string;
  consumables_charge?: number;
  documentation_charge?: number;
  certificate_of_origin?: number;
  box_items?: RawSpecBoxItem[];
  consumables?: RawSpecConsumable[];
};

export type RawSpecificationListItem = {
  name?: string;
  spec_name?: string;
  customer?: string;
  category_code?: string;
  box_assortment?: string;
  cut_stage?: string;
  status?: string;
};

export type RawScannedBoxItem = {
  variety?: string;
  qty?: number;
  length?: string;
};

/** What's actually recorded on the scanned Box Label itself — the ground
 *  truth for this specific box, since an order can carry more than one
 *  variety and "the order's first variety" isn't necessarily what's in it. */
export type RawScannedBoxDetail = {
  box_number?: number;
  box_total_count?: number;
  pack_rate?: number;
  length?: string;
  customer?: string;
  items?: RawScannedBoxItem[];
};

/** Airport Returns — return context resolved from the scanned box. Some fields
 *  (invoice, packhouse) may be blank when they aren't on the box label. */
export type RawAirportReturnDetail = {
  invoice_number?: string;
  days_in_stock?: number;
  packhouse?: string;
  greenhouse?: string;
  farm?: string;
  stems_returned?: number;
};

export type RawPackhouseFormData = {
  success?: boolean;
  control_points?: RawControlPoint[];
  /** Active OPLs — filtered to the selected Specification when one was
   *  passed in the request. */
  order_specs?: RawOrderPickList[];
  item_locations?: RawItemLocation[];
  varieties?: string[];
  greenhouses?: string[];
  params?: RawQcParameter[];
  reasons?: RawReason[];
  boxes?: RawBoxLabel[];
  box_total_count?: number;
  /** Populated whenever an OPL is resolved (directly or via a box scan) —
   *  not just when it's in the last-300 dropdown list. */
  order_pick_list_detail?: RawOrderPickList | null;
  /** Keyed by variety — an order can carry more than one. */
  specifications?: Record<string, RawSpecification> | null;
  /** All Active Specifications, for the "pick a spec before browsing
   *  orders" filter — not affected by any request params. */
  specifications_list?: RawSpecificationListItem[];
  /** Count of active OPLs (today + yesterday) per Specification name, via
   *  the same custom_line FK chain the order filter uses. Drives the
   *  "has orders" tick in the spec picker. Not affected by request params. */
  spec_order_counts?: Record<string, number>;
  /** Full detail for a directly picked/overridden spec — independent of
   *  any order/variety match, set whenever a `specification` param is
   *  passed. Covers cases where the resolved order's own Sales Order Item
   *  has no Specification link at all. */
  specification_detail?: RawSpecification | null;
  scanned_box_detail?: RawScannedBoxDetail | null;
  airport_return_detail?: RawAirportReturnDetail | null;
  scanned_box_variety?: string;
  qc_incharge_options?: RawQcIncharge[];
  pending_quarantine_stems?: number;
  error?: string;
};

export type RawPackhouseFormDataResponse = {
  message?: RawPackhouseFormData;
};

// ── savePackhouseQC ──────────────────────────────────────────────────────────

export type RawCorrectiveActionReport = {
  variety?: string;
  greenhouse?: string;
  car?: string;
  new?: boolean;
};

export type RawSavePackhouseQc = {
  success?: boolean;
  name?: string;
  overall_result?: string;
  stems_accepted?: number;
  stems_quarantined?: number;
  stems_rejected?: number;
  corrective_action_reports?: RawCorrectiveActionReport[];
  car_errors?: { variety?: string; greenhouse?: string; error?: string }[];
  stock_entry?: string | null;
  stock_entry_error?: string | null;
  error?: string;
};

export type RawSavePackhouseQcResponse = {
  message?: RawSavePackhouseQc;
};

// ── API functions ────────────────────────────────────────────────────────────

export const karenPackhouseQcApi = {
  fetchFormData(params?: {
    orderPickList?: string;
    boxLabel?: string;
    specification?: string;
    team?: string;
    airportReturn?: boolean;
  }): Promise<RawPackhouseFormDataResponse> {
    const base = params?.orderPickList
      ? { order_pick_list: params.orderPickList }
      : params?.boxLabel
        ? { box_label: params.boxLabel }
        : params?.specification
          ? { specification: params.specification }
          : params?.team
            ? { team: params.team }
            : undefined;
    return api<RawPackhouseFormDataResponse>({
      method: 'GET',
      url: '/api/method/fetchPackhouseQCFormData',
      // Airport Returns scans a box AND asks the server for the return context.
      params: params?.airportReturn ? { ...(base ?? {}), airport_return: 1 } : base,
    });
  },

  save(payload: Record<string, unknown>): Promise<RawSavePackhouseQcResponse> {
    return api<RawSavePackhouseQcResponse>({
      method: 'POST',
      url: '/api/method/savePackhouseQC',
      data: payload,
      validateStatus: () => true,
    });
  },
};
