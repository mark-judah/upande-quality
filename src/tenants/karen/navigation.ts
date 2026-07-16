import type { DrawerItem } from '@/src/core/tenant/types';

export const karenDrawer: DrawerItem[] = [
  { label: 'Traceability',       route: 'traceability',       icon: 'cube-outline' },
  { label: 'Replacement',        route: 'replacement',        icon: 'swap-horizontal-outline' },
  { label: 'Edit Details',       route: 'edit-details',       icon: 'pencil-outline' },
  { label: 'Pending Reshelving', route: 'pending-reshelving', icon: 'inbox-outline' },
  { label: 'Receiving',          route: 'receiving',          icon: 'download-outline' },
  { label: 'Shelving',           route: 'shelving',           icon: 'albums-outline' },
  { label: 'Bucket Requests',    route: 'bucket-requests',    icon: 'cart-outline' },
  { label: 'Solution Mixing',    route: 'solution-mixing',    icon: 'flask-outline' },
  { label: 'Temperature Log',    route: 'temperature-log',    icon: 'thermometer-outline' },
  { label: 'Cleaning Record',    route: 'cleaning-record',    icon: 'sparkles-outline' },
  { label: 'Inspection Log',     route: 'inspection-log',     icon: 'checkbox-outline' },
  { label: 'Discards',           route: 'discards',           icon: 'trash-outline' },
  { label: 'Intake QC',          route: 'intake-qc',          icon: 'checkmark-done-outline' },
  { label: 'Coldroom QC',        route: 'coldroom-qc',        icon: 'snow-outline',     comingSoon: true },
  { label: 'Packhouse QC',       route: 'packhouse-qc',       icon: 'cube-outline' },
];
