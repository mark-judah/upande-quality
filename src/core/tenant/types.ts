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
    | 'discards'
    | 'bucket-requests'
    | 'bucket-transfers'
    | 'solution-mixing'
    | 'temperature-log'
    | 'cleaning-record'
    | 'inspection-log'
    | 'intake-qc'
    | 'coldroom-qc'
    | 'packhouse-qc'
    | 'packhouse-checks'
    | 'packhouse-inspection'
    | 'packhouse-cleaning'
    | 'packhouse-glass'
    | 'vaselife';
  icon: string; // Ionicons name
  /** When true, the screen renders a "Coming soon" placeholder regardless of
   *  tenant — used for surfaced-but-not-yet-built control points. */
  comingSoon?: boolean;
};
