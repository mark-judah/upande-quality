import {
  karenPackhouseQcApi,
  type RawBoxLabel,
  type RawControlPoint,
  type RawItemLocation,
  type RawOrderPickList,
  type RawQcIncharge,
  type RawQcParameter,
  type RawReason,
  type RawSpecBoxItem,
  type RawSpecConsumable,
  type RawScannedBoxDetail,
  type RawScannedBoxItem,
  type RawSpecification,
  type RawSpecificationListItem,
} from '../api/karen-packhouse-qc-api';

// ── Domain types ────────────────────────────────────────────────────────────

export type ControlPointOption = {
  name: string;
  label: string;
  area: string;
};

export type OrderPickListOption = {
  name: string;
  orderName: string;
  customer: string;
  team: string;
  farm: string;
  totalStems: number;
  status: string;
  scheduleNumber: string;
};

export type ItemLocation = {
  itemCode: string;
  warehouse: string;
  bunches: number;
  stems: number;
};

export type PackhouseQcParameter = {
  /** QC Parameters docname — the Link value submitted per issue. */
  name: string;
  parameter: string;
  toleranceThresholds: number;
};

export type QcInchargeOption = {
  name: string;
  fullName: string;
};

export type ReasonOption = {
  name: string;
  reason: string;
};

export type BoxLabelOption = {
  name: string;
  boxNumber: number;
  boxTotalCount: number;
  packRate: number;
};

export type SpecBoxItem = {
  bunchType: string;
  colour: string;
  variety: string;
  hzBudCountRange: string;
  stemsPerBunch: number;
  length: string;
  boxType: string;
  bunchesPerBox: number;
  packRate: number;
};

export type SpecConsumable = {
  consumableType: string;
  description: string;
  qtyPerBunch: number;
  qtyPerBox: number;
  priceInclusive: number;
};

/** Full Specifications doc, resolved via the real FK chain (OPL -> Sales
 *  Order Item -> Specifications) — everything QC needs to check what was
 *  packed against what was ordered. */
export type SpecificationMatch = {
  specName: string;
  customer: string;
  categoryCode: string;
  ftnft: string;
  specType: string;
  status: string;
  validFrom: string;
  expiryDate: string;
  cutStage: string;
  defoliationLength: string;
  rubberBandType: string;
  rubberBandDistance1: string;
  rubberBandDistance2: string;
  boxAssortment: string;
  consumablesCharge: boolean;
  documentationCharge: boolean;
  certificateOfOrigin: boolean;
  boxItems: SpecBoxItem[];
  consumables: SpecConsumable[];
  /** Convenience shortcut onto the first box item — the common case is one
   *  row per spec. */
  bunchesPerBox: number;
  packRate: number;
  stemsPerBunch: number;
};

/** Lightweight row for the "pick a spec before browsing orders" picker —
 *  full detail (box items, consumables) only gets fetched once an order
 *  resolves to a matching variety. */
export type SpecificationListItem = {
  name: string;
  specName: string;
  customer: string;
  categoryCode: string;
  boxAssortment: string;
  cutStage: string;
  status: string;
};

export type ScannedBoxItem = {
  variety: string;
  qty: number;
  length: string;
};

/** What's actually recorded on the scanned Box Label itself — the ground
 *  truth for this specific box, so the operator can compare it against the
 *  Specification card instead of assuming the order's first variety. */
export type ScannedBoxDetail = {
  boxNumber: number;
  boxTotalCount: number;
  packRate: number;
  length: string;
  customer: string;
  items: ScannedBoxItem[];
};

export type PackhouseOverallResult = 'Accepted' | 'Quarantined' | 'Rejected';

// ── Outcomes ────────────────────────────────────────────────────────────────

export type PackhouseFormDataOutcome =
  | {
      kind: 'ok';
      controlPoints: ControlPointOption[];
      orderPickLists: OrderPickListOption[];
      /** Set whenever an order was resolved (directly or via box scan) — use
       *  this over searching orderPickLists, which only holds the last 300. */
      resolvedOrderPickList: OrderPickListOption | null;
      itemLocations: ItemLocation[];
      varieties: string[];
      greenhouses: string[];
      params: PackhouseQcParameter[];
      reasons: ReasonOption[];
      boxes: BoxLabelOption[];
      boxTotalCount: number;
      /** Keyed by variety — an order can carry more than one. */
      specifications: Record<string, SpecificationMatch>;
      /** All Active Specifications, for the "pick a spec before browsing
       *  orders" filter — unaffected by any request params. */
      specificationsList: SpecificationListItem[];
      /** Count of active orders (today + yesterday) keyed by Specification
       *  name — powers the "has orders" tick in the spec picker. */
      specOrderCounts: Record<string, number>;
      /** Full detail for a directly picked/overridden spec, independent of
       *  any order/variety match — set whenever a specification param was
       *  passed in the request. */
      specificationDetail: SpecificationMatch | null;
      /** Set only when resolved via a box scan — what's actually recorded
       *  on that specific box, plus which variety it carries. */
      scannedBoxDetail: ScannedBoxDetail | null;
      scannedBoxVariety: string;
      qcIncharges: QcInchargeOption[];
      pendingQuarantineStems: number;
    }
  | { kind: 'error'; message: string };

export type CarResult = { variety: string; greenhouse: string; car: string; isNew: boolean };

export type SavePackhouseQcOutcome =
  | {
      kind: 'ok';
      name: string;
      overallResult: PackhouseOverallResult;
      stemsAccepted: number;
      stemsQuarantined: number;
      stemsRejected: number;
      carsCreated: CarResult[];
    }
  | { kind: 'error'; message: string };

// ── Mappers ─────────────────────────────────────────────────────────────────

function toControlPoint(raw: RawControlPoint): ControlPointOption {
  return {
    name: raw.name ?? '',
    label: raw.control_point ?? raw.name ?? '',
    area: raw.control_area ?? '',
  };
}

function toOrderPickList(raw: RawOrderPickList): OrderPickListOption {
  return {
    name: raw.name ?? '',
    orderName: raw.order_name ?? raw.name ?? '',
    customer: raw.customer ?? '',
    team: raw.team ?? '',
    farm: raw.farm ?? '',
    totalStems: Number(raw.total_stems) || 0,
    status: raw.status ?? '',
    scheduleNumber: raw.schedule_number ?? '',
  };
}

function toItemLocation(raw: RawItemLocation): ItemLocation {
  return {
    itemCode: raw.item_code ?? raw.item_name ?? '',
    warehouse: raw.warehouse ?? '',
    bunches: raw.qty ?? 0,
    stems: raw.stock_qty ?? 0,
  };
}

function toParam(raw: RawQcParameter): PackhouseQcParameter {
  return {
    name: raw.name ?? '',
    parameter: raw.parameter ?? '',
    toleranceThresholds: raw.tolerance_thresholds ?? 0,
  };
}

function toQcIncharge(raw: RawQcIncharge): QcInchargeOption {
  return { name: raw.name ?? '', fullName: raw.full_name ?? raw.name ?? '' };
}

function toReason(raw: RawReason): ReasonOption {
  return { name: raw.name ?? '', reason: raw.reason ?? raw.name ?? '' };
}

function toBoxLabel(raw: RawBoxLabel): BoxLabelOption {
  return {
    name: raw.name ?? '',
    boxNumber: raw.box_number ?? 0,
    boxTotalCount: raw.box_total_count ?? 0,
    packRate: raw.pack_rate ?? 0,
  };
}

function toSpecBoxItem(raw: RawSpecBoxItem): SpecBoxItem {
  return {
    bunchType: raw.bunch_type ?? '',
    colour: raw.colour ?? '',
    variety: raw.variety ?? '',
    hzBudCountRange: raw.hz_bud_count_range ?? '',
    stemsPerBunch: raw.stems_per_bunch ?? 0,
    length: raw.length ?? '',
    boxType: raw.box_type ?? '',
    bunchesPerBox: raw.bunches_per_box ?? 0,
    packRate: raw.pack_rate ?? 0,
  };
}

function toSpecConsumable(raw: RawSpecConsumable): SpecConsumable {
  return {
    consumableType: raw.consumable_type ?? '',
    description: raw.description ?? '',
    qtyPerBunch: raw.qty_per_bunch ?? 0,
    qtyPerBox: raw.qty_per_box ?? 0,
    priceInclusive: raw.price_inclusive ?? 0,
  };
}

function toSpecification(raw: RawSpecification): SpecificationMatch {
  const boxItems = (raw.box_items ?? []).map(toSpecBoxItem);
  const firstBox = boxItems[0];
  return {
    specName: raw.spec_name ?? '',
    customer: raw.customer ?? '',
    categoryCode: raw.category_code ?? '',
    ftnft: raw.ftnft ?? '',
    specType: raw.spec_type ?? '',
    status: raw.status ?? '',
    validFrom: raw.valid_from ?? '',
    expiryDate: raw.expiry_date ?? '',
    cutStage: raw.cut_stage ?? '',
    defoliationLength: raw.defoliation_length ?? '',
    rubberBandType: raw.rubber_band_type ?? '',
    rubberBandDistance1: raw.rubber_band_distance_1 ?? '',
    rubberBandDistance2: raw.rubber_band_distance_2 ?? '',
    boxAssortment: raw.box_assortment ?? '',
    consumablesCharge: !!raw.consumables_charge,
    documentationCharge: !!raw.documentation_charge,
    certificateOfOrigin: !!raw.certificate_of_origin,
    boxItems,
    consumables: (raw.consumables ?? []).map(toSpecConsumable),
    bunchesPerBox: firstBox?.bunchesPerBox ?? 0,
    packRate: firstBox?.packRate ?? 0,
    stemsPerBunch: firstBox?.stemsPerBunch ?? 0,
  };
}

function toSpecifications(raw: Record<string, RawSpecification> | null | undefined): Record<string, SpecificationMatch> {
  const out: Record<string, SpecificationMatch> = {};
  for (const [variety, spec] of Object.entries(raw ?? {})) {
    out[variety] = toSpecification(spec);
  }
  return out;
}

function toSpecificationListItem(raw: RawSpecificationListItem): SpecificationListItem {
  return {
    name: raw.name ?? '',
    specName: raw.spec_name ?? raw.name ?? '',
    customer: raw.customer ?? '',
    categoryCode: raw.category_code ?? '',
    boxAssortment: raw.box_assortment ?? '',
    cutStage: raw.cut_stage ?? '',
    status: raw.status ?? '',
  };
}

function toScannedBoxItem(raw: RawScannedBoxItem): ScannedBoxItem {
  return {
    variety: raw.variety ?? '',
    qty: raw.qty ?? 0,
    length: raw.length ?? '',
  };
}

function toScannedBoxDetail(raw: RawScannedBoxDetail): ScannedBoxDetail {
  return {
    boxNumber: raw.box_number ?? 0,
    boxTotalCount: raw.box_total_count ?? 0,
    packRate: raw.pack_rate ?? 0,
    length: raw.length ?? '',
    customer: raw.customer ?? '',
    items: (raw.items ?? []).map(toScannedBoxItem),
  };
}

// ── Repository ──────────────────────────────────────────────────────────────

export const karenPackhouseQcRepository = {
  async fetchFormData(params?: {
    orderPickList?: string;
    boxLabel?: string;
    specification?: string;
    team?: string;
  }): Promise<PackhouseFormDataOutcome> {
    const raw = await karenPackhouseQcApi.fetchFormData(params);
    const m = raw.message ?? {};
    if (m.success === false) {
      return {
        kind: 'error',
        message: m.error?.trim() || 'Failed to load Packhouse QC form data.',
      };
    }
    return {
      kind: 'ok',
      controlPoints: (m.control_points ?? []).map(toControlPoint),
      orderPickLists: (m.order_specs ?? []).map(toOrderPickList),
      resolvedOrderPickList: m.order_pick_list_detail ? toOrderPickList(m.order_pick_list_detail) : null,
      itemLocations: (m.item_locations ?? []).map(toItemLocation),
      varieties: m.varieties ?? [],
      greenhouses: m.greenhouses ?? [],
      params: (m.params ?? []).map(toParam),
      reasons: (m.reasons ?? []).map(toReason),
      boxes: (m.boxes ?? []).map(toBoxLabel),
      boxTotalCount: Number(m.box_total_count) || 0,
      specifications: toSpecifications(m.specifications),
      specificationsList: (m.specifications_list ?? []).map(toSpecificationListItem),
      specOrderCounts: m.spec_order_counts ?? {},
      specificationDetail: m.specification_detail ? toSpecification(m.specification_detail) : null,
      scannedBoxDetail: m.scanned_box_detail ? toScannedBoxDetail(m.scanned_box_detail) : null,
      scannedBoxVariety: m.scanned_box_variety ?? '',
      qcIncharges: (m.qc_incharge_options ?? []).map(toQcIncharge),
      pendingQuarantineStems: Number(m.pending_quarantine_stems) || 0,
    };
  },

  async save(payload: Record<string, unknown>): Promise<SavePackhouseQcOutcome> {
    const raw = await karenPackhouseQcApi.save(payload);
    const m = raw.message ?? {};
    if (!m.success) {
      return { kind: 'error', message: m.error?.trim() || 'Failed to submit Packhouse QC.' };
    }
    return {
      kind: 'ok',
      name: m.name ?? '',
      overallResult: (m.overall_result as PackhouseOverallResult) ?? 'Accepted',
      stemsAccepted: m.stems_accepted ?? 0,
      stemsQuarantined: m.stems_quarantined ?? 0,
      stemsRejected: m.stems_rejected ?? 0,
      carsCreated: (m.corrective_action_reports ?? []).map((c) => ({
        variety: c.variety ?? '',
        greenhouse: c.greenhouse ?? '',
        car: c.car ?? '',
        isNew: !!c.new,
      })),
    };
  },
};
