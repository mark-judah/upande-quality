export type DrawerItem = {
  label: string;
  /** matches a route file under app/ */
  route:
    | 'traceability'
    | 'replacement'
    | 'edit-details'
    | 'pending-reshelving'
    | 'receiving'
    | 'shelving'
    | 'shelf-operations'
    | 'discards'
    | 'bucket-requests'
    | 'bucket-transfers'
    | 'solution-mixing'
    | 'temperature-log'
    | 'product-temperature'
    | 'freight-dispatch'
    | 'cleaning-record'
    | 'inspection-log'
    | 'intake-qc'
    | 'coldroom-qc'
    | 'packhouse-qc'
    | 'packhouse-checks'
    | 'packhouse-inspection'
    | 'packhouse-cleaning'
    | 'packhouse-glass'
    | 'vehicle-hygiene'
    | 'bucket-cleaning'
    | 'vaselife'
    | 'flower-audit'
    | 'flower-audit-entry';
  icon: string; // Ionicons name
  /** When set, the item is hidden unless the signed-in user holds this role. */
  role?: string;
  /** When true, the screen renders a "Coming soon" placeholder regardless of
   *  tenant — used for surfaced-but-not-yet-built control points. */
  comingSoon?: boolean;
};
